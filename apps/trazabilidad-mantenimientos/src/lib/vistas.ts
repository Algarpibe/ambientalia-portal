/**
 * Agregados y textos que pinta la app. Puro: sin React ni red, para poder
 * probarlo en node. El estado de cada equipo NO se calcula aquí: llega del
 * servidor (dominio.ts) y aquí sólo se cuenta, agrupa y redacta.
 */
import { ESTADOS, ESTADOS_AVISO, diasEntre, enServicio, sumarDias, type EquipoVista, type EstadoCalibracion, type TramoAviso } from '../dominio';

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Colombia va cinco horas por detrás de UTC todo el año (no tiene horario de verano). */
const COLOMBIA_MS = -5 * 3_600_000;
/** Un instante con su zona, como lo manda el servidor («2026-10-07 01:10:00.5+00») o en ISO («…T01:10:00Z»). */
const INSTANTE = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?\s*(Z|[+-]\d\d(?::?\d\d)?)$/i;

/**
 * Día y hora de Colombia de un instante con zona («AAAA-MM-DD» y «HH:MM»);
 * null si es un día suelto o no trae zona (entonces no hay nada que convertir).
 * Es aritmética sobre UTC: no depende del reloj ni de la zona de la máquina.
 */
function enColombia(iso: string): { dia: string; hora: string } | null {
  const m = INSTANTE.exec(iso.trim());
  if (!m) return null;
  // La zona en minutos: «Z», «+00», «-05», «-05:00» o «+0530».
  const z = m[7].replace(':', '');
  const zona = /z/i.test(z) ? 0 : (z[0] === '-' ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3) || 0));
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) - zona * 60_000;
  const local = new Date(utc + COLOMBIA_MS).toISOString();
  return { dia: local.slice(0, 10), hora: local.slice(11, 16) };
}

const diaMesAnio = (dia: string): string => dia.split('-').reverse().join('/');

/**
 * AAAA-MM-DD → DD/MM/AAAA; null → «—». Un instante (la firma de un cambio) se
 * enseña con su día en COLOMBIA, no con el de UTC: lo guardado a las 20:10 de
 * allí es ya el día siguiente en UTC.
 */
export function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  return diaMesAnio(enColombia(iso)?.dia ?? iso.slice(0, 10));
}

/** Como `fmtFecha`, con la hora de Colombia detrás si es un instante: «06/10/2026 20:10». */
export function fmtFechaHora(iso: string | null | undefined): string {
  const c = iso ? enColombia(iso) : null;
  return c ? `${diaMesAnio(c.dia)} ${c.hora}` : fmtFecha(iso);
}

/** «vencida hace 32 d» / «vence hoy» / «quedan 11 d». */
export function textoVigencia(v: number | null): string {
  if (v === null) return 'sin fecha de calibración';
  if (v < 0) return `vencida hace ${-v} d`;
  if (v === 0) return 'vence hoy';
  return `quedan ${v} d`;
}

export function conteoPorEstado(eqs: readonly EquipoVista[]): Record<EstadoCalibracion, number> {
  const c = Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<EstadoCalibracion, number>;
  for (const e of eqs) c[e.estado]++;
  return c;
}

export interface Mes {
  anio: number;
  /** 0 = enero. */
  mes: number;
  total: number;
}

/**
 * Vencimientos de los próximos `n` meses (el actual incluido) y el atraso: los
 * VENCIDOS en el último año, que pueden llegar en cualquier momento. Los que
 * llevan más de un año vencidos (FUERA_CICLO) no cuentan en ninguno de los dos.
 */
