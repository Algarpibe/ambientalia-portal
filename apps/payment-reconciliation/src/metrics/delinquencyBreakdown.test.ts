import { describe, it, expect } from 'vitest';
import type { ReconciledRow } from '../types';
import { computeDelinquencyBands, computeDelinquencyConcentration, bandShares, BAND_KEYS } from './delinquencyBreakdown';

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

describe('computeDelinquencyConcentration', () => {
  const inv = (clientName: string, total: number, delay: number, over: Partial<ReconciledRow> = {}) =>
    late(delay, { clientName, total, ...over });

  it('finds the fewest clients that add up to 80% of the weighted delinquency', () => {
    const [y] = computeDelinquencyConcentration(
      [inv('D', 1000, 5), inv('C', 100, 0), inv('B', 500, 10), inv('A', 1000, 30)],
      TODAY,
    );
    expect(y.year).toBe(2025);
    expect(y.totalClients).toBe(4);
    expect(y.clientsWithDelinquency).toBe(3);
    expect(y.clientsFor80).toBe(2);
    expect(y.topClients.map((c) => c.name)).toEqual(['A', 'B', 'D']);
    expect(y.topClients[0].share).toBeCloseTo(75, 5);
    expect(y.topClients[1].share).toBeCloseTo(12.5, 5);
  });

  it('adds up all invoices of the same client', () => {
    const [y] = computeDelinquencyConcentration(
      [inv('A', 100, 10), inv('A', 100, 10), inv('B', 100, 10)],
      TODAY,
    );
    expect(y.totalClients).toBe(2);
    expect(y.topClients[0]).toEqual({ name: 'A', share: expect.closeTo(200 / 3, 5) });
  });

  it('reports no concentration for a year without delinquency', () => {
    const [y] = computeDelinquencyConcentration([inv('A', 100, 0), inv('B', 100, 0)], TODAY);
    expect(y).toMatchObject({ totalClients: 2, clientsWithDelinquency: 0, clientsFor80: 0, topClients: [] });
  });

  it('names a blank client "Sin cliente"', () => {
    const [y] = computeDelinquencyConcentration([inv('  ', 100, 10)], TODAY);
    expect(y.topClients[0].name).toBe('Sin cliente');
  });

  it('flags the current year and sorts years ascending', () => {
    const result = computeDelinquencyConcentration(
      [inv('A', 100, 10, { dueDate: '5 ene 2026' }), inv('A', 100, 10)],
      TODAY,
    );
    expect(result.map((r) => [r.year, r.isPartialYear])).toEqual([[2025, false], [2026, true]]);
  });

  it('groups spelling variants of the same client and shows the first spelling', () => {
    const [y] = computeDelinquencyConcentration(
      [inv('ACME S.A.S', 100, 10), inv(' acme  s.a.s ', 100, 10), inv('Otro', 100, 10)],
      TODAY,
    );
    expect(y.totalClients).toBe(2);
    expect(y.topClients[0]).toEqual({ name: 'ACME S.A.S', share: expect.closeTo(200 / 3, 3) });
  });

  it('counts a client at exactly 80% despite float error', () => {
    const [y] = computeDelinquencyConcentration([inv('A', 80.1, 1), inv('B', 20.025, 1)], TODAY);
    expect(y.clientsFor80).toBe(1);
  });

  it('counts one client with 100% as one client', () => {
    const [y] = computeDelinquencyConcentration([inv('A', 100, 10)], TODAY);
    expect(y.clientsFor80).toBe(1);
  });

  it('keeps only the top 3 clients, in order', () => {
    const [y] = computeDelinquencyConcentration(
      [inv('E', 10, 1), inv('C', 30, 1), inv('A', 50, 1), inv('D', 20, 1), inv('B', 40, 1)],
      TODAY,
    );
    expect(y.clientsWithDelinquency).toBe(5);
    expect(y.topClients.map((c) => c.name)).toEqual(['A', 'B', 'C']);
  });
});
