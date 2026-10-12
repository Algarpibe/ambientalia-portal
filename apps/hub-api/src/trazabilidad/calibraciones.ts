/**
 * Calibraciones desde Desk 2.0 (lote 9c): la regla pura. Sin base, sin reloj
 * (`hoy` llega como argumento) y sin más import que dominio.ts y un tipo: la
 * app lee de aquí los tipos.
 *
 * Una calibración conocida es una FILA de `portal.tmc_calibraciones` (057) y
 * su fecha no se edita nunca: corregir es anular la fila e insertar otra.
 *
 * «Última calibración» de un equipo (`calibracionQueCuenta`) = la fecha máxima
 * entre sus filas `vigente` con fecha ≤ hoy. Una fila `manual` puede corregir
 * un ticket: lleva su número en `corrigeTicket` y, en `corrigeFecha`, la fecha
 * que ese ticket tenía en Zoho al corregirlo. Mientras la fila sin anular de
 * ese ticket siga con ESA fecha, la manual la tapa (manda aunque la de Desk sea
 * posterior); cuando la fecha cambia en Zoho —la pasada anula la fila de Desk
 * e inserta otra— o el campo se vacía, la corrección deja de contar.
 *
 * El plan de la pasada (`planCalibraciones`) compara lo leído en Desk 2.0 con
 * lo guardado y dice qué filas nacen y cuáles se anulan; además da a cada
 * equipo del inventario su fila de partida (`fst022`), una sola vez. La
 * pantalla y las rutas de la corrección manual son del lote 9d.
 */
import { ESTADOS_AVISO, esFechaIso, estadoCalibracion, serialNorm } from './dominio.js';
import type { EstadoMaestro } from './maestro.js';

/** Una fecha anterior no puede ser la calibración de un equipo de estos: va a revisión. */
export const FECHA_MINIMA_CALIBRACION = '2000-01-01';

export const ORIGENES_CALIBRACION = ['fst022', 'desk', 'manual'] as const;
export type OrigenCalibracion = (typeof ORIGENES_CALIBRACION)[number];
export const ESTADOS_FILA_CALIBRACION = ['vigente', 'anulada', 'en_revision'] as const;
export type EstadoFilaCalibracion = (typeof ESTADOS_FILA_CALIBRACION)[number];

/** Un ticket de Desk 2.0 que trae el campo. `fecha` es null si su valor no es una fecha; `campo`, de dónde salió. */
export interface TicketCalibracion { numero: number; fecha: string | null; campo: 'nombre_interno' | 'etiqueta'; equipoId: string | null; serial: string | null; tipoServicio: string | null; estado: string | null; gestionadoPorApp: boolean }
/** Una fila guardada. `anuladaAMano` = anulada por una persona, no por una pasada: la pasada no la resucita. */
export interface FilaCalibracion { id: number; clave: string | null; serial: string; deskEquipoId: string | null; fecha: string; origen: OrigenCalibracion; ticket: number | null; estado: EstadoFilaCalibracion; corrigeTicket: number | null; corrigeFecha: string | null; anuladaAMano: boolean }
/** Un equipo del inventario del portal (activo o no) con la fecha que le dejó la última importación. */
export interface EquipoInventario { clave: string; serial: string; activo: boolean; deskId: string | null; ultimaCalibracion: string | null }
/** Una fila de equipo de la congelación vigente: su clave en el inventario, su serial y su «Última Calibración». */
export interface FilaPartida { clave: string | null; serialNorm: string | null; fecha: string | null }

/** El valor del campo de Zoho → AAAA-MM-DD (también de un instante ISO); null si no es una fecha. */
export function leerFechaCampo(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().slice(0, 10) : '';
  return esFechaIso(s) ? s : null;
}

const PESO: Record<OrigenCalibracion, number> = { manual: 2, desk: 1, fst022: 0 };

