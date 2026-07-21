import { describe, it, expect } from 'vitest';
import {
  buildHomeKpis,
  buildMonthlyOvFac,
  buildCumulativeYoY,
  buildExecutionMonthly,
  buildCategoryMix,
} from './home-metrics';
import type { SalesRow } from '../api';

const rows: SalesRow[] = [
  // 2026
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 100 },
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 3, year: 2026, amountUsd: 50 },
  { categoryName: 'Servicios', recordType: 'INVOICE', month: 3, year: 2026, amountUsd: 30 },
  { categoryName: 'Equipos', recordType: 'SALES_ORDER', month: 3, year: 2026, amountUsd: 200 },
  { categoryName: 'Servicios', recordType: 'SALES_ORDER', month: 5, year: 2026, amountUsd: 100 },
  { categoryName: 'Equipos', recordType: 'BACKLOG', month: 1, year: 2026, amountUsd: 999 },
  // 2025 (previo)
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 2, year: 2025, amountUsd: 40 },
  { categoryName: 'Equipos', recordType: 'SALES_ORDER', month: 2, year: 2025, amountUsd: 80 },
];

describe('buildHomeKpis', () => {
  it('calcula facturado/ordenes/backlog del año y previos de año-1', () => {
    const k = buildHomeKpis(rows, 2026);
    expect(k.facturado).toBe(180);
    expect(k.facturadoPrev).toBe(40);
    expect(k.ordenes).toBe(300);
    expect(k.ordenesPrev).toBe(80);
    expect(k.backlog).toBe(999);
    expect(k.ejecucion).toBeCloseTo((180 / 300) * 100);
    expect(k.ejecucionPrev).toBeCloseTo((40 / 80) * 100);
  });

  it('guarda contra división por cero: ordenes=0 → ejecucion=0 (sin NaN/Infinity)', () => {
    const soloFac: SalesRow[] = [
      { categoryName: 'X', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 100 },
    ];
    const k = buildHomeKpis(soloFac, 2026);
    expect(k.ordenes).toBe(0);
    expect(k.ejecucion).toBe(0);
    expect(Number.isFinite(k.ejecucion)).toBe(true);
    expect(k.ejecucionPrev).toBe(0);
  });

  it('entrada vacía: todos los campos 0 y ejecucion finito', () => {
    const k = buildHomeKpis([], 2025);
    expect(k.facturado).toBe(0);
    expect(k.facturadoPrev).toBe(0);
    expect(k.ordenes).toBe(0);
    expect(k.ordenesPrev).toBe(0);
    expect(k.backlog).toBe(0);
    expect(k.ejecucion).toBe(0);
    expect(k.ejecucionPrev).toBe(0);
    expect(Number.isFinite(k.ejecucion)).toBe(true);
    expect(buildCategoryMix([], 2025)).toEqual([]);
  });
});

describe('buildMonthlyOvFac', () => {
  it('coloca cada fila en su mes (índice mes-1) por tipo', () => {
    const s = buildMonthlyOvFac(rows, 2026);
    expect(s).toHaveLength(12);
    expect(s[0].mes).toBe('Ene');
    // mes 3 (índice 2)
    expect(s[2].fac).toBe(80); // 50 + 30 INVOICE
    expect(s[2].ov).toBe(200); // SALES_ORDER
    // mes 1 (índice 0): sólo fac 100
    expect(s[0].fac).toBe(100);
    expect(s[0].ov).toBe(0);
    // mes 2 (índice 1) del 2026 vacío
    expect(s[1].fac).toBe(0);
    expect(s[1].ov).toBe(0);
  });
});

describe('buildCumulativeYoY', () => {
  it('acumula INVOICE de forma monótona no decreciente y refleja el año previo', () => {
    const s = buildCumulativeYoY(rows, 2026);
    expect(s).toHaveLength(12);
    // actual: 100 en Ene, se mantiene en Feb, +80 en Mar → 180
    expect(s[0].actual).toBe(100);
    expect(s[1].actual).toBe(100); // mes sin datos mantiene acumulado
    expect(s[2].actual).toBe(180);
    expect(s[11].actual).toBe(180);
    // monótona no decreciente
    for (let i = 1; i < s.length; i++) {
      expect(s[i].actual).toBeGreaterThanOrEqual(s[i - 1].actual);
      expect(s[i].previo).toBeGreaterThanOrEqual(s[i - 1].previo);
    }
    // previo: 40 desde Feb en adelante
    expect(s[0].previo).toBe(0);
    expect(s[1].previo).toBe(40);
    expect(s[11].previo).toBe(40);
  });
});

describe('buildExecutionMonthly', () => {
  it('mes con ov=0 → pct 0 (sin división por cero)', () => {
    const s = buildExecutionMonthly(rows, 2026);
    expect(s).toHaveLength(12);
    // Ene: ov 0, fac 100 → pct 0
    expect(s[0].pct).toBe(0);
    expect(Number.isFinite(s[0].pct)).toBe(true);
  });

  it('mes con fac<ov → pct <100', () => {
    const s = buildExecutionMonthly(rows, 2026);
    // Mar: fac 80, ov 200 → 40%
    expect(s[2].pct).toBeCloseTo(40);
    expect(s[2].pct).toBeLessThan(100);
  });
});

describe('buildCategoryMix', () => {
  it('agrega INVOICE por categoría y ordena desc', () => {
    const mix = buildCategoryMix(rows, 2026);
    expect(mix[0]).toEqual({ categoria: 'Equipos', importe: 150 });
    expect(mix[1]).toEqual({ categoria: 'Servicios', importe: 30 });
  });

  it('añade "Otros" con el remanente cuando hay más de topN categorías', () => {
    const many: SalesRow[] = Array.from({ length: 5 }, (_, i) => ({
      categoryName: `C${i}`,
      recordType: 'INVOICE' as const,
      month: 1,
      year: 2026,
      amountUsd: 100 - i * 10, // 100,90,80,70,60
    }));
    const mix = buildCategoryMix(many, 2026, 3);
    expect(mix).toHaveLength(4); // 3 + Otros
    expect(mix[3]).toEqual({ categoria: 'Otros', importe: 70 + 60 });
  });

  it('no añade "Otros" cuando hay ≤ topN categorías', () => {
    const mix = buildCategoryMix(rows, 2026, 8);
    expect(mix.some((s) => s.categoria === 'Otros')).toBe(false);
  });

  it('borde count === topN: 3 categorías con topN=3 no genera "Otros" (resto=0)', () => {
    const tres: SalesRow[] = [
      { categoryName: 'A', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 30 },
      { categoryName: 'B', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 20 },
      { categoryName: 'C', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 10 },
    ];
    const mix = buildCategoryMix(tres, 2026, 3);
    expect(mix).toHaveLength(3);
    expect(mix.some((s) => s.categoria === 'Otros')).toBe(false);
  });

  it('desempata alfabéticamente cuando dos categorías tienen igual importe', () => {
    const empate: SalesRow[] = [
      { categoryName: 'Zeta', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 100 },
      { categoryName: 'Alfa', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 100 },
    ];
    const mix = buildCategoryMix(empate, 2026);
    expect(mix.map((s) => s.categoria)).toEqual(['Alfa', 'Zeta']);
  });
});
