import { describe, it, expect } from 'vitest';
import type { ReconciledRow } from '../types';
import { computeDelinquencyBands, bandShares, BAND_KEYS } from './delinquencyBreakdown';

function row(over: Partial<ReconciledRow> = {}): ReconciledRow {
  return {
    invoiceNumber: 'INV', orderNumber: 'OC', clientName: 'ACME',
    invoiceDate: '1 ene 2025', dueDate: '1 ene 2025', status: 'paid',
    total: 100, balance: 0,
    paymentDates: [], paymentAmounts: [], totalPaid: 0,
    isOverdue: false, maxDelayDays: 0, paymentDetails: [],
    ...over,
  };
}

const late = (delay: number, over: Partial<ReconciledRow> = {}) =>
  row({ dueDate: '10 mar 2025', paymentDetails: [{ date: 'x', delay }], ...over });

const TODAY = new Date(2026, 8, 29);

describe('computeDelinquencyBands', () => {
  it('puts each DPD into its band, with the right boundaries', () => {
    const [y] = computeDelinquencyBands(
      [0, 1, 15, 16, 30, 31, 60, 61, 200].map((d) => late(d)),
      TODAY,
    );
    expect(y).toMatchObject({
      year: 2025, total: 9,
      onTime: 1, d1_15: 2, d16_30: 2, d31_60: 2, over60: 2,
      isPartialYear: false,
    });
  });

  it('groups by due-date year, sorts ascending and flags the current year', () => {
    const result = computeDelinquencyBands(
      [late(0, { dueDate: '5 ene 2026' }), late(0), late(20)],
      TODAY,
    );
    expect(result.map((r) => [r.year, r.total, r.isPartialYear])).toEqual([
      [2025, 2, false],
      [2026, 1, true],
    ]);
  });

  it('uses the shared universe (void, not-yet-due and 2020 are excluded)', () => {
    const result = computeDelinquencyBands(
      [
        late(5, { status: 'void' }),
        late(5, { dueDate: '15 oct 2026', balance: 10 }),
        late(5, { dueDate: '10 mar 2020' }),
      ],
      TODAY,
    );
    expect(result).toEqual([]);
  });
});

describe('bandShares', () => {
  it('turns counts into percentages that add up to 100', () => {
    const [y] = computeDelinquencyBands([late(0), late(0), late(10), late(90)], TODAY);
    const shares = bandShares(y);
    expect(shares).toEqual({ onTime: 50, d1_15: 25, d16_30: 0, d31_60: 0, over60: 25 });
    expect(BAND_KEYS.reduce((s, k) => s + shares[k], 0)).toBe(100);
  });

  it('returns zeros for an empty year', () => {
    expect(bandShares({ year: 2025, total: 0, onTime: 0, d1_15: 0, d16_30: 0, d31_60: 0, over60: 0, isPartialYear: false }))
      .toEqual({ onTime: 0, d1_15: 0, d16_30: 0, d31_60: 0, over60: 0 });
  });
});
