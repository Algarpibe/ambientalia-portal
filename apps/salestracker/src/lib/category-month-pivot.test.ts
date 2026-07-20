import { describe, it, expect } from 'vitest';
import { availableYears, buildCategoryMonthPivot, pivotToCsv } from './category-month-pivot';
import type { SalesRow } from '../api';

const rows: SalesRow[] = [
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 100 },
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 2, year: 2026, amountUsd: 50 },
  { categoryName: 'Servicios', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 30 },
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 1, year: 2025, amountUsd: 999 }, // otro año
  { categoryName: 'Equipos', recordType: 'BACKLOG', month: 1, year: 2026, amountUsd: 999 }, // otro tipo
];

describe('availableYears', () => {
  it('devuelve los años presentes, desc', () => {
    expect(availableYears(rows)).toEqual([2026, 2025]);
  });
});

describe('buildCategoryMonthPivot', () => {
  it('pivota por categoría × mes filtrando por año y tipo', () => {
    const p = buildCategoryMonthPivot(rows, 2026, 'INVOICE');
    expect(p.rows.map((r) => r.categoryName)).toEqual(['Equipos', 'Servicios']); // ordenado por total desc
    const equipos = p.rows[0];
    expect(equipos.months[0]).toBe(100);
    expect(equipos.months[1]).toBe(50);
    expect(equipos.total).toBe(150);
    expect(p.monthlyTotals[0]).toBe(130); // 100 + 30
    expect(p.cumulative[1]).toBe(180);    // (100+30) + (50)
    expect(p.grandTotal).toBe(180);
  });
  it('año/tipo sin datos → filas vacías', () => {
    expect(buildCategoryMonthPivot(rows, 2099, 'INVOICE').rows).toEqual([]);
  });
});

describe('pivotToCsv', () => {
  it('incluye cabecera, categorías, TOTAL MENSUAL y TOTAL ACUMULADO', () => {
    const csv = pivotToCsv(buildCategoryMonthPivot(rows, 2026, 'INVOICE'));
    const lines = csv.split('\n');
    expect(lines[0].startsWith('Categoría;Ene;')).toBe(true);
    expect(lines.some((l) => l.startsWith('TOTAL MENSUAL;'))).toBe(true);
    expect(lines.some((l) => l.startsWith('TOTAL ACUMULADO;'))).toBe(true);
  });
});
