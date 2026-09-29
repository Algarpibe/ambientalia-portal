import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_LIMITS, evaluateVerification, type EvaluationResult } from '../engine';
import { chartSeries, compareEvaluations, formatRuleValue, pointRules, summaryRules } from './results';

const X = [0, 15, 52, 89, 126, 163, 200];
const Y = [
  [0.3, 15.2, 52.6, 89.9, 127.1, 164.4, 201.6],
  [0.1, 15.0, 52.9, 90.2, 127.4, 164.3, 201.9],
  [0.4, 15.4, 52.5, 89.7, 126.9, 164.6, 201.5],
];

const t3 = (): EvaluationResult =>
  evaluateVerification(
    {
      kind: 'VERIFICATION_3_CYCLES',
      cycles: Y.map((ys, i) => ({
        index: i + 1,
        points: X.map((x, j) => ({ order: j + 1, setpointPpb: x, xPpb: x, yPpb: ys[j] })),
      })),
    },
    DEFAULT_CONFIG,
    DEFAULT_LIMITS,
  );

describe('compareEvaluations', () => {
  it('identical results → no differences', () => {
    expect(compareEvaluations(t3(), t3())).toEqual([]);
  });
  it('reports a different overall result, aggregates beyond float noise and rule outcomes', () => {
    const server = t3();
    const live = t3();
    live.overallResult = 'NO_CONFORME';
    live.aggregates!.meanSlope += 1e-6;
    live.aggregates!.meanIntercept += 1e-13;
    const v5 = live.rules.find((r) => r.id === 'V5')!;
    v5.pass = false;
    const diffs = compareEvaluations(live, server);
    expect(diffs).toHaveLength(3);
    expect(diffs[0]).toMatch(/Resultado global/);
    expect(diffs[1]).toMatch(/m̄/);
    expect(diffs[2]).toMatch(/V5/);
  });
  it('different limits versions are reported', () => {
    const live = t3();
    live.limitsVersion = '0.9.0';
    expect(compareEvaluations(live, t3())[0]).toMatch(/límites/);
  });
});

describe('chartSeries', () => {
  it('one series per cycle with its points, residuals and regression line over the x range', () => {
    const s = chartSeries(t3());
    expect(s.cycles).toHaveLength(3);
    const c1 = s.cycles[0];
    expect(c1.points).toHaveLength(7);
    expect(c1.points[2]).toMatchObject({ x: 52, y: 52.6 });
    expect(c1.points[2].residual).toBeCloseTo(52.6 - (0.221 + 1.00706 * 52), 2);
    expect(c1.line).toHaveLength(2);
    expect(c1.line![0].x).toBe(0);
    expect(c1.line![1].x).toBe(200);
    expect(c1.line![1].y).toBeCloseTo(0.221 + 1.00706 * 200, 2);
    expect(s.identity).toEqual([
      { x: 0, y: 0 },
      { x: 201.9, y: 201.9 },
    ]);
  });
  it('a degenerate cycle has no line', () => {
    const r = t3();
    r.cycles[1].regression = null;
    expect(chartSeries(r).cycles[1].line).toBeNull();
  });
});

describe('rule grouping', () => {
  it('point rules are those with a pointOrder; the rest go to the summary table', () => {
    const r = t3();
    expect(pointRules(r.rules, 1, 3)?.id).toBe('V1');
    expect(pointRules(r.rules, 1, 1)?.id).toBe('V2');
    const summary = summaryRules(r.rules).map((x) => x.id);
    expect(summary).not.toContain('V1');
    expect(summary).toEqual(expect.arrayContaining(['V3', 'V4', 'V5', 'V6', 'V7', 'V8']));
  });
});

describe('formatRuleValue', () => {
  const r = (id: string, value: number | null) => ({ id, value }) as Parameters<typeof formatRuleValue>[0];
  it('uses the §10 decimals of each quantity with its unit', () => {
    expect(formatRuleValue(r('V1', 1.7307))).toBe('1,73 %');
    expect(formatRuleValue(r('V2', -0.1))).toBe('-0,10 ppb');
    expect(formatRuleValue(r('V3', 1.0070578))).toBe('1,00706');
    expect(formatRuleValue(r('R1', 0.016617))).toBe('0,01662');
    expect(formatRuleValue(r('V4', 0.22104))).toBe('0,221 ppb');
    expect(formatRuleValue(r('V6', 0.041873))).toBe('0,042 ppb');
    expect(formatRuleValue(r('V7', 3))).toBe('3');
    expect(formatRuleValue(r('D1', 6))).toBe('6,00 %');
    expect(formatRuleValue(r('R5', null))).toBe('—');
  });
});
