import type { ReconciledRow } from '../types';
import { calculateInvoiceDPD, parseExcelDate } from '../customerAnalysisUtils';
import { isCop } from '../currency';

/**
 * Yearly delinquency trend for the KPIs tab.
 *
 * - An invoice belongs to the year of its DUE date (delinquency starts there).
 * - Void and draft invoices are excluded: they are not real receivables.
 * - Only invoices already due before `today` count. Invoices not yet due would
 *   count as 0 days and make the current year look artificially better.
 * - The weighted average covers ALL due invoices (on-time ones weigh 0 days).
 *   It is NOT the "Índice de Severidad" (weightedDPD in customerAnalysisUtils),
 *   which only averages invoices already in arrears.
 * - Years in EXCLUDED_YEARS (incomplete history) are left out.
 */
export interface YearlyTrendRow {
  year: number;
  invoiceCount: number;
  averageDPD: number;
  weightedDPD: number;
  onTimePercentage: number;
  onTimeValuePercentage: number;
  /** Mean days from invoice date to collection (or to today while owed); null without data. */
  averageCollectionDays: number | null;
  weightedCollectionDays: number | null;
  isPartialYear: boolean;
}

/** Years with incomplete invoice history; comparing them with full years would distort the trend. */
export const EXCLUDED_YEARS: readonly number[] = [2020];

/** One invoice of the shared KPI universe, with its due-date year, DPD and weight. */
export interface DueInvoice {
  row: ReconciledRow;
  year: number;
  dpd: number;
  value: number;
  /** Invoice date → last payment (or → today while a balance is owed), ≥ 0; null if a date is missing. */
  collectionDays: number | null;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * The invoices every KPI is computed on: due strictly before `today`, not void
 * or draft, not in an excluded year. DPD is measured at the start of `today`.
 * Non-COP invoices keep their DPD, on-time flag and collection days (count-based
 * metrics include them) but carry value 0: amounts are not converted, so they
 * must not weigh in value-weighted metrics.
 */
export function collectDueInvoices(rows: ReconciledRow[], today: Date): DueInvoice[] {
  const cutoff = startOfDay(today);
  const result: DueInvoice[] = [];

  for (const row of rows) {
    const status = (row.status ?? '').trim().toLowerCase();
    if (status === 'void' || status === 'draft') continue;

    const due = row.dueDate instanceof Date ? row.dueDate : parseExcelDate(row.dueDate);
    if (!due || startOfDay(due) >= cutoff) continue;

    const year = due.getFullYear();
    if (EXCLUDED_YEARS.includes(year)) continue;

    const raw = calculateInvoiceDPD(row, cutoff);
    const dpd = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    const value = isCop(row) && Number.isFinite(row.total) && row.total > 0 ? row.total : 0;
    const issued = row.invoiceDate instanceof Date ? row.invoiceDate : parseExcelDate(row.invoiceDate);
    const collectedAt = row.balance > 0 ? cutoff : row.lastPaymentDate ?? null;
    const collectionDays =
      issued && collectedAt
        ? Math.max(0, Math.round((startOfDay(collectedAt).getTime() - startOfDay(issued).getTime()) / DAY_MS))
        : null;
    result.push({ row, year, dpd, value, collectionDays });
  }

  return result;
}

interface YearAccumulator {
  count: number;
  dpdSum: number;
  weightedSum: number;
  valueSum: number;
  onTime: number;
  onTimeValue: number;
  collectionCount: number;
  collectionSum: number;
  collectionWeightedSum: number;
  collectionValueSum: number;
}

export function computeYearlyTrend(rows: ReconciledRow[], today: Date): YearlyTrendRow[] {
  const byYear = new Map<number, YearAccumulator>();

  for (const { year, dpd, value, collectionDays } of collectDueInvoices(rows, today)) {
    const acc = byYear.get(year) ?? { count: 0, dpdSum: 0, weightedSum: 0, valueSum: 0, onTime: 0,
      onTimeValue: 0, collectionCount: 0, collectionSum: 0, collectionWeightedSum: 0, collectionValueSum: 0 };
    acc.count += 1;
    acc.dpdSum += dpd;
    acc.weightedSum += dpd * value;
    acc.valueSum += value;
    if (dpd === 0) acc.onTime += 1;
    if (dpd === 0) acc.onTimeValue += value;
    if (collectionDays !== null) {
      acc.collectionCount += 1;
      acc.collectionSum += collectionDays;
      acc.collectionWeightedSum += collectionDays * value;
      acc.collectionValueSum += value;
    }
    byYear.set(year, acc);
  }

  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, acc]) => ({
      year,
      invoiceCount: acc.count,
      averageDPD: acc.dpdSum / acc.count,
      weightedDPD: acc.valueSum > 0 ? acc.weightedSum / acc.valueSum : 0,
      onTimePercentage: (acc.onTime / acc.count) * 100,
      onTimeValuePercentage: acc.valueSum > 0 ? (acc.onTimeValue / acc.valueSum) * 100 : 0,
      averageCollectionDays: acc.collectionCount > 0 ? acc.collectionSum / acc.collectionCount : null,
      weightedCollectionDays: acc.collectionValueSum > 0 ? acc.collectionWeightedSum / acc.collectionValueSum : null,
      isPartialYear: year === today.getFullYear(),
    }));
}
