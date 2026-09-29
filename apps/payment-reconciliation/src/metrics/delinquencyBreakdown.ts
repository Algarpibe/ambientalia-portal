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

export interface ClientShare {
  name: string;
  share: number; // % of the year's weighted delinquency
}

export interface ConcentrationRow {
  year: number;
  isPartialYear: boolean;
  totalClients: number;
  clientsWithDelinquency: number;
  /** Fewest clients whose weighted delinquency reaches 80% of the year's total. */
  clientsFor80: number;
  topClients: ClientShare[];
}

const CONCENTRATION_THRESHOLD = 0.8;
const TOP_CLIENTS = 3;

/**
 * How concentrated each year's delinquency is. A client's weight is
 * Σ (DPD × value) of its due invoices in that year.
 */
export function computeDelinquencyConcentration(rows: ReconciledRow[], today: Date): ConcentrationRow[] {
  const byYear = new Map<number, Map<string, number>>();
  for (const { row, year, dpd, value } of collectDueInvoices(rows, today)) {
    const name = (row.clientName ?? '').trim() || 'Sin cliente';
    const clients = byYear.get(year) ?? new Map<string, number>();
    clients.set(name, (clients.get(name) ?? 0) + dpd * value);
    byYear.set(year, clients);
  }

  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, clients]) => {
      const ranked = [...clients.entries()]
        .filter(([, weight]) => weight > 0)
        .sort(([nameA, a], [nameB, b]) => b - a || nameA.localeCompare(nameB, 'es'));
      const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);

      let clientsFor80 = 0;
      let cumulative = 0;
      for (const [, weight] of ranked) {
        if (total === 0 || cumulative >= total * CONCENTRATION_THRESHOLD) break;
        cumulative += weight;
        clientsFor80 += 1;
      }

      return {
        year,
        isPartialYear: year === today.getFullYear(),
        totalClients: clients.size,
        clientsWithDelinquency: ranked.length,
        clientsFor80,
        topClients: ranked.slice(0, TOP_CLIENTS).map(([name, weight]) => ({ name, share: (weight / total) * 100 })),
      };
    });
}
