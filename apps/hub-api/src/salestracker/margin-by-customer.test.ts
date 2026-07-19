import { describe, it, expect } from 'vitest';
import { mapMarginCustomerRow } from './margin-by-customer.js';

describe('mapMarginCustomerRow', () => {
  it('coacciona', () => {
    expect(mapMarginCustomerRow({ customer: 'ACME', ventas: '1000', costo: '600' })).toEqual({ customer: 'ACME', ventas: 1000, costo: 600 });
  });
  it('no numéricos → 0', () => {
    expect(mapMarginCustomerRow({ customer: 'X', ventas: null, costo: 'x' })).toEqual({ customer: 'X', ventas: 0, costo: 0 });
  });
});
