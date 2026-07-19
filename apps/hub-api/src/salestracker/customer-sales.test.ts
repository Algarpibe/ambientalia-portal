import { describe, it, expect } from 'vitest';
import { mapCustomerYearRow } from './customer-sales.js';

describe('mapCustomerYearRow', () => {
  it('coacciona una fila cruda al contrato CustomerYearRow', () => {
    const raw = { customer: 'ACME', year: '2026', ventas: '9990.5' };
    expect(mapCustomerYearRow(raw)).toEqual({ customer: 'ACME', year: 2026, ventas: 9990.5 });
  });
  it('ventas no numérico → 0', () => {
    expect(mapCustomerYearRow({ customer: 'X', year: 2025, ventas: null }).ventas).toBe(0);
  });
});
