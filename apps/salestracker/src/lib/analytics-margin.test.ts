import { describe, it, expect } from 'vitest';
import {
  deriveMargin, buildMarginByYear, buildMarginItems, buildMarginCustomers,
} from './analytics-margin';
import type { MarginYearRow, MarginItemRow, MarginCustomerRow } from '../api';

describe('deriveMargin', () => {
  it('calcula margen y margenPct', () => {
    expect(deriveMargin(1000, 600)).toEqual({ margen: 400, margenPct: 40 });
  });
  it('ventas 0 → margenPct 0', () => {
    expect(deriveMargin(0, 0)).toEqual({ margen: 0, margenPct: 0 });
  });
  it('costo > ventas → margen negativo', () => {
    const d = deriveMargin(100, 150);
    expect(d.margen).toBe(-50);
    expect(d.margenPct).toBe(-50);
  });
});

describe('buildMarginByYear', () => {
  it('series ordenada + totales globales', () => {
    const rows: MarginYearRow[] = [
      { year: 2023, ventas: 200, costo: 100 },
      { year: 2022, ventas: 100, costo: 60 },
    ];
    const { series, totals } = buildMarginByYear(rows);
    expect(series.map((s) => s.year)).toEqual([2022, 2023]);
    expect(series[0]).toEqual({ year: 2022, ventas: 100, costo: 60, margen: 40, margenPct: 40 });
    expect(totals).toEqual({ ventas: 300, costo: 160, margen: 140, margenPct: (140 / 300) * 100 });
  });
});

describe('buildMarginItems', () => {
  it('orden por margen desc, label=nombre', () => {
    const rows: MarginItemRow[] = [
      { itemId: '1', sku: 'A', nombre: 'uno', ventas: 100, costo: 90 },
      { itemId: '2', sku: 'B', nombre: 'dos', ventas: 200, costo: 50 },
    ];
    const p = buildMarginItems(rows);
    expect(p.map((x) => x.label)).toEqual(['dos', 'uno']);
    expect(p[0]).toEqual({ label: 'dos', sku: 'B', ventas: 200, costo: 50, margen: 150, margenPct: 75 });
  });
});

describe('buildMarginCustomers', () => {
  it('orden por margen desc', () => {
    const rows: MarginCustomerRow[] = [
      { customer: 'X', ventas: 100, costo: 80 },
      { customer: 'Y', ventas: 300, costo: 100 },
    ];
    expect(buildMarginCustomers(rows).map((x) => x.customer)).toEqual(['Y', 'X']);
  });
});
