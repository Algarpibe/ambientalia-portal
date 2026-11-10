/**
 * Una corrida de «Equipos en taller» (§5.1 del diseño):
 *   1. Candado: la corrida se inserta «en curso»; si choca, «ocupado» (409).
 *   2. Desk 2.0: una sonda antes de nada. Si falla → «desk2: <motivo>». Luego el
 *      barrido de las copias huérfanas del OCR en la carpeta temporal (si falla →
 *      «drive: <motivo>»; las que no se puedan borrar son un aviso).
 *   3. Drive + núcleo: `actualizar` con las fuentes VIGILADAS. El núcleo convierte
 *      muchos fallos en avisos y sigue; aquí cualquier fallo de una fuente hace
 *      fallida la corrida (D5: nunca una foto con datos incompletos). Si falla
 *      Drive, el texto de OCR ya extraído se guarda igual (`exits` es caché).
 *      EXCEPCIÓN (A9): un PDF concreto que Drive no puede pasar a texto (4xx de
 *      ese archivo) no es un fallo de la fuente: va a ilegibles y, como el núcleo
 *      no lo mete en la caché, se reintenta en la siguiente corrida. Si fallan
 *      todos los intentados (2 o más) y ninguno sale, sí es de Drive. Lo mismo
 *      con la remisión de entrada de un equipo concreto: el núcleo la apunta en
 *      avisos, no la cachea y el equipo cuenta por el nombre de su carpeta.
 *   4. Foto y cierre en una transacción (repo.terminarBien).
 * Después, el incidente (incidente.ts) y, si toca, la alerta (alerta.ts).
 *
 * Una corrida fallida NUNCA toca `foto`. La siguiente es el reintento.
 */
import { actualizar, hoyBogota } from './nucleo/actualizar.js';
import { iso } from './nucleo/reglas.js';
import { EST, type Foto, type Fuentes, type Ilegible, type Resultado } from './nucleo/tipos.js';
import type { OrigenCorrida } from './contrato.js';
import { decidirIncidente } from './incidente.js';
import { correoAlerta, destinatarios, type CanalAlerta } from './alerta.js';
import { ErrorDrive, motivoDrive, type FuenteDrive } from './fuente-drive.js';
import { motivoDesk2, type FuenteDesk2 } from './fuente-desk2.js';
import { CorridaCerrada, type RepoEquipos } from './repo.js';

/** Para el registro: nombre y código del error, NUNCA su mensaje ni su pila (pueden llevar datos de la base o de Google). */
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
  configurado(): boolean;
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
  /** null = «sin configurar» (falta Drive). */
  fuentes: (() => FuentesCorrida) | null;
  canal: CanalAlerta;
  reserva: string;
  log?: (t: string) => void;
  hoy?: () => string;
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

/** Un PDF de salida escaneada que Drive no pudo pasar a texto (A9). */
export interface PdfSinTexto {
  id: string;
  /** Nombre del archivo en Drive (el id si no apareció en el listado). */
  n: string;
  status: number;
}

/**
 * ¿El fallo es de UN archivo concreto y no de Drive? Un 4xx de la conversión que
 * no sea del token (401) ni de la cuota (429). Un 403 entra aquí: Drive lo da,
 * por ejemplo, cuando un archivo supera el tamaño exportable. Si el problema es
 * de permisos de la carpeta temporal, fallan TODOS y lo detecta `fallo()`.
 */
export function esFalloDeArchivo(e: unknown): e is ErrorDrive {
  return e instanceof ErrorDrive && !e.enToken && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;
}

/** La fila de ilegibles de un PDF sin texto. `d` sale del AAMMDD del nombre, como en el núcleo. */
export function ilegibleSinTexto(p: PdfSinTexto): Ilegible {
  return {
    id: p.id,
    n: p.n,
    d: iso((p.n.match(/^\d{6}/) || [''])[0]),
    m: 'sin texto legible',
    q: 'Google Drive no pudo convertir este PDF a texto (HTTP ' + p.status + '): revisar el archivo en Drive',
    p: [],
  };
}

/**
 * Las fuentes del núcleo, vigiladas: cada fallo se apunta (el primero de cada
 * origen, ya traducido a una causa sin secretos) y el error sigue su camino.
 * Los fallos de archivo (4xx que no es 401 ni 429) al pasar un PDF a texto se
 * apartan en `pdfsSinTexto()`, y los de una remisión de entrada concreta en
 * `entradasSinLeer()`: no hacen fallar la corrida (A9), salvo que fallen 2 o más
 * y ninguna salga.
 */
