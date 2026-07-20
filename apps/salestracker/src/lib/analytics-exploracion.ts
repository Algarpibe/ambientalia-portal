import type { SalesRow, RecordType } from '../api';
import { MONTHS } from './format';

export const ST_CATEGORIES = [
  'Alquileres', 'CAL CO', 'CAL NOx', 'CAL O3', 'CAL PM', 'CAL SO2', 'ST',
  'ST APMA', 'ST APNA', 'ST APOA', 'ST APSA', 'ST EDM 180',
];
export const CR_CATEGORIES = [
  'C&R AP Series', 'C&R APMA-370', 'C&R APNA-370', 'C&R APOA-370', 'C&R APSA-370',
  'C&R D-R 290', 'C&R EDM 180', 'C&R ENDA Series', 'C&R Enviro', 'C&R OCMA-500',
  'C&R PG Series', 'C&R Series 6103', 'C&R Series 7000', 'C&R Shelter', 'C&R U-50 Series',
];

export type TechViewMode = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
export interface TechSlot { label: string; months: number[] }
export interface TechPoint {
  label: string; st: number; cr: number; total: number; acum: number;
  st_prev: number; cr_prev: number; total_prev: number; acum_prev: number;
}

export function slotsForViewMode(mode: TechViewMode): TechSlot[] {
  if (mode === 'MONTHLY') return MONTHS.map((m, i) => ({ label: m, months: [i + 1] }));
  if (mode === 'QUARTERLY') return [
    { label: 'T1', months: [1, 2, 3] }, { label: 'T2', months: [4, 5, 6] },
    { label: 'T3', months: [7, 8, 9] }, { label: 'T4', months: [10, 11, 12] },
  ];
  return [{ label: 'Anual', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }];
}

const stSet = new Set(ST_CATEGORIES);
const crSet = new Set(CR_CATEGORIES);

/** Serie ST/C&R por slot (año A) con comparativa del año B y acumulados. Ignora categorías fuera de ST/C&R. */
export function buildTechService(
  rows: SalesRow[],
  opts: { yearA: number; yearB: number; tipo: RecordType; viewMode: TechViewMode },
): TechPoint[] {
  const { yearA, yearB, tipo, viewMode } = opts;
  const slots = slotsForViewMode(viewMode);
  let acum = 0, acum_prev = 0;
  return slots.map((slot) => {
    let st = 0, cr = 0, st_prev = 0, cr_prev = 0;
    for (const r of rows) {
      if (r.recordType !== tipo || !slot.months.includes(r.month)) continue;
      const isST = stSet.has(r.categoryName);
      const isCR = crSet.has(r.categoryName);
      if (!isST && !isCR) continue;
      // Pasadas independientes: yearA y yearB se cuentan por separado (si yearA===yearB → prev==current → YoY 0%).
      if (r.year === yearA) { if (isST) st += r.amountUsd; else cr += r.amountUsd; }
      if (r.year === yearB) { if (isST) st_prev += r.amountUsd; else cr_prev += r.amountUsd; }
    }
    const total = st + cr, total_prev = st_prev + cr_prev;
    acum += total; acum_prev += total_prev;
    return { label: slot.label, st, cr, total, acum, st_prev, cr_prev, total_prev, acum_prev };
  });
}

/** YoY % (null si base 0 y actual 0). */
export function yoy(current: number, prev: number): number | null {
  if (prev === 0) return current > 0 ? 100 : null;
  return ((current - prev) / prev) * 100;
}
