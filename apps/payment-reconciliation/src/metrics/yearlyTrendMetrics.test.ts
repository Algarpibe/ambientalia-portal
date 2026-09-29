import { describe, it, expect } from 'vitest';
import type { ReconciledRow } from '../types';
import { computeYearlyTrend, collectDueInvoices, EXCLUDED_YEARS } from './yearlyTrendMetrics';

function row(over: Partial<ReconciledRow> = {}): ReconciledRow {
  return {
    invoiceNumber: 'INV', orderNumber: 'OC', clientName: 'ACME',
    invoiceDate: '1 ene 2025', dueDate: '1 ene 2025', status: 'paid',
    total: 0, balance: 0,
    paymentDates: [], paymentAmounts: [], totalPaid: 0,
    isOverdue: false, maxDelayDays: 0, paymentDetails: [],
    ...over,
  };
}

const paidWithDelay = (delay: number) => [{ date: '01/01/2025', delay }];
const TODAY = new Date(2026, 8, 29); // 29 Sep 2026

const DATASET: ReconciledRow[] = [
  row({ invoiceNumber: 'A', dueDate: '10 mar 2025', total: 100, paymentDetails: paidWithDelay(10) }),
  row({ invoiceNumber: 'B', dueDate: '20 jun 2025', total: 300, paymentDetails: paidWithDelay(0) }),
  row({ invoiceNumber: 'G', invoiceDate: '20 dic 2024', dueDate: '19 ene 2025', total: 100, paymentDetails: paidWithDelay(0) }),
  row({ invoiceNumber: 'C', dueDate: '5 ene 2026', total: 200, paymentDetails: paidWithDelay(30) }),
  row({ invoiceNumber: 'D', dueDate: '15 sep 2026', total: 50, balance: 50 }),
  row({ invoiceNumber: 'E', dueDate: '15 oct 2026', total: 999, balance: 999 }),
  row({ invoiceNumber: 'F', dueDate: null, total: 999 }),
];

describe('computeYearlyTrend', () => {
  const result = computeYearlyTrend(DATASET, TODAY);
  const byYear = (y: number) => result.find((r) => r.year === y)!;

  it('groups by due-date year and sorts years ascending', () => {
    expect(result.map((r) => r.year)).toEqual([2025, 2026]);
  });

  it('uses the due-date year, not the invoice-date year', () => {
    expect(result.find((r) => r.year === 2024)).toBeUndefined();
    expect(byYear(2025).invoiceCount).toBe(3);
  });

  it('excludes invoices not yet due and unreadable due dates', () => {
    expect(byYear(2026).invoiceCount).toBe(2);
  });

  it('computes the simple average DPD', () => {
    expect(byYear(2025).averageDPD).toBeCloseTo(10 / 3, 5);
    expect(byYear(2026).averageDPD).toBeCloseTo(22, 5);
  });

  it('computes the value-weighted average DPD over all due invoices', () => {
    expect(byYear(2025).weightedDPD).toBeCloseTo(2, 5);
    expect(byYear(2026).weightedDPD).toBeCloseTo(26.8, 5);
  });

  it('computes the on-time percentage', () => {
    expect(byYear(2025).onTimePercentage).toBeCloseTo(200 / 3, 5);
    expect(byYear(2026).onTimePercentage).toBe(0);
  });

  it('flags only the current year as partial', () => {
    expect(byYear(2025).isPartialYear).toBe(false);
    expect(byYear(2026).isPartialYear).toBe(true);
  });

  it('treats a negative DPD as 0 days and on time', () => {
    const [only] = computeYearlyTrend(
      [row({ dueDate: '1 feb 2025', total: 100, paymentDetails: paidWithDelay(-3) })],
      TODAY,
    );
    expect(only.averageDPD).toBe(0);
    expect(only.onTimePercentage).toBe(100);
  });

  it('returns a weighted DPD of 0 when the year has no invoice value', () => {
    const [only] = computeYearlyTrend(
      [row({ dueDate: '1 feb 2025', total: 0, paymentDetails: paidWithDelay(12) })],
      TODAY,
    );
    expect(only.weightedDPD).toBe(0);
    expect(only.averageDPD).toBe(12);
  });

  it('excludes an invoice due today (not yet overdue)', () => {
    expect(computeYearlyTrend([row({ dueDate: '29 sep 2026', total: 10, balance: 10 })], TODAY)).toEqual([]);
  });

  it('returns an empty list for no data', () => {
    expect(computeYearlyTrend([], TODAY)).toEqual([]);
  });

  it('ignores a non-numeric total in the weighting but still counts the invoice', () => {
    const [only] = computeYearlyTrend(
      [
        row({ invoiceNumber: 'P', dueDate: '1 feb 2025', total: 100, paymentDetails: paidWithDelay(10) }),
        row({ invoiceNumber: 'Q', dueDate: '2 feb 2025', total: NaN, paymentDetails: paidWithDelay(20) }),
      ],
      TODAY,
    );
    expect(only.weightedDPD).toBe(10);
    expect(only.averageDPD).toBe(15);
    expect(only.invoiceCount).toBe(2);
  });

  it('treats a NaN payment delay as 0 days', () => {
    const [only] = computeYearlyTrend(
      [row({ dueDate: '1 feb 2025', total: 100, paymentDetails: paidWithDelay(NaN) })],
      TODAY,
    );
    expect(only.averageDPD).toBe(0);
  });

  it('ignores the time of day of today', () => {
    const late = new Date(2026, 8, 29, 23, 59);
    const res = computeYearlyTrend(DATASET, late);
    expect(res).toEqual(result);
    expect(res.find((r) => r.year === 2026)!.invoiceCount).toBe(2);
    expect(res.find((r) => r.year === 2026)!.averageDPD).toBeCloseTo(22, 5);
    expect(computeYearlyTrend([row({ dueDate: '29 sep 2026', total: 10, balance: 10 })], late)).toEqual([]);
  });
});

