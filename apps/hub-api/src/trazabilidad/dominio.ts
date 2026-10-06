/**
 * Dominio de «Trazabilidad Mantenimientos Clientes» (GRIMM EDM 180).
 *
 * Puro: sin imports, sin Node, sin BD, sin UI. Lo usa el servidor para
 * clasificar y la app del portal lo importa por ruta relativa para pintar el
 * mismo estado sin repetir la regla (mismo patrón que el motor O3 de
 * calibraciones). `dominio.test.ts` vigila que no gane imports.
 *
 * La regla de vigencia es la de la hoja F-ST-022 «Trazabilidad Mttos Clientes»:
 *   Vigencia calibración (días) = (Última calibración − HOY) + 365
 * y la columna «Estado» de esa hoja marca 1 cuando la vigencia es < −365.
 */

/** Días de validez de una calibración (columna AD de la F-ST-022). */
export const VIGENCIA_DIAS = 365;

/** Umbrales del aviso escalonado (días de vigencia restantes). */
export const UMBRALES = { aviso30: 30, aviso60: 60, aviso90: 90 } as const;

export type EstadoCalibracion =
  | 'FUERA_CICLO' // vencida hace más de un año: la F-ST-022 la marca con Estado = 1
  | 'VENCIDA' // vencida en el último año: susceptible de llegada urgente
  | 'VENCE_30'
  | 'VENCE_60'
  | 'VENCE_90'
  | 'AL_DIA'
  | 'SIN_FECHA';

/** Orden de presentación: de lo más urgente a lo que no pide nada. */
export const ESTADOS: readonly EstadoCalibracion[] = [
  'FUERA_CICLO',
  'VENCIDA',
  'VENCE_30',
  'VENCE_60',
  'VENCE_90',
  'AL_DIA',
  'SIN_FECHA',
];

export const ETIQUETA_ESTADO: Record<EstadoCalibracion, string> = {
  FUERA_CICLO: 'Vencida +1 año',
  VENCIDA: 'Vencida',
  VENCE_30: 'Vence ≤ 30 días',
  VENCE_60: 'Vence 31–60 días',
  VENCE_90: 'Vence 61–90 días',
  AL_DIA: 'Al día',
  SIN_FECHA: 'Sin fecha',
};

/** Estados que piden aviso previo al cliente (o llegada urgente). */
export const ESTADOS_AVISO: readonly EstadoCalibracion[] = ['VENCIDA', 'VENCE_30', 'VENCE_60', 'VENCE_90'];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True si `s` es una fecha de calendario real en formato AAAA-MM-DD. */
export function esFechaIso(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function aUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** `iso` + `n` días, en AAAA-MM-DD (aritmética en UTC: sin saltos de horario). */
export function sumarDias(iso: string, n: number): string {
  return new Date(aUtc(iso) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Días de `desde` a `hasta` (positivo si `hasta` es posterior). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta) - aUtc(desde)) / 86_400_000);
}

export interface EstadoEquipo {
  /** Fecha en que se cumple la vigencia (última calibración + 365 días). */
  vence: string | null;
  /** Días de vigencia restantes; negativo = vencida hace N días. */
  vigenciaDias: number | null;
  estado: EstadoCalibracion;
}

/** Clasifica un equipo según su última calibración, a fecha `hoy` (AAAA-MM-DD). */
export function estadoCalibracion(ultimaCalibracion: string | null, hoy: string): EstadoEquipo {
  if (!ultimaCalibracion || !esFechaIso(ultimaCalibracion)) return { vence: null, vigenciaDias: null, estado: 'SIN_FECHA' };
  const vence = sumarDias(ultimaCalibracion, VIGENCIA_DIAS);
  const v = diasEntre(hoy, vence);
  const estado: EstadoCalibracion =
    v < -VIGENCIA_DIAS
      ? 'FUERA_CICLO'
      : v < 0
        ? 'VENCIDA'
        : v <= UMBRALES.aviso30
          ? 'VENCE_30'
          : v <= UMBRALES.aviso60
            ? 'VENCE_60'
            : v <= UMBRALES.aviso90
              ? 'VENCE_90'
              : 'AL_DIA';
  return { vence, vigenciaDias: v, estado };
}

/**
 * Normaliza el modelo tal como viene escrito en la hoja («EDM 180C»,
 * «EDM180C», «edm 180 d»…) y devuelve «EDM 180C» / «EDM 180D», o null si no
 * es un EDM 180 (el EDM 280, el 1109 o el WS600 quedan fuera).
 */
export function modeloEdm180(modelo: unknown): string | null {
  const m = String(modelo ?? '').toUpperCase().replace(/\s+/g, '');
  if (!m.startsWith('EDM180')) return null;
  return `EDM 180${m.slice(6)}`;
}

/** Un serial convertido en clave estable (letras, dígitos, _ y -). */
export function claveSerial(serial: string): string {
  return serial.trim().replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Asigna una clave estable a cada fila. La F-ST-022 repite algún serial en dos
 * clientes (p. ej. 18A00004); la primera aparición se queda con el serial y las
 * siguientes llevan sufijo «-2», «-3», en el orden de la hoja.
 */
export function asignarClaves(seriales: readonly string[]): string[] {
  const visto = new Map<string, number>();
  return seriales.map((s) => {
    const base = claveSerial(s);
    const n = (visto.get(base) ?? 0) + 1;
    visto.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}