/** La fila que da la «última calibración» de UN equipo a `hoy` (día en Colombia), o null. Ver la cabecera. */
export function calibracionQueCuenta(filas: readonly FilaCalibracion[], hoy: string): FilaCalibracion | null {
  const vivas = filas.filter((f) => f.estado !== 'anulada');
  const corrige = (m: FilaCalibracion): boolean => m.estado === 'vigente' && vivas.some((f) => f.origen === 'desk' && f.ticket === m.corrigeTicket && f.fecha === m.corrigeFecha);
  const tapados = new Set(vivas.filter((f) => f.origen === 'manual' && f.corrigeTicket !== null && corrige(f)).map((m) => m.corrigeTicket));
  const cuenta = (f: FilaCalibracion): boolean => (f.origen === 'manual' ? f.corrigeTicket === null || corrige(f) : !(f.origen === 'desk' && tapados.has(f.ticket)));
  return vivas
    .filter((f) => f.estado === 'vigente' && f.fecha <= hoy && cuenta(f))
    .reduce<FilaCalibracion | null>((mejor, f) => (!mejor || f.fecha > mejor.fecha || (f.fecha === mejor.fecha && (PESO[f.origen] - PESO[mejor.origen] || f.id - mejor.id) > 0) ? f : mejor), null);
}

/** La fecha que enseña el inventario: la de la regla; sólo si el equipo no tiene NINGUNA fila (ni anulada) vale la que ya tenía (`respaldo`). */
export function fechaEfectiva(filas: readonly FilaCalibracion[], respaldo: string | null, hoy: string): string | null {
  return filas.length === 0 ? respaldo : (calibracionQueCuenta(filas, hoy)?.fecha ?? null);
}

/** Una fila que la pasada insertaría, y una que anularía. */
export interface FilaNueva { clave: string | null; serial: string; serialNorm: string; deskEquipoId: string | null; fecha: string; origen: 'fst022' | 'desk'; ticket: number | null; estado: 'vigente' | 'en_revision'; motivo: string | null }
export interface Anulacion { id: number; motivo: string }

/** El detalle para revisar, en el orden en que hay que mirarlo. Lleva seriales: sólo para quien puede traer. */
export const TIPOS_DETALLE = ['revision', 'cambiada', 'vaciada', 'sin_equipo', 'distinta', 'ilegible', 'no_resucita', 'nueva', 'otra_marca', 'partida'] as const;
export type TipoDetalle = (typeof TIPOS_DETALLE)[number];
export interface DetalleCalibracion { tipo: TipoDetalle; ticket: number | null; clave: string | null; serial: string; fecha: string | null; antes: string | null; nota: string | null }

/** El plan en números: nada de aquí lleva un cliente ni un serial. */
export interface RecuentosCalibraciones {
  /** Tickets en Desk 2.0, cuántos traen el detalle de Zoho (`raw.cf`) y cuántos el campo (por nombre interno o sólo por etiqueta). */
  tickets: number;
  conCf: number;
  conCampo: number;
  porNombre: number;
  porEtiqueta: number;
  /** De los que traen el campo, los que gestiona la app de Desk 2.0: ya no reciben cambios hechos en Zoho. */
  gestionadosPorApp: number;
  nuevas: number;
  sinCambios: number;
  /** La fecha cambió en Zoho: se anula la fila y se inserta otra. `reenlazadas`: misma fecha, pero cambió su equipo o su revisión. */
  cambiadas: number;
  reenlazadas: number;
  /** El campo se vació en Zoho: se anula. */
  vaciadas: number;
  /** De las que se insertan: en revisión (fecha futura o absurda, o serial ambiguo) y sin clave (el serial no es del inventario: otras marcas, 9d). */
  enRevision: number;
  otrasMarcas: number;
  /** De las que se insertan, las anteriores a la fecha que ya tiene su equipo: historial. */
  historial: number;
  /** No crean fila: sin serial ni equipo, con un valor que no es una fecha, y las anuladas a mano que no se resucitan. */
  sinEquipo: number;
  ilegibles: number;
  noResucitan: number;
  /** Punto de partida: filas fst022 que nacen; de ellas, las que salen del inventario (la hoja no trae fecha) y las que la hoja y el inventario dan distintas (manda la hoja). */
  partida: number;
  partidaDeInventario: number;
  partidaDistintas: number;
  /** Equipos activos a los que les cambiaría la última calibración, y los que con ello saldrían de (o entrarían en) los estados de aviso. */
  equiposCambian: number;
  salenDeAvisos: number;
  entranEnAvisos: number;
}

export interface EntradaPlanCalibraciones { hoy: string; tickets: readonly TicketCalibracion[]; total: number; conCf: number; filas: readonly FilaCalibracion[]; equipos: readonly EquipoInventario[]; partida: readonly FilaPartida[] }
export interface PlanCalibraciones { recuentos: RecuentosCalibraciones; altas: FilaNueva[]; anular: Anulacion[]; detalle: DetalleCalibracion[] }

