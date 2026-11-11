/**
 * Una corrida de «Equipos en taller» (§5.1 del diseño, con la revisión del 10/11/2026):
 *   1. Candado. Sin ninguna sincronización completa de n8n, «sin configurar» (503) y no
 *      se registra nada. Si la hay, la corrida se inserta «en curso»; si choca, «ocupado» (409).
 *   2. Desk 2.0: una sonda antes de nada. Si falla → «desk2: <motivo>».
 *   3. Frescura: si la última pasada completa de n8n tiene más de `maxHorasSync` horas
 *      → CAUSA_SYNC_ATRASADA (D5: nunca una foto con datos incompletos). Si la última pasada
 *      CERRADA fue 'textos_fallidos' (repo-sync.ts), la causa es CAUSA_TEXTOS_FALLIDOS: n8n
 *      sí sincroniza, pero no puede leer los textos. La regla de frescura es la misma.
 *   4. Copia de Drive + núcleo: `actualizar` con las fuentes VIGILADAS. El núcleo
 *      convierte muchos fallos en avisos y sigue; aquí, cualquier fallo de una fuente hace
 *      fallida la corrida.
 *      EXCEPCIÓN (A9): un archivo concreto sin texto (`FalloArchivo`: n8n guardó su fallo,
 *      o el texto aún no llegó) no es un fallo de la fuente. Un PDF va a ilegibles; una
 *      remisión de entrada, a avisos (el núcleo no la cachea y el equipo cuenta por el
 *      nombre de su carpeta). Si fallan todos los intentados (2 o más) y ninguno sale, sí
 *      falla la corrida.
 *      D10: la caché `exits` NO entra al núcleo, que relee de la copia el OCR de todos los
 *      PDF (una consulta, no un OCR). Así, un PDF renombrado o un texto reenviado se nota
 *      en la corrida siguiente. La de remisiones de entrada (`ent`) sí entra.
 *   5. Foto y cierre en una transacción (repo.terminarBien), con `exits` y `ent`.
 * Después, el incidente (incidente.ts) y, si toca, la alerta (alerta.ts).
 *
 * Una corrida fallida NUNCA toca `foto` ni `exits`. La siguiente es el reintento. `exits` ya
 * no ahorra nada (D10): solo la escribe una corrida buena, completa. La de una fallida
 * tendría solo los PDF leídos antes del fallo y pisaría la buena.
 */
import { actualizar, hoyBogota } from './nucleo/actualizar.js';
import { iso } from './nucleo/reglas.js';
import { EST, type Foto, type Fuentes, type Ilegible, type Resultado } from './nucleo/tipos.js';
import { CAUSA_SYNC_ATRASADA, CAUSA_TEXTOS_FALLIDOS, type OrigenCorrida } from './contrato.js';
import { decidirIncidente } from './incidente.js';
import { correoAlerta, destinatarios, type CanalAlerta } from './alerta.js';
import { FalloArchivo, type FuenteDrive } from './fuente-n8n.js';
import { motivoDesk2, type FuenteDesk2 } from './fuente-desk2.js';
import { CorridaCerrada, type RepoEquipos } from './repo.js';
import type { RepoSync, SincronizacionHecha } from './repo-sync.js';

const HORA_MS = 3_600_000;

/** Causa de la corrida cuando falla la lectura de la copia de Drive (la base de hub-api), no un archivo. */
export const CAUSA_COPIA_DRIVE = 'interno: no se pudo leer la copia de Drive';

/** Para el registro: nombre y código del error, NUNCA su mensaje ni su pila (pueden llevar datos de la base). */
function huella(e: unknown): string {
  const nombre = String((e as { name?: unknown } | null)?.name ?? 'desconocido').slice(0, 40);
  const code = (e as { code?: unknown } | null)?.code;
  return nombre + (typeof code === 'string' || typeof code === 'number' ? ' ' + String(code).slice(0, 20) : '');
}

export interface FuentesCorrida {
  drive: FuenteDrive;
  desk2: FuenteDesk2;
}

export type ResultadoCorrida =
  | { estado: 'ok'; conteos: Record<string, number>; avisos: string[] }
  | { estado: 'error'; causa: string }
  | { estado: 'ocupado' }
  | { estado: 'sin_configurar' };

