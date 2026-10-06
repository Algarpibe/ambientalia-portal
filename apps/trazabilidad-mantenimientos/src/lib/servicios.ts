/**
 * Geometría y textos de la pestaña «Servicios» (lista y calendario de barras).
 * Puro: sin React ni red. La fecha límite, los días hábiles y el estado de
 * cada servicio NO se calculan aquí: llegan del servidor, que es quien conoce
 * los festivos; aquí sólo se colocan en columnas, se cuentan y se redactan.
 */
import { RETROCESO_MAX_DIAS, claveTipoServicio, diasEntre, sumarDias, type EstadoPlazo, type ServicioVista } from '../dominio';
import { MESES_CORTOS } from './vistas';

/** Días en blanco que se dejan tras la última fecha límite (o tras hoy). */
export const MARGEN_EJE_DIAS = 5;
/** Días hacia atrás que enseña el eje cuando ningún servicio tiene barra. */
export const EJE_VACIO_DIAS = 7;

/** Clases por estado del plazo. Literales completos: Tailwind sólo genera las clases que lee tal cual. */
export const TONO_PLAZO: Record<EstadoPlazo, { badge: string; dot: string; text: string; barra: string }> = {
  VENCIDO: { badge: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500', text: 'text-red-600', barra: 'bg-red-500' },
  VENCE_HOY: { badge: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-400', text: 'text-amber-700', barra: 'bg-amber-400' },
  EN_PLAZO: { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-700', barra: 'bg-emerald-500' },
  SIN_PLAZO: { badge: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400', text: 'text-slate-500', barra: 'bg-slate-300' },
};

/** «quedan 2 d háb.» / «vence hoy» / «vencido hace 3 d háb.» / «sin plazo». */
export function textoPlazo(s: ServicioVista): string {
  const d = s.diasHabiles ?? 0;
  switch (s.estadoPlazo) {
    case 'SIN_PLAZO':
      return 'sin plazo';
    case 'VENCE_HOY':
      return 'vence hoy';
    case 'EN_PLAZO':
      return `quedan ${d} d háb.`;
    case 'VENCIDO':
      // En fin de semana o festivo el límite ya pasó, pero aún no corre ningún día hábil de atraso.
      return d < 0 ? `vencido hace ${-d} d háb.` : 'vencido';
  }
}

const RANGO: Record<EstadoPlazo, number> = { VENCIDO: 0, VENCE_HOY: 1, EN_PLAZO: 2, SIN_PLAZO: 3 };

/** Más atraso primero, después lo que vence antes; los «sin plazo» al final, del ticket más nuevo al más viejo. */
export const porUrgenciaPlazo = (a: ServicioVista, b: ServicioVista): number =>
  RANGO[a.estadoPlazo] - RANGO[b.estadoPlazo] || (a.diasHabiles ?? 0) - (b.diasHabiles ?? 0) || b.numero - a.numero;

export interface ResumenServicios {
  total: number;
  conPlazo: number;
  /** Tickets que Desk manda sin tipo de servicio: no pueden tener plazo. */
  sinTipo: number;
  sinConfirmar: number;
  /** Tipos que sí vienen pero no tienen plazo en Configuración. */
  tiposSinPlazo: string[];
}

export function resumenServicios(servicios: readonly ServicioVista[]): ResumenServicios {
  const tipos = new Map<string, string>();
  let conPlazo = 0;
  let sinTipo = 0;
  let sinConfirmar = 0;
  for (const s of servicios) {
    const clave = claveTipoServicio(s.tipoServicio);
    if (s.fechaLimite) conPlazo++;
    if (!clave) sinTipo++;
    else if (s.plazoDias === null && !tipos.has(clave)) tipos.set(clave, s.tipoServicio.trim());
    if (s.sinConfirmar) sinConfirmar++;
  }
  return {
    total: servicios.length,
    conPlazo,
    sinTipo,
    sinConfirmar,
    tiposSinPlazo: [...tipos.values()].sort((a, b) => a.localeCompare(b, 'es')),
  };
}

/** Eje de tiempo del calendario: una columna por día, de `inicio` a `fin` (ambos incluidos). */
export interface Eje {
  inicio: string;
  fin: string;
  dias: number;
}

const tieneBarra = (s: ServicioVista): s is ServicioVista & { ingreso: string; fechaLimite: string } => Boolean(s.ingreso && s.fechaLimite);

/**
 * El eje que hace falta para pintar los servicios con plazo: desde un día antes
 * del primer ingreso —sin retroceder más de RETROCESO_MAX_DIAS desde hoy, para
 * que un ticket antiguo no lo aplaste todo— hasta unos días después de la
 * última fecha límite, o de hoy si todo está vencido.
 */
export function ejeServicios(servicios: readonly ServicioVista[], hoy: string): Eje {
  const conBarra = servicios.filter(tieneBarra);
  let inicio = sumarDias(hoy, -EJE_VACIO_DIAS);
  let ultimo = hoy;
  if (conBarra.length) {
    const primero = conBarra.reduce((min, s) => (s.ingreso < min ? s.ingreso : min), hoy);
    const tope = sumarDias(hoy, -RETROCESO_MAX_DIAS);
    inicio = sumarDias(primero, -1);
    if (inicio < tope) inicio = tope;
    ultimo = conBarra.reduce((max, s) => (s.fechaLimite > max ? s.fechaLimite : max), hoy);
  }
  const fin = sumarDias(ultimo, MARGEN_EJE_DIAS);
  return { inicio, fin, dias: diasEntre(inicio, fin) + 1 };
}

/** Columna (0 = `eje.inicio`) de una fecha; puede caer fuera del eje. */
export const columna = (eje: Eje, fecha: string): number => diasEntre(eje.inicio, fecha);

/** Tramo de columnas, ambas incluidas. */
export interface Tramo {
  desde: number;
  hasta: number;
}

export interface Barra {
  /** Del ingreso a la fecha límite; null si todo el plazo cae antes del eje. */
  plazo: Tramo | null;
  /** Del día siguiente a la fecha límite hasta hoy, si está vencido. */
  atraso: Tramo | null;
  /** True si el ingreso es anterior al eje: la barra empieza cortada por la izquierda. */
  recortada: boolean;
}

/** Recorta un tramo al eje; null si queda entero fuera. */
function recortar(eje: Eje, desde: number, hasta: number): Tramo | null {
  const t = { desde: Math.max(desde, 0), hasta: Math.min(hasta, eje.dias - 1) };
  return t.desde <= t.hasta ? t : null;
}

/** La barra de un servicio sobre el eje, o null si no tiene plazo. */
export function barraServicio(s: ServicioVista, eje: Eje, hoy: string): Barra | null {
  if (!tieneBarra(s)) return null;
  const limite = columna(eje, s.fechaLimite);
  return {
    plazo: recortar(eje, columna(eje, s.ingreso), limite),
    atraso: s.fechaLimite < hoy ? recortar(eje, limite + 1, columna(eje, hoy)) : null,
    recortada: s.ingreso < eje.inicio,
  };
}

export interface DiaEje {
  fecha: string;
  /** Día del mes. */
  dia: number;
  /** False en sábado, domingo o festivo. */
  habil: boolean;
}

/** Las columnas del eje, con los días no hábiles marcados (los festivos los manda el servidor). */
export function diasDelEje(eje: Eje, festivos: readonly string[]): DiaEje[] {
  const f = new Set(festivos);
  return Array.from({ length: eje.dias }, (_, i) => {
    const fecha = sumarDias(eje.inicio, i);
    const dow = new Date(`${fecha}T00:00:00Z`).getUTCDay();
    return { fecha, dia: Number(fecha.slice(8)), habil: dow !== 0 && dow !== 6 && !f.has(fecha) };
  });
}

/** Los meses que cruza el eje, cada uno con su tramo de columnas (cabecera del calendario). */
export function mesesDelEje(eje: Eje): (Tramo & { etiqueta: string })[] {
  const out: (Tramo & { etiqueta: string })[] = [];
  for (let i = 0; i < eje.dias; i++) {
    const [y, m] = sumarDias(eje.inicio, i).split('-').map(Number);
    const etiqueta = `${MESES_CORTOS[m - 1]} ${y}`;
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.etiqueta === etiqueta) ultimo.hasta = i;
    else out.push({ etiqueta, desde: i, hasta: i });
  }
  return out;
}
