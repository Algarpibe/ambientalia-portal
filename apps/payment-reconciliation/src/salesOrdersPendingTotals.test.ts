import { describe, it, expect } from 'vitest';
import { pendingTotals } from './salesOrdersPendingTotals';

const o = (currency_code: string | null, pending: number) => ({ currency_code, pending });

describe('pendingTotals', () => {
  it('sums COP only and counts foreign orders with pending balance', () => {
    expect(pendingTotals([o('COP', 100), o(null, 50), o('usd', 900), o('EUR', 0)])).toEqual({
      copPending: 150,
      foreignCount: 1,
    });
  });

  it('is zero for an empty list', () => {
    expect(pendingTotals([])).toEqual({ copPending: 0, foreignCount: 0 });
  });
});
