import { describe, it, expect } from 'vitest';
import { computeGroupingAnalysis, type GroupLite, type AnalysisRecord } from './grouping-analysis.js';

describe('computeGroupingAnalysis', () => {
  const groups: GroupLite[] = [
    { id: 'g1', name: 'Grupo A', color: '#ff0000' },
    { id: 'g2', name: 'Grupo B', color: null },
  ];
  // cat1, cat3 → g1 ; cat2 → g2
  const catToGroup = new Map<string, string>([
    ['cat1', 'g1'],
    ['cat3', 'g1'],
    ['cat2', 'g2'],
  ]);
  const records: AnalysisRecord[] = [
    // 2025 → total 450 (g1=150, g2=300)
    { categoryId: 'cat1', year: 2025, month: 1, amount: 100 },
    { categoryId: 'cat3', year: 2025, month: 2, amount: 50 },
    { categoryId: 'cat2', year: 2025, month: 1, amount: 300 },
    // 2026 → total 400 (g1=200, g2=200)
    { categoryId: 'cat1', year: 2026, month: 3, amount: 200 },
    { categoryId: 'cat2', year: 2026, month: 4, amount: 200 },
  ];

  const res = computeGroupingAnalysis(groups, catToGroup, records);

  it('devuelve los años ordenados y los totales por año', () => {
    expect(res.years).toEqual([2025, 2026]);
    expect(res.yearTotals).toEqual({ 2025: 450, 2026: 400 });
  });

  it('agrega las sumas por grupo/año', () => {
    const g1 = res.rows.find((r) => r.groupId === 'g1')!;
    const g2 = res.rows.find((r) => r.groupId === 'g2')!;
    expect(g1.years[2025].amount).toBe(150);
    expect(g1.years[2026].amount).toBe(200);
    expect(g2.years[2025].amount).toBe(300);
    expect(g2.years[2026].amount).toBe(200);
  });

  it('calcula el porcentaje como amount / yearTotal * 100', () => {
    const g1 = res.rows.find((r) => r.groupId === 'g1')!;
    const g2 = res.rows.find((r) => r.groupId === 'g2')!;
    expect(g1.years[2025].percentage).toBeCloseTo((150 / 450) * 100, 6); // 33.33
    expect(g1.years[2026].percentage).toBeCloseTo((200 / 400) * 100, 6); // 50
    expect(g2.years[2025].percentage).toBeCloseTo((300 / 450) * 100, 6); // 66.66
    expect(g2.years[2026].percentage).toBeCloseTo((200 / 400) * 100, 6); // 50
  });

  it('desglosa los meses por grupo/año', () => {
    const g1 = res.rows.find((r) => r.groupId === 'g1')!;
    expect(g1.months).toEqual({ 2025: { 1: 100, 2: 50 }, 2026: { 3: 200 } });
    const g2 = res.rows.find((r) => r.groupId === 'g2')!;
    expect(g2.months).toEqual({ 2025: { 1: 300 }, 2026: { 4: 200 } });
  });

  it('promedia amount = total/años y percentage = total/totalGeneral*100', () => {
    const g1 = res.rows.find((r) => r.groupId === 'g1')!;
    const g2 = res.rows.find((r) => r.groupId === 'g2')!;
    // g1 total = 350, g2 total = 500, totalAllYears = 850
    expect(g1.average.amount).toBeCloseTo(350 / 2, 6); // 175
    expect(g1.average.percentage).toBeCloseTo((350 / 850) * 100, 6); // 41.17
    expect(g2.average.amount).toBeCloseTo(500 / 2, 6); // 250
    expect(g2.average.percentage).toBeCloseTo((500 / 850) * 100, 6); // 58.82
  });

  it('aplica el color por defecto cuando el grupo no tiene color', () => {
    const g2 = res.rows.find((r) => r.groupId === 'g2')!;
    expect(g2.color).toBe('#6366f1');
    const g1 = res.rows.find((r) => r.groupId === 'g1')!;
    expect(g1.color).toBe('#ff0000');
  });
});
