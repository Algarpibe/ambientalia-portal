import type { ReconciledRow } from '../types';
import { collectDueInvoices } from './yearlyTrendMetrics';

// Breakdowns that explain the yearly DPD trend. Both use the shared universe of
// collectDueInvoices, so they always agree with the trend itself.

export const BAND_KEYS = ['onTime', 'd1_15', 'd16_30', 'd31_60', 'over60'] as const;
export type BandKey = (typeof BAND_KEYS)[number];

export interface DelinquencyBandRow extends Record<BandKey, number> {
  year: number;
  total: number;
  isPartialYear: boolean;
}

const bandOf = (dpd: number): BandKey => {
  if (dpd <= 0) return 'onTime';
  if (dpd <= 15) return 'd1_15';
  if (dpd <= 30) return 'd16_30';
  if (dpd <= 60) return 'd31_60';
  return 'over60';
};

/** Invoice count per delinquency band, per due-date year (ascending). */
export function computeDelinquencyBands(rows: ReconciledRow[], today: Date): DelinquencyBandRow[] {
  const byYear = new Map<number, DelinquencyBandRow>();
  for (const { year, dpd } of collectDueInvoices(rows, today)) {
    const acc = byYear.get(year) ?? {
      year, total: 0, onTime: 0, d1_15: 0, d16_30: 0, d31_60: 0, over60: 0,
      isPartialYear: year === today.getFullYear(),
    };
    acc.total += 1;
    acc[bandOf(dpd)] += 1;
    byYear.set(year, acc);
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/** Share (%) of the year's invoices in each band; zeros when the year is empty. */
export function bandShares(row: DelinquencyBandRow): Record<BandKey, number> {
  const share = (n: number) => (row.total > 0 ? (n / row.total) * 100 : 0);
  return {
    onTime: share(row.onTime),
    d1_15: share(row.d1_15),
    d16_30: share(row.d16_30),
    d31_60: share(row.d31_60),
    over60: share(row.over60),
  };
}