export interface ServicioEquipos {
  /** Hay al menos una sincronización completa de n8n (si no, «sin configurar»). */
  configurado(): Promise<boolean>;
  /** Hay una corrida de este proceso en marcha. */
  actualizando(): boolean;
  /** Para la ruta POST: empieza la corrida y no espera. */
  lanzar(origen: OrigenCorrida, userId: string | null): Promise<'iniciada' | 'ocupado' | 'sin_configurar'>;
  /** Para el programador: corre y espera a que termine. */
  ejecutar(origen: OrigenCorrida, userId: string | null): Promise<ResultadoCorrida>;
  /** Para las pruebas: la corrida en marcha (o null). */
  enCurso(): Promise<ResultadoCorrida> | null;
}

export interface DepsServicio {
  repo: RepoEquipos;
  /** De la copia de Drive, el servicio solo mira la última pasada completa y, si está atrasada, el motivo de la última cerrada. */
  sync: Pick<RepoSync, 'ultimaSincronizacion' | 'motivoUltimaPasada'>;
  /** Fuentes NUEVAS para cada corrida, sobre la pasada con la que corre (la de Desk 2.0 guarda un mapa por corrida). */
  fuentes: (s: SincronizacionHecha) => FuentesCorrida;
  /** EQUIPOS_SYNC_MAX_HORAS: con una copia más vieja, la corrida falla. */
  maxHorasSync: number;
  canal: CanalAlerta;
  reserva: string;
  log?: (t: string) => void;
  hoy?: () => string;
  /** El reloj de la frescura (las pruebas lo fijan). */
  ahora?: () => number;
}

/** Conteos de la foto, para `equipos_ejecucion.conteos` (tendencia y psql). */
export function contar(foto: Foto): Record<string, number> {
  const n = (e: string) => foto.rows.filter((x) => x.est === e).length;
  return {
    en_taller: n(EST.TALLER),
    servicio_externo: n(EST.EXTERNO),
    revisar: n(EST.REVISAR),
    ticket_cerrado_sin_salida: n(EST.CERRADO),
    salio_ticket_abierto: foto.rows.filter((x) => x.est === EST.ENTREGADO && x.z && !x.zc).length,
    remisiones_ilegibles: (foto.ilegibles || []).length,
  };
}

/** Un PDF de salida escaneada sin texto en la copia (A9). */
export interface PdfSinTexto {
  id: string;
  /** Nombre del archivo en Drive (el id si no apareció en el listado). */
  n: string;
  /** El fallo que guardó n8n, o null si su texto todavía no llegó. */
  status: number | null;
}

/** Cómo se nombra en una causa el fallo de un archivo. */
const etiqueta = (status: number | null): string => (status === null ? 'texto pendiente de n8n' : 'HTTP ' + status);

/** La fila de ilegibles de un PDF sin texto. `d` sale del AAMMDD del nombre, como en el núcleo. */
export function ilegibleSinTexto(p: PdfSinTexto): Ilegible {
  return {
    id: p.id,
    n: p.n,
    d: iso((p.n.match(/^\d{6}/) || [''])[0]),
    m: 'sin texto legible',
    q: p.status === null
      ? 'n8n todavía no ha enviado el texto de este PDF: se pedirá en la próxima sincronización'
      : 'Google Drive no pudo convertir este PDF a texto (HTTP ' + p.status + '): revisar el archivo en Drive',
    p: [],
  };
}

/**
 * Las fuentes del núcleo, vigiladas: cada fallo se apunta (el primero de cada origen, ya
 * traducido a una causa sin secretos) y el error sigue su camino. Un `FalloArchivo` al
 * leer el texto de un PDF se aparta en `pdfsSinTexto()`, y el de una remisión de entrada
 * en `entradasSinLeer()`: no hacen fallar la corrida (A9), salvo que fallen 2 o más y
 * ninguno salga. Cualquier otro error de la copia es de la base: CAUSA_COPIA_DRIVE.
 */