export function vencimientosPorMes(eqs: readonly EquipoVista[], hoy: string, n = 12): { atraso: number; meses: Mes[] } {
  const [y0, m0] = hoy.split('-').map(Number);
  const meses: Mes[] = Array.from({ length: n }, (_, i) => {
    const t = m0 - 1 + i;
    return { anio: y0 + Math.floor(t / 12), mes: t % 12, total: 0 };
  });
  let atraso = 0;
  for (const e of eqs) {
    if (e.estado === 'VENCIDA') {
      atraso++;
      continue;
    }
    if (!e.vence || e.estado === 'FUERA_CICLO') continue;
    const [y, m] = e.vence.split('-').map(Number);
    const hit = meses.find((x) => x.anio === y && x.mes === m - 1);
    if (hit) hit.total++;
  }
  return { atraso, meses };
}

export interface FilaCliente {
  cliente: string;
  total: number;
  vencidas: number;
  proximas90: number;
  alDia: number;
  fueraCiclo: number;
  enAmbientalia: number;
}

/** Resumen por cliente, con los que más piden atención primero. */
export function porCliente(eqs: readonly EquipoVista[]): FilaCliente[] {
  const m = new Map<string, FilaCliente>();
  for (const e of eqs) {
    const f = m.get(e.cliente) ?? { cliente: e.cliente, total: 0, vencidas: 0, proximas90: 0, alDia: 0, fueraCiclo: 0, enAmbientalia: 0 };
    f.total++;
    if (e.estado === 'VENCIDA') f.vencidas++;
    else if (e.estado === 'VENCE_30' || e.estado === 'VENCE_60' || e.estado === 'VENCE_90') f.proximas90++;
    else if (e.estado === 'AL_DIA') f.alDia++;
    else if (e.estado === 'FUERA_CICLO') f.fueraCiclo++;
    if (enServicio(e)) f.enAmbientalia++;
    m.set(e.cliente, f);
  }
  return [...m.values()].sort(
    (a, b) => b.vencidas + b.proximas90 - (a.vencidas + a.proximas90) || b.total - a.total || a.cliente.localeCompare(b.cliente, 'es'),
  );
}

/** Vencidos (en el último año) primero y después los que vencen antes. */
export const porUrgencia = (a: EquipoVista, b: EquipoVista) => (a.vigenciaDias ?? 1e9) - (b.vigenciaDias ?? 1e9);

/**
 * El equipo ya está en manos de Ambientalia: marcado a mano en su ficha o con
 * un ticket de servicio abierto en Zoho Desk (aunque esté «sin confirmar»).
 * La regla vive en el dominio (la usa también el plan del aviso automático);
 * aquí sólo se reexporta para que la app tenga una sola.
 */
export { enServicio };

/**
 * Equipos a avisar: vencidos en el último año o que vencen dentro de `ventana`
 * días, y que NO están ya en servicio (en Ambientalia o con ticket abierto).
 */
export function candidatosAviso(eqs: readonly EquipoVista[], ventana: number): EquipoVista[] {
  return eqs
    .filter((e) => ESTADOS_AVISO.includes(e.estado) && (e.vigenciaDias ?? Infinity) <= ventana && !enServicio(e))
    .sort(porUrgencia);
}

export interface GrupoAviso {
  cliente: string;
  equipos: EquipoVista[];
  /** Cuántos no tienen todavía aviso registrado. */
  sinAviso: number;
}

/** Candidatos agrupados por cliente: primero los que tienen avisos pendientes y el equipo más urgente. */
export function avisosPorCliente(eqs: readonly EquipoVista[], ventana: number): GrupoAviso[] {
  const m = new Map<string, EquipoVista[]>();
  for (const e of candidatosAviso(eqs, ventana)) m.set(e.cliente, [...(m.get(e.cliente) ?? []), e]);
  return [...m.entries()]
    .map(([cliente, equipos]) => ({ cliente, equipos, sinAviso: equipos.filter((e) => !e.seguimiento?.avisoEnviado).length }))
    .sort((a, b) => Number(b.sinAviso > 0) - Number(a.sinAviso > 0) || porUrgencia(a.equipos[0], b.equipos[0]));
}

/** Lo que cambia en el texto del aviso cuando es el de un tramo del aviso automático. */
export interface OpcionesAviso {
  /** El tramo (90, 60 o 30 días): cambia la frase de entrada. Sin él, el texto manual de siempre. */
  tramo?: TramoAviso;
  /** La primera línea. Sin ella, «Estimado cliente …:». */
  saludo?: string;
}

