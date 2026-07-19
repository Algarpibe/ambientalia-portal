import { describe, it, expect } from 'vitest';
import { totalsByCategory, grandTotal } from './rollup';
import type { SalesRow } from '../api';

const rows: SalesRow[] = [
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 100 },
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 2, year: 2026, amountUsd: 50 },
  { categoryName: 'Servicios', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 30 },
  { categoryName: 'Equipos', recordType: 'BACKLOG', month: 1, year: 2026, amountUsd: 999 },
];

describe('totalsByCategory', () => {
  it('suma amountUsd por categoría para el tipo dado', () => {
    expect(totalsByCategory(rows, 'INVOICE')).toEqual([
      { categoryName: 'Equipos', total: 150 },
      { categoryName: 'Servicios', total: 30 },
    ]);
  });
});

describe('grandTotal', () => {
  it('suma todo el amountUsd del tipo dado', () => {
    expect(grandTotal(rows, 'INVOICE')).toBe(180);
  });
});