export function vigilarFuentes(f: FuentesCorrida): {
  fuentes: Fuentes;
  fallo(): string | null;
  pdfsSinTexto(): PdfSinTexto[];
  entradasSinLeer(): { id: string; status: number | null }[];
} {
  let desk2: string | null = null;
  let drive: string | null = null;
  const titulos = new Map<string, string>();
  const sinTexto: PdfSinTexto[] = [];
  let convertidos = 0;
  const entSinLeer: { id: string; status: number | null }[] = [];
  let entLeidas = 0;
  const de = <A extends unknown[], R>(origen: 'desk2' | 'drive', fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      try {
        return await fn(...a);
      } catch (e) {
        if (origen === 'desk2') desk2 ??= 'desk2: ' + motivoDesk2(e);
        else drive ??= CAUSA_COPIA_DRIVE;
        throw e;
      }
    };
  return {
    fuentes: {
      entradas: de('drive', () => f.drive.entradas()),
      salidasGeneradas: de('drive', () => f.drive.salidasGeneradas()),
      salidasEscaneadas: de('drive', async () => {
        const lista = await f.drive.salidasEscaneadas();
        for (const a of lista) titulos.set(a.id, a.title);
        return lista;
      }),
      textoPdf: async (id: string) => {
        try {
          const t = await f.drive.textoPdf(id);
          convertidos++;
          return t;
        } catch (e) {
          if (e instanceof FalloArchivo) sinTexto.push({ id, n: titulos.get(id) ?? id, status: e.status });
          else drive ??= CAUSA_COPIA_DRIVE;
          throw e; // el núcleo lo apunta en avisos y NO lo mete en la caché
        }
      },
      remisionEntrada: async (id: string) => {
        try {
          const t = await f.drive.remisionEntrada(id);
          entLeidas++;
          return t;
        } catch (e) {
          if (e instanceof FalloArchivo) entSinLeer.push({ id, status: e.status });
          else drive ??= CAUSA_COPIA_DRIVE;
          throw e; // el núcleo lo apunta en avisos y NO lo mete en la caché
        }
      },
      tickets: de('desk2', (sn: string) => f.desk2.tickets(sn)),
      ticketNumero: de('desk2', (n: string) => f.desk2.ticketNumero(n)),
      comentarios: de('desk2', (id: string) => f.desk2.comentarios(id)),
    },
    fallo: () =>
      desk2 ??
      drive ??
      (sinTexto.length >= 2 && convertidos === 0 ? 'drive: no se pudo convertir ningún PDF (' + etiqueta(sinTexto[0].status) + ')' : null) ??
      (entSinLeer.length >= 2 && entLeidas === 0 ? 'drive: no se pudo leer ninguna remisión de entrada (' + etiqueta(entSinLeer[0].status) + ')' : null),
    pdfsSinTexto: () => [...sinTexto],
    entradasSinLeer: () => [...entSinLeer],
  };
}