const MOTIVO_HOJA = 'F-ST-022 congelada.';
const MOTIVO_INVENTARIO = 'Inventario del portal (la hoja congelada no trae fecha para este equipo).';

function agrupar<T>(items: readonly T[], clave: (t: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of items) {
    const k = clave(t);
    if (k) m.set(k, [...(m.get(k) ?? []), t]);
  }
  return m;
}

/**
 * El plan de una pasada. Misma entrada (en cualquier orden) → mismo plan; con
 * el plan aplicado, el siguiente no trae nada. No toca las filas manuales.
 *
 * Enlace de un ticket con su equipo: primero `equipo_id` → `desk_id` del
 * inventario; si no, el serial con `serialNorm` (la regla del maestro: una
 * sola fila, o la única activa). Sin equipo en el inventario la fila se guarda
 * sin clave (otras marcas); con el serial en dos equipos, en revisión.
 */
export function planCalibraciones(e: EntradaPlanCalibraciones): PlanCalibraciones {
  const { hoy } = e;
  const filas = [...e.filas].sort((a, b) => a.id - b.id);
  const equipos = [...e.equipos].sort((a, b) => a.clave.localeCompare(b.clave));
  const porDesk = new Map(equipos.filter((q) => q.deskId).map((q) => [q.deskId, q]));
  const porSerial = agrupar(equipos, (q) => serialNorm(q.serial));
  const r: RecuentosCalibraciones = {
    tickets: e.total, conCf: e.conCf, conCampo: 0, porNombre: 0, porEtiqueta: 0, gestionadosPorApp: 0, nuevas: 0, sinCambios: 0, cambiadas: 0, reenlazadas: 0, vaciadas: 0, enRevision: 0, otrasMarcas: 0,
    historial: 0, sinEquipo: 0, ilegibles: 0, noResucitan: 0, partida: 0, partidaDeInventario: 0, partidaDistintas: 0, equiposCambian: 0, salenDeAvisos: 0, entranEnAvisos: 0,
  };
  const altas: FilaNueva[] = [];
  const anular: Anulacion[] = [];
  const detalle: DetalleCalibracion[] = [];
  const revisionDe = (fecha: string): string | null => (fecha > hoy ? 'La fecha es posterior a hoy.' : fecha < FECHA_MINIMA_CALIBRACION ? `La fecha es anterior al ${FECHA_MINIMA_CALIBRACION}.` : null);

  // 1. Los tickets que traen el campo, contra la fila de Desk de cada uno.
  const deDesk = agrupar(filas.filter((f) => f.origen === 'desk'), (f) => String(f.ticket));
  const leidos = new Set<number>();
  for (const t of [...e.tickets].sort((a, b) => a.numero - b.numero)) {
    leidos.add(t.numero);
    r.conCampo++;
    if (t.campo === 'etiqueta') r.porEtiqueta++;
    else r.porNombre++;
    if (t.gestionadoPorApp) r.gestionadosPorApp++;
    const serial = (t.serial ?? '').trim();
    const anotar = (tipo: TipoDetalle, extra: Partial<DetalleCalibracion> = {}) => detalle.push({ tipo, ticket: t.numero, clave: null, serial, fecha: t.fecha, antes: null, nota: null, ...extra });
    if (t.fecha === null) {
      r.ilegibles++; // ni fila ni anulación: el valor no se entiende, la que hubiera se queda
      anotar('ilegible');
      continue;
    }
    if (serial === '' && !t.equipoId) {
      r.sinEquipo++;
      anotar('sin_equipo');
      continue;
    }
    const delTicket = deDesk.get(String(t.numero)) ?? [];
    const viva = delTicket.find((f) => f.estado !== 'anulada');
    const conSerial = porSerial.get(serialNorm(serial)) ?? [];
    const activas = conSerial.filter((q) => q.activo);
    const equipo = (t.equipoId ? porDesk.get(t.equipoId) : undefined) ?? (conSerial.length === 1 ? conSerial[0] : activas.length === 1 ? activas[0] : undefined);
    const motivo = !equipo && conSerial.length > 1 ? 'El serial está en más de un equipo del inventario.' : revisionDe(t.fecha);
    const nueva: FilaNueva = { clave: equipo?.clave ?? null, serial, serialNorm: serialNorm(serial), deskEquipoId: t.equipoId, fecha: t.fecha, origen: 'desk', ticket: t.numero, estado: motivo ? 'en_revision' : 'vigente', motivo };
    if (viva) {
      if (viva.fecha === nueva.fecha && viva.clave === nueva.clave && viva.estado === nueva.estado) {
        r.sinCambios++;
        continue;
      }
      const cambio = viva.fecha !== nueva.fecha;
      anular.push({ id: viva.id, motivo: cambio ? `La fecha cambió en Zoho: ${viva.fecha} → ${nueva.fecha}.` : 'Cambió su enlace con el equipo o su revisión.' });
      if (cambio) r.cambiadas++;
      else r.reenlazadas++;
    } else {
      // Anulada a mano con esta misma fecha: alguien decidió que no vale, y Zoho sigue diciendo lo mismo.
      const ultima = delTicket.at(-1);
      if (ultima?.anuladaAMano && ultima.fecha === t.fecha) {
        r.noResucitan++;
        anotar('no_resucita', { clave: ultima.clave });
        continue;
      }
      r.nuevas++;
    }
    altas.push(nueva);
    if (motivo) r.enRevision++;
    else if (!equipo) r.otrasMarcas++;
    anotar(motivo ? 'revision' : viva ? 'cambiada' : equipo ? 'nueva' : 'otra_marca', { clave: nueva.clave, antes: viva?.fecha ?? null, nota: motivo });
  }
  // 2. Filas de Desk cuyo ticket ya no trae el campo.
  for (const f of filas) {
    if (f.origen !== 'desk' || f.estado === 'anulada' || f.ticket === null || leidos.has(f.ticket)) continue;
    anular.push({ id: f.id, motivo: 'El campo se vació en Zoho (o el ticket ya no está en Desk 2.0).' });
    r.vaciadas++;
    detalle.push({ tipo: 'vaciada', ticket: f.ticket, clave: f.clave, serial: f.serial, fecha: null, antes: f.fecha, nota: null });
  }
  // 3. Punto de partida: UNA fila fst022 por equipo del inventario con fecha conocida. Sale de la hoja congelada
  // (el punto de partida firmado), por su clave o por un serial que no se repita; sin fecha allí, de la del inventario.
  const conPartida = new Set(filas.filter((f) => f.origen === 'fst022').map((f) => f.clave));
  const hojaPorClave = new Map(e.partida.filter((p) => p.clave).map((p) => [p.clave, p]));
  const hojaPorSerial = agrupar(e.partida, (p) => p.serialNorm);
  for (const q of equipos) {
    if (conPartida.has(q.clave)) continue;
    const s = serialNorm(q.serial);
    const deSerie = hojaPorSerial.get(s) ?? [];
    const hoja = hojaPorClave.get(q.clave) ?? (deSerie.length === 1 && porSerial.get(s)?.length === 1 ? deSerie[0] : undefined);
    const deHoja = hoja && esFechaIso(hoja.fecha) ? hoja.fecha : null;
    const fecha = deHoja ?? q.ultimaCalibracion;
    if (!fecha) continue;
    const distinta = deHoja !== null && q.ultimaCalibracion !== null && deHoja !== q.ultimaCalibracion;
    const revision = revisionDe(fecha);
    const motivo = deHoja ? MOTIVO_HOJA : MOTIVO_INVENTARIO;
    altas.push({ clave: q.clave, serial: q.serial, serialNorm: s, deskEquipoId: q.deskId, fecha, origen: 'fst022', ticket: null, estado: revision ? 'en_revision' : 'vigente', motivo: revision ? `${motivo} ${revision}` : motivo });
    r.partida++;
    if (!deHoja) r.partidaDeInventario++;
    if (distinta) r.partidaDistintas++;
    detalle.push({ tipo: revision ? 'revision' : distinta ? 'distinta' : 'partida', ticket: null, clave: q.clave, serial: q.serial, fecha, antes: distinta ? q.ultimaCalibracion : null, nota: motivo });
  }
  // 4. A qué equipos activos les cambiaría la última calibración, y cuáles saldrían de los avisos.
  const anuladas = new Set(anular.map((a) => a.id));
  const despues: FilaCalibracion[] = [
    ...filas.map((f) => (anuladas.has(f.id) ? { ...f, estado: 'anulada' as const } : f)),
    ...altas.map((a, i) => ({ id: Number.MAX_SAFE_INTEGER - altas.length + i, clave: a.clave, serial: a.serial, deskEquipoId: a.deskEquipoId, fecha: a.fecha, origen: a.origen, ticket: a.ticket, estado: a.estado, corrigeTicket: null, corrigeFecha: null, anuladaAMano: false })),
  ];
  const antesDe = agrupar(filas, (f) => f.clave);
  const despuesDe = agrupar(despues, (f) => f.clave);
  const enAvisos = (fecha: string | null): boolean => ESTADOS_AVISO.includes(estadoCalibracion(fecha, hoy).estado);
  for (const q of equipos) {
    const antes = fechaEfectiva(antesDe.get(q.clave) ?? [], q.ultimaCalibracion, hoy);
    const luego = fechaEfectiva(despuesDe.get(q.clave) ?? [], q.ultimaCalibracion, hoy);
    r.historial += altas.filter((a) => a.clave === q.clave && a.origen === 'desk' && a.estado === 'vigente' && antes !== null && a.fecha < antes).length;
    if (!q.activo || antes === luego) continue;
    r.equiposCambian++;
    if (enAvisos(antes) && !enAvisos(luego)) r.salenDeAvisos++;
    if (!enAvisos(antes) && enAvisos(luego)) r.entranEnAvisos++;
  }
  detalle.sort((a, b) => TIPOS_DETALLE.indexOf(a.tipo) - TIPOS_DETALLE.indexOf(b.tipo));
  return { recuentos: r, altas, anular, detalle };
}

