import { describe, it, expect } from 'vitest';
import { availableYears, buildCategoryMonthPivot, orderAndColorRows, pivotToCsv } from './category-month-pivot';
import type { CategoryRow } from './category-month-pivot';
import type { SalesRow } from '../api';

const catRow = (categoryName: string, total: number): CategoryRow => ({
  categoryName,
  months: new Array(12).fill(0) as number[],
  total,
});

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

describe('orderAndColorRows', () => {
  it('(a) reordena por sort_order, no por orden de entrada/total', () => {
    const inputRows = [catRow('A', 100), catRow('B', 50)];
    const cats = [
      { name: 'B', color: '#111', sort_order: 0 },
      { name: 'A', color: '#222', sort_order: 1 },
    ];
    expect(orderAndColorRows(inputRows, cats).map((r) => r.categoryName)).toEqual(['B', 'A']);
  });

  it('(b) adjunta el color por match case-insensitive + trim', () => {
    const inputRows = [catRow('bombas', 100)];
    const cats = [{ name: '  Bombas ', color: '#0af', sort_order: 0 }];
    expect(orderAndColorRows(inputRows, cats)[0].color).toBe('#0af');
  });

  it('(c) categoría sin config → color null y al final', () => {
    const inputRows = [catRow('Huerfana', 100), catRow('A', 50)];
    const cats = [{ name: 'A', color: '#222', sort_order: 0 }];
    const out = orderAndColorRows(inputRows, cats);
    expect(out.map((r) => r.categoryName)).toEqual(['A', 'Huerfana']);
    expect(out[1].color).toBeNull();
    expect(out[0].color).toBe('#222');
  });

  it('(e) categories vacío → todas huérfanas, conservan orden de entrada y color null', () => {
    const inputRows = [catRow('A', 100), catRow('B', 50), catRow('C', 25)];
    const out = orderAndColorRows(inputRows, []);
    expect(out.map((r) => r.categoryName)).toEqual(['A', 'B', 'C']);
    expect(out.every((r) => r.color === null)).toBe(true);
  });

  it('(d) no muta el array de entrada', () => {
    const inputRows = [catRow('A', 100), catRow('B', 50)];
    const before = inputRows.map((r) => r.categoryName);
    const cats = [
      { name: 'B', color: '#111', sort_order: 0 },
      { name: 'A', color: '#222', sort_order: 1 },
    ];
    orderAndColorRows(inputRows, cats);
    expect(inputRows.map((r) => r.categoryName)).toEqual(before);
    expect(inputRows).toHaveLength(2);
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
