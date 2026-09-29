import type { ReconciledRow } from '../types';
import { calculateInvoiceDPD, parseExcelDate } from '../customerAnalysisUtils';

/**
 * Yearly delinquency trend for the KPIs tab.
 *
 * - An invoice belongs to the year of its DUE date (delinquency starts there).
 * - Only invoices already due before `today` count. Invoices not yet due would
 *   count as 0 days and make the current year look artificially better.
 * - The weighted average covers ALL due invoices (on-time ones weigh 0 days).
 *   It is NOT the "Índice de Severidad" (weightedDPD in customerAnalysisUtils),
 *   which only averages invoices already in arrears.
 */
export interface YearlyTrendRow {
  year: number;
  invoiceCount: number;
  averageDPD: number;
  weightedDPD: number;
  onTimePercentage: number;
  isPartialYear: boolean;
}

interface YearAccumulator {
  count: number;
  dpdSum: number;
  weightedSum: number;
  valueSum: number;
  onTime: number;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function computeYearlyTrend(rows: ReconciledRow[], today: Date): YearlyTrendRow[] {
  const cutoff = startOfDay(today);
  const byYear = new Map<number, YearAccumulator>();

  for (const row of rows) {
    const due = row.dueDate instanceof Date ? row.dueDate : parseExcelDate(row.dueDate);
    if (!due || startOfDay(due) >= cutoff) continue;

    const raw = calculateInvoiceDPD(row, cutoff);
    const dpd = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    const value = Number.isFinite(row.total) && row.total > 0 ? row.total : 0;
    const acc = byYear.get(due.getFullYear()) ?? { count: 0, dpdSum: 0, weightedSum: 0, valueSum: 0, onTime: 0 };
    acc.count += 1;
    acc.dpdSum += dpd;
    acc.weightedSum += dpd * value;
    acc.valueSum += value;
    if (dpd === 0) acc.onTime += 1;
    byYear.set(due.getFullYear(), acc);
  }

  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, acc]) => ({
      year,
      invoiceCount: acc.count,
      averageDPD: acc.dpdSum / acc.count,
      weightedDPD: acc.valueSum > 0 ? acc.weightedSum / acc.valueSum : 0,
      onTimePercentage: (acc.onTime / acc.count) * 100,
      isPartialYear: year === today.getFullYear(),
    }));
}