/** La comprobación de salud de una lectura: si avisa y si, además, no deja traer. */
export interface SaludLectura { alerta: boolean; bloquea: boolean; mensaje: string | null }

/**
 * Si ningún ticket trae el campo, algo ha pasado fuera (lo renombraron en Zoho
 * o Desk 2.0 dejó de releer los tickets). `antes` = cuántos lo traían (filas
 * de Desk sin anular, o la última pasada): si eran más de cero, traer ahora
 * las anularía todas, así que no se deja.
 */
export function saludLectura(conCampo: number, antes: number): SaludLectura {
  if (conCampo > 0) return { alerta: false, bloquea: false, mensaje: null };
  return { alerta: true, bloquea: antes > 0, mensaje: `Ningún ticket de Desk 2.0 trae la «Fecha de Calibración»${antes > 0 ? ` (antes la traían ${antes})` : ''}: puede que el campo se haya renombrado en Zoho o que Desk 2.0 no esté releyendo los tickets.${antes > 0 ? ' No se puede traer así: anularía todas las fechas que vinieron de Desk 2.0.' : ''}` };
}

/** Una pasada aplicada, de la auditoría (`portal.tmc_calibraciones_pasadas`): quién, cuándo y recuentos. */
export interface PasadaCalibraciones { id: number; huella: string; recuentos: RecuentosCalibraciones; por: string; en: string }