/** Cómo empieza la frase de entrada en cada tramo: primer aviso, recordatorio y último aviso. */
const ENTRADA_TRAMO: Record<TramoAviso, string> = {
  90: 'le informamos con antelación de que',
  60: 'le recordamos que',
  30: 'le recordamos, como último aviso, que',
};

/**
 * Texto del aviso previo al cliente, listo para copiar en un correo. Con
 * `opciones.tramo` es el del aviso automático de ese tramo: mismo cuerpo, con
 * la frase de entrada propia del tramo.
 */
export function mensajeAviso(cliente: string, equipos: readonly EquipoVista[], opciones: OpcionesAviso = {}): string {
  const lineas = equipos
    .map((e) => {
      const cuando = (e.vigenciaDias ?? 0) < 0 ? `vencida desde el ${fmtFecha(e.vence)}` : `vence el ${fmtFecha(e.vence)}`;
      return `• GRIMM ${e.modelo}, serial ${e.serial}: última calibración ${fmtFecha(e.ultimaCalibracion)}, ${cuando}.`;
    })
    .join('\n');
  const plural = equipos.length !== 1;
  const entrada =
    opciones.tramo === undefined
      ? `le recordamos que ${plural ? 'los siguientes monitores' : 'el siguiente monitor'} de partículas GRIMM ${plural ? 'tienen' : 'tiene'} la calibración vencida o próxima a vencer:`
      : `${ENTRADA_TRAMO[opciones.tramo]} la calibración ${plural ? 'de los siguientes monitores' : 'del siguiente monitor'} de partículas GRIMM vence en los próximos ${opciones.tramo} días:`;
  return [
    opciones.saludo ?? `Estimado cliente ${cliente}:`,
    '',
    `Desde el Servicio Técnico de Ambientalia ${entrada}`,
    '',
    lineas,
    '',
    'Para mantener la validez de sus mediciones y evitar paradas no previstas, le proponemos programar desde ahora el servicio de calibración y mantenimiento. Indíquenos la fecha en que podría enviarnos los equipos o, si lo prefiere, coordinamos la recogida.',
    '',
    'Quedamos atentos.',
    '',
    'Ambientalia S.A.S. · Servicio Técnico',
  ].join('\n');
}

export interface DiaCalendario {
  fecha: string;
  delMes: boolean;
  equipos: EquipoVista[];
}

/**
 * Rejilla de un mes de lunes a domingo (semanas completas) con los equipos
 * cuya vigencia se cumple cada día. Los FUERA_CICLO no se pintan: su fecha de
 * vencimiento es de hace más de un año.
 */
export function rejillaMes(eqs: readonly EquipoVista[], anio: number, mes: number): DiaCalendario[] {
  const primero = `${anio}-${String(mes + 1).padStart(2, '0')}-01`;
  const dowPrimero = (new Date(Date.UTC(anio, mes, 1)).getUTCDay() + 6) % 7; // 0 = lunes
  const inicio = sumarDias(primero, -dowPrimero);
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).toISOString().slice(0, 10);
  const dowUltimo = (new Date(Date.UTC(anio, mes + 1, 0)).getUTCDay() + 6) % 7;
  const fin = sumarDias(ultimo, 6 - dowUltimo);
  const porDia = new Map<string, EquipoVista[]>();
  for (const e of eqs) {
    if (!e.vence || e.estado === 'FUERA_CICLO') continue;
    porDia.set(e.vence, [...(porDia.get(e.vence) ?? []), e]);
  }
  const n = diasEntre(inicio, fin);
  return Array.from({ length: n + 1 }, (_, i) => {
    const fecha = sumarDias(inicio, i);
    return { fecha, delMes: fecha.slice(0, 7) === primero.slice(0, 7), equipos: porDia.get(fecha) ?? [] };
  });
}
