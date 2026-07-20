import { describe, it, expect } from 'vitest';
import { slotsForViewMode, buildTechService, ST_CATEGORIES, CR_CATEGORIES } from './analytics-exploracion';
import type { SalesRow } from '../api';

const rows: SalesRow[] = [
  { categoryName: 'CAL PM', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 100 }, // ST
  { categoryName: 'C&R EDM 180', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 40 }, // C&R
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 999 }, // ni ST ni C&R → ignorado
  { categoryName: 'CAL PM', recordType: 'INVOICE', month: 4, year: 2025, amountUsd: 60 }, // ST año B, T2
];

describe('slotsForViewMode', () => {
  it('QUARTERLY → 4 trimestres', () => { expect(slotsForViewMode('QUARTERLY').map((s) => s.label)).toEqual(['T1', 'T2', 'T3', 'T4']); });
  it('ANNUAL → 1 slot con 12 meses', () => { expect(slotsForViewMode('ANNUAL')[0].months).toHaveLength(12); });
  it('MONTHLY → 12 slots', () => { expect(slotsForViewMode('MONTHLY')).toHaveLength(12); });
});

describe('buildTechService', () => {
  it('clasifica ST/C&R por nombre, ignora otras, acumula, y trae año B', () => {
    const pts = buildTechService(rows, { yearA: 2026, yearB: 2025, tipo: 'INVOICE', viewMode: 'QUARTERLY' });
    const t1 = pts[0];
    expect(t1.st).toBe(100); expect(t1.cr).toBe(40); expect(t1.total).toBe(140); expect(t1.acum).toBe(140);
    const t2 = pts[1];
    expect(t2.st_prev).toBe(60); // año B, T2
    expect(pts[3].acum).toBe(140); // acumulado A sin cambios en T2..T4
  });
});

describe('listas de categorías', () => {
  it('ST_CATEGORIES y CR_CATEGORIES son disjuntas y no vacías', () => {
    expect(ST_CATEGORIES.length).toBeGreaterThan(0);
    expect(CR_CATEGORIES.length).toBeGreaterThan(0);
    expect(ST_CATEGORIES.some((c) => CR_CATEGORIES.includes(c))).toBe(false);
  });
});
