import type { FacturaContable } from './api';

const MS_POR_DIA = 86_400_000;
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Días desde el epoch de una fecha YYYY-MM-DD, o null si no es una fecha legible. */
function diaDe(fecha: string): number | null {
  const m = FECHA.exec(fecha);
  if (!m) return null;
  // Date.UTC: la resta entre dos medianoches UTC siempre es un múltiplo exacto de un día.
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_POR_DIA;
}

/**
 * Días en cartera de una factura: hoy − fecha de vencimiento. Positivo = vencida hace N
 * días, 0 = vence hoy, negativo = faltan N días para el vencimiento. Solo tiene sentido
 * mientras quede saldo: una factura pagada (o sin fecha de vencimiento legible) da null.
 */
export function diasEnCartera(
  f: Pick<FacturaContable, 'porCobrar' | 'fechaVencimiento'>,
  hoy: string,
): number | null {
  if (f.porCobrar <= 0) return null;
  const venc = diaDe(f.fechaVencimiento);
  const hoyDia = diaDe(hoy);
  if (venc === null || hoyDia === null) return null;
  return hoyDia - venc;
}

/**
 * Fecha de hoy (YYYY-MM-DD) en la zona horaria del navegador. No usar
 * `toISOString()`: da la fecha UTC y en Colombia (UTC−5) a partir de las 7 p. m. ya
 * marca el día siguiente, lo que suma un día de cartera de más.
 */
export function hoyLocal(d: Date = new Date()): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}
