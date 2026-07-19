import { describe, it, expect } from 'vitest';
import { mapSalesRow } from './sales.js';

describe('mapSalesRow', () => {
  it('coacciona los campos crudos del hub al contrato SalesRow', () => {
    const raw = {
      category_name: 'Equipos',
      record_type: 'INVOICE',
      record_month: '3',
      record_year: '2026',
      amount_usd: '1234.5',
    };
    expect(mapSalesRow(raw)).toEqual({
      categoryName: 'Equipos',
      recordType: 'INVOICE',
      month: 3,
      year: 2026,
      amountUsd: 1234.5,
    });
  });

  it('trata amount no numérico como 0', () => {
    const raw = { category_name: 'X', record_type: 'BACKLOG', record_month: 1, record_year: 2026, amount_usd: null };
    expect(mapSalesRow(raw).amountUsd).toBe(0);
  });
});