export function vigilarFuentes(f: FuentesCorrida): {
  fuentes: Fuentes;
  fallo(): string | null;
  pdfsSinTexto(): PdfSinTexto[];
  entradasSinLeer(): { id: string; status: number }[];
} {
  let desk2: string | null = null;
  let drive: string | null = null;
  const titulos = new Map<string, string>();
  const sinTexto: PdfSinTexto[] = [];
  let convertidos = 0;
  const entSinLeer: { id: string; status: number }[] = [];
  let entLeidas = 0;
  const de = <A extends unknown[], R>(origen: 'desk2' | 'drive', fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      try {
        return await fn(...a);
      } catch (e) {
        if (origen === 'desk2') desk2 ??= 'desk2: ' + motivoDesk2(e);
        else drive ??= 'drive: ' + motivoDrive(e);
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
          if (esFalloDeArchivo(e)) sinTexto.push({ id, n: titulos.get(id) ?? id, status: e.status });
          else drive ??= 'drive: ' + motivoDrive(e);
          throw e; // el núcleo lo apunta en avisos y NO lo mete en la caché
        }
      },
      remisionEntrada: async (id: string) => {
        try {
          const t = await f.drive.remisionEntrada(id);
          entLeidas++;
          return t;
        } catch (e) {
          if (esFalloDeArchivo(e)) entSinLeer.push({ id, status: e.status });
          else drive ??= 'drive: ' + motivoDrive(e);
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
      (sinTexto.length >= 2 && convertidos === 0 ? 'drive: no se pudo convertir ningún PDF (HTTP ' + sinTexto[0].status + ')' : null) ??
      (entSinLeer.length >= 2 && entLeidas === 0 ? 'drive: no se pudo leer ninguna remisión de entrada (HTTP ' + entSinLeer[0].status + ')' : null),
    pdfsSinTexto: () => [...sinTexto],
    entradasSinLeer: () => [...entSinLeer],
  };
}

export function crearServicioEquipos(deps: DepsServicio): ServicioEquipos {
  const log = deps.log ?? ((t: string) => console.log(t));
  const hoy = deps.hoy ?? hoyBogota;
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

  async function correr(id: number, origen: OrigenCorrida): Promise<ResultadoCorrida> {
    let causa: string | null = null;
    let fin: ResultadoCorrida;
    let guardando = false;
    const abandonada = (): ResultadoCorrida => {
      log('equipos-taller: corrida ' + id + ' abandonada; resultado descartado');
      return { estado: 'error', causa: 'abandonada' };
    };
    try {
      // La fábrica debe construir una fuente de Drive NUEVA por corrida (`copiasSinBorrar` cuenta por instancia).
      const f = (deps.fuentes as () => FuentesCorrida)();
      let sonda: { total: number; conCf: number } | null = null;
      try {
        sonda = await f.desk2.sonda();
      } catch (e) {
        causa = 'desk2: ' + motivoDesk2(e);
      }
      // Barrido de las copias huérfanas del OCR: antes de que el núcleo lea Drive.
      const avisosCopias: string[] = [];
      if (!causa) {
        try {
          const b = await f.drive.limpiarTemporal();
          if (b.fallidas > 0) avisosCopias.push(b.fallidas + ' copias temporales del OCR no se pudieron borrar (carpeta temporal)');
        } catch (e) {
          causa = 'drive: ' + motivoDrive(e);
        }
      }
      let r: Resultado | null = null;
      let sinTexto: PdfSinTexto[] = [];
      if (!causa) {
        const v = vigilarFuentes(f);
        const cache = await deps.repo.leerCaches();
        try {
          r = await actualizar(v.fuentes, { snap: null, exits: cache.exits, ent: cache.ent, cmt: {} }, { hoy: hoy(), prog: () => {} });
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
        await deps.repo.terminarMal(id, c, r ? r.exits : null);
        fin = { estado: 'error', causa: c };
      } else {
        const sinCf = sonda && sonda.total > sonda.conCf ? sonda.total - sonda.conCf : 0;
        const avisos = [...r.avisos, ...avisosCopias];
        if (sinCf) avisos.push(sinCf + ' tickets de Desk 2.0 sin campos personalizados (raw.cf): se usan solo sus columnas');
        const sinBorrar = f.drive.copiasSinBorrar();
        if (sinBorrar > 0) avisos.push(sinBorrar + ' copias temporales del OCR no se pudieron borrar; se reintentará en la próxima corrida');
        // A9: los PDF que Drive no pudo pasar a texto van a ilegibles (no están en la caché).
        // Mismo orden que el núcleo: más reciente primero.
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
    if (!deps.fuentes) return 'sin_configurar';
    const id = await deps.repo.iniciarCorrida(origen, userId);
    if (id === null) return 'ocupado';
    const corrida: Promise<ResultadoCorrida> = correr(id, origen).finally(() => {
      if (actual === corrida) actual = null;
    });
    actual = corrida;
    return { corrida };
  }

  return {
    configurado: () => deps.fuentes !== null,
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