describe('computeYearlyTrend with partial payments', () => {
  it('counts an invoice with an overdue balance as late even if the payment was on time', () => {
    const result = computeYearlyTrend(
      [row({ dueDate: '15 sep 2026', total: 1000, balance: 900, paymentDetails: [{ date: '01/09/2026', delay: 0 }] })],
      TODAY,
    );
    expect(result[0].year).toBe(2026);
    expect(result[0].averageDPD).toBe(14);
    expect(result[0].onTimePercentage).toBe(0);
  });
});

describe('computeYearlyTrend excludes void and draft invoices', () => {
  const normal = row({ invoiceNumber: 'N', dueDate: '10 mar 2025', total: 100, paymentDetails: paidWithDelay(0) });

  it('ignores a void invoice', () => {
    const result = computeYearlyTrend([normal, row({ invoiceNumber: 'V', dueDate: '10 mar 2025', status: 'void', total: 100 })], TODAY);
    expect(result[0].invoiceCount).toBe(1);
  });

  it('ignores a draft invoice with a balance', () => {
    const result = computeYearlyTrend([normal, row({ invoiceNumber: 'D', dueDate: '10 mar 2025', status: 'draft', total: 100, balance: 100 })], TODAY);
    expect(result[0].invoiceCount).toBe(1);
    expect(result[0].averageDPD).toBe(0);
  });

  it('matches the status ignoring case and surrounding spaces', () => {
    const result = computeYearlyTrend([normal, row({ invoiceNumber: 'V2', dueDate: '10 mar 2025', status: 'VOID ', total: 100 })], TODAY);
    expect(result[0].invoiceCount).toBe(1);
  });
});

describe('collectDueInvoices', () => {
  it('returns year, DPD and value for each due invoice', () => {
    const due = collectDueInvoices(
      [row({ invoiceNumber: 'A', dueDate: '10 mar 2025', total: 100, paymentDetails: paidWithDelay(10) })],
      TODAY,
    );
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ year: 2025, dpd: 10, value: 100 });
    expect(due[0].row.invoiceNumber).toBe('A');
  });

  it('applies the same exclusions as the yearly trend', () => {
    const due = collectDueInvoices(
      [
        row({ dueDate: '15 oct 2026', total: 1, balance: 1 }), // not due yet
        row({ dueDate: null }), // unreadable
        row({ dueDate: '1 feb 2025', status: 'void' }),
        row({ dueDate: '1 feb 2025', status: 'draft' }),
        row({ dueDate: '10 mar 2020', paymentDetails: paidWithDelay(3) }), // excluded year
      ],
      TODAY,
    );
    expect(due).toEqual([]);
  });
});

describe('excluded years', () => {
  it('leaves 2020 out of the yearly trend', () => {
    expect(EXCLUDED_YEARS).toContain(2020);
    const result = computeYearlyTrend(
      [row({ dueDate: '10 mar 2020', total: 10 }), row({ dueDate: '10 mar 2021', total: 10 })],
      TODAY,
    );
    expect(result.map((r) => r.year)).toEqual([2021]);
  });
});