/** GET /trazabilidad/calibraciones/plan. `detalle` (con seriales, acotado) sólo va para quien puede traer. */
export interface RespuestaPlanCalibraciones {
  /** Si Desk 2.0 contestó en esta petición y, si no, por qué (un motivo de la lista, nunca el error). */
  lectura: EstadoMaestro;
  /** null sin Desk 2.0. `huella` identifica el plan: se manda al aplicarlo. */
  plan: { huella: string; recuentos: RecuentosCalibraciones } | null;
  salud: SaludLectura | null;
  ultima: PasadaCalibraciones | null;
  detalle?: DetalleCalibracion[];
  detalleTotal?: number;
}

/** Una fila tal como está guardada, con su motivo y sus firmas (alta y anulación). */
export interface CalibracionGuardada extends FilaCalibracion { motivo: string | null; por: string; en: string; anuladaPor: string | null; anuladaEn: string | null; anuladaMotivo: string | null }
/** Una calibración del historial de un equipo, para su ficha. `cuenta` = es la que da su «última calibración». */
export type CalibracionHistorial = CalibracionGuardada & { cuenta: boolean };
/** GET /trazabilidad/equipos/:clave/calibraciones. `ultima` es la fecha que da la regla (null si ninguna fila cuenta). */
export interface RespuestaHistorialCalibraciones { clave: string; ultima: string | null; calibraciones: CalibracionHistorial[] }
