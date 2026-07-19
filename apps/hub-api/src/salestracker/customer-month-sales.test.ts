import { describe, it, expect } from 'vitest';
import { mapCustomerMonthRow } from './customer-month-sales.js';

describe('mapCustomerMonthRow', () => {
  it('coacciona', () => {
    expect(mapCustomerMonthRow({ customer: 'ACME', mes: '3', importe: '900.5' })).toEqual({ customer: 'ACME', mes: 3, importe: 900.5 });
  });
  it('importe no numérico → 0', () => {
    expect(mapCustomerMonthRow({ customer: 'X', mes: 1, importe: null }).importe).toBe(0);
  });
});