export function crearServicioEquipos(deps: DepsServicio): ServicioEquipos {
  const log = deps.log ?? ((t: string) => console.log(t));
  const hoy = deps.hoy ?? hoyBogota;
  const ahora = deps.ahora ?? Date.now;
  let actual: Promise<ResultadoCorrida> | null = null;

  async function registrarIncidente(origen: OrigenCorrida, ok: boolean, causa: string | null): Promise<void> {
    try {
      const abierto = await deps.repo.incidenteAbierto();
      const d = decidirIncidente({ origen, ok }, abierto);
      const id = await deps.repo.aplicarIncidente(d, abierto?.id ?? null);
      if (!d.enviarAlerta || id === null) return;
      const buena = await deps.repo.ultimaCorridaBuena();
      const para = destinatarios(await deps.repo.correosAlerta(), deps.reserva);
      const r = await deps.canal.enviar({ para, ...correoAlerta({ causa: causa ?? '', fallosProgramados: d.fallosProgramados, fotoBuena: buena?.fin ?? null }) }, id);
      await deps.repo.marcarAlerta(id, r);
      log(r.ok ? 'equipos-taller: alerta enviada (incidente ' + id + ')' : 'equipos-taller: la alerta no salió: ' + r.error);
    } catch {
      log('equipos-taller: no se pudo registrar el incidente');
    }
  }

  async function correr(id: number, origen: OrigenCorrida, s: SincronizacionHecha): Promise<ResultadoCorrida> {
    let causa: string | null = null;
    let fin: ResultadoCorrida;
    let guardando = false;
    const abandonada = (): ResultadoCorrida => {
      log('equipos-taller: corrida ' + id + ' abandonada; resultado descartado');
      return { estado: 'error', causa: 'abandonada' };
    };
    try {
      const f = deps.fuentes(s);
      let sonda: { total: number; conCf: number } | null = null;
      try {
        sonda = await f.desk2.sonda();
      } catch (e) {
        causa = 'desk2: ' + motivoDesk2(e);
      }
      // D5: con una copia de Drive vieja no se clasifica (n8n dejó de sincronizar, o sincroniza
      // pero sus pasadas cierran con textos fallidos). Sin el motivo, la causa genérica.
      if (!causa && ahora() - Date.parse(s.fin) > deps.maxHorasSync * HORA_MS) {
        const motivo = await deps.sync.motivoUltimaPasada().catch(() => null);
        causa = motivo === 'textos_fallidos' ? CAUSA_TEXTOS_FALLIDOS : CAUSA_SYNC_ATRASADA;
      }
      let r: Resultado | null = null;
      let sinTexto: PdfSinTexto[] = [];
      if (!causa) {
        const v = vigilarFuentes(f);
        const cache = await deps.repo.leerCaches();
        try {
          // D10: `exits: null`, el OCR se relee de la copia; `ent` sí se reutiliza.
          r = await actualizar(v.fuentes, { snap: null, exits: null, ent: cache.ent, cmt: {} }, { hoy: hoy(), prog: () => {} });
        } catch (e) {
          if (!v.fallo()) log('equipos-taller: error inesperado en el núcleo (' + huella(e) + ')');
          causa = v.fallo() ?? 'interno: error inesperado';
        }
        causa ??= v.fallo();
        sinTexto = v.pdfsSinTexto();
      }
      if (causa || !r) {
        const c = causa ?? 'interno: error inesperado';
        guardando = true;
        // Sin `exits`: la de una corrida fallida es parcial (ver la cabecera).
        await deps.repo.terminarMal(id, c, null);
        fin = { estado: 'error', causa: c };
      } else {
        const sinCf = sonda && sonda.total > sonda.conCf ? sonda.total - sonda.conCf : 0;
        const avisos = [...r.avisos];
        if (sinCf) avisos.push(sinCf + ' tickets de Desk 2.0 sin campos personalizados (raw.cf): se usan solo sus columnas');
        // A9: los PDF sin texto van a ilegibles (no están en la caché). Mismo orden que el núcleo: más reciente primero.
        const foto: Foto = sinTexto.length
          ? { ...r.snap, ilegibles: [...(r.snap.ilegibles ?? []), ...sinTexto.map(ilegibleSinTexto)].sort((a, b) => b.d.localeCompare(a.d)) }
          : r.snap;
        const conteos = contar(foto);
        guardando = true;
        await deps.repo.terminarBien(id, { foto, exits: r.exits, ent: r.ent, avisos, conteos });
        fin = { estado: 'ok', conteos, avisos };
      }
    } catch (e) {
      // Cerrar una corrida que ya no estaba en curso (abandonada): se descarta y NO cuenta para el incidente.
      if (e instanceof CorridaCerrada) return abandonada();
      // Si no, falló el repo (guardando) o algo antes de guardar: se intenta cerrar la corrida para soltar el candado.
      log('equipos-taller: error inesperado ' + (guardando ? 'al guardar' : 'al preparar la corrida') + ' (' + huella(e) + ')');
      causa = guardando ? 'interno: no se pudo guardar' : 'interno: error inesperado';
      try {
        await deps.repo.terminarMal(id, causa, null);
      } catch (e2) {
        if (e2 instanceof CorridaCerrada) return abandonada();
        log('equipos-taller: no se pudo cerrar la corrida (' + huella(e2) + ')');
      }
      fin = { estado: 'error', causa };
    }
    log('equipos-taller: corrida ' + id + ' (' + origen + ') ' + (fin.estado === 'error' ? 'fallida: ' + fin.causa : 'terminada'));
    await registrarIncidente(origen, fin.estado === 'ok', fin.estado === 'error' ? fin.causa : null);
    return fin;
  }

  /** El candado y el arranque. La corrida va envuelta (`{ corrida }`) para que el `async` no la espere. */
  async function arrancar(origen: OrigenCorrida, userId: string | null): Promise<'ocupado' | 'sin_configurar' | { corrida: Promise<ResultadoCorrida> }> {
    const s = await deps.sync.ultimaSincronizacion();
    if (!s) return 'sin_configurar';
    const id = await deps.repo.iniciarCorrida(origen, userId);
    if (id === null) return 'ocupado';
    const corrida: Promise<ResultadoCorrida> = correr(id, origen, s).finally(() => {
      if (actual === corrida) actual = null;
    });
    actual = corrida;
    return { corrida };
  }

  return {
    configurado: async () => (await deps.sync.ultimaSincronizacion()) !== null,
    actualizando: () => actual !== null,
    async lanzar(origen, userId) {
      const a = await arrancar(origen, userId);
      if (typeof a === 'string') return a;
      a.corrida.catch(() => {}); // nadie la espera: que un fallo tardío no sea un rechazo sin atender
      return 'iniciada';
    },
    async ejecutar(origen, userId) {
      const a = await arrancar(origen, userId);
      return typeof a === 'string' ? { estado: a } : a.corrida;
    },
    enCurso: () => actual,
  };
}
