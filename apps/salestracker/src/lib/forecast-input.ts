import type { SalesRow, RecordType } from '../api';
import type { ForecastInput } from './forecast';

/** Suma mensual (12) de un año/tipo desde el feed de ventas. */
export function monthlyByYear(rows: SalesRow[], year: number, tipo: RecordType): number[] {
  const m = new Array(12).fill(0) as number[];
  for (const r of rows) {
    if (r.year === year && r.recordType === tipo && r.month >= 1 && r.month <= 12) m[r.month - 1] += r.amountUsd;
  }
  return m;
}

/** Ensambla el ForecastInput para el año A (vs A-1, estacionalidad de A-1..A-3, pesos [3,2,1]). `now` se inyecta para testear. */
export function buildForecastInput(
  rows: SalesRow[],
  opts: { yearA: number; tipo: RecordType; now: Date },
): ForecastInput {
  const { yearA, tipo, now } = opts;
  return {
    currentYearMonthly: monthlyByYear(rows, yearA, tipo),
    lastYearMonthly: monthlyByYear(rows, yearA - 1, tipo),
    historicalMatrix: [yearA - 1, yearA - 2, yearA - 3].map((y) => monthlyByYear(rows, y, tipo)),
    weights: [3, 2, 1],
    now: {
      monthIdx: now.getMonth(),
      day: now.getDate(),
      daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
    },
    isCurrentActualYear: yearA === now.getFullYear(),
  };
}
