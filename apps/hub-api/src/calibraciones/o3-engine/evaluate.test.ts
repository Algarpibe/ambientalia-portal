import { describe, it, expect } from 'vitest';
import { evaluateVerification, REVERIFICATION_FAILED_MESSAGE, type VerificationInput } from './evaluate.js';
import { DEFAULT_CONFIG, DEFAULT_LIMITS } from './limits.js';
import { T3_X, T3_Y, T3_MEAN_SLOPE, T3_MEAN_INTERCEPT } from './fixtures.test-data.js';

const cycle = (index: number, ys: number[], xs: number[] = T3_X) => ({
  index,
  points: xs.map((x, j) => ({ order: j + 1, setpointPpb: T3_X[j], xPpb: x, yPpb: ys[j] })),
});

const t3Input = (): VerificationInput => ({
  kind: 'VERIFICATION_3_CYCLES',
  cycles: T3_Y.map((ys, i) => cycle(i + 1, ys)),
});

const failing = (res: ReturnType<typeof evaluateVerification>) =>
  res.rules.filter((r) => !r.pass && !r.informative).map((r) => r.id);

describe('evaluateVerification - T3 full synthetic verification', () => {
  const res = evaluateVerification(t3Input(), DEFAULT_CONFIG, DEFAULT_LIMITS);

  it('per-cycle regression', () => {
    expect(res.cycles.map((c) => c.regression!.slope)).toEqual([
      expect.closeTo(1.0070587, 6),
      expect.closeTo(1.0087213, 6),
      expect.closeTo(1.0063681, 6),
    ]);
    expect(res.cycles.map((c) => c.regression!.intercept)).toEqual([
      expect.closeTo(0.2210175, 6),
      expect.closeTo(0.1678219, 6),
      expect.closeTo(0.2703658, 6),
    ]);
    expect(res.cycles.every((c) => c.pass)).toBe(true);
  });

  it('aggregates', () => {
    const a = res.aggregates!;
    expect(a.meanSlope).toBeCloseTo(1.0073827, 7);
    expect(a.meanIntercept).toBeCloseTo(0.2197351, 7);
    expect(a.sdSlope).toBeCloseTo(0.00098763, 8);
    expect(a.sdIntercept).toBeCloseTo(0.0418732, 7);
    expect(a.maxVerifiedPointPpb).toBe(200);
  });

  it('max %Diff is 1.7308 % at cycle 2, x = 52', () => {
    let best = { v: -1, cycle: 0, x: 0 };
    for (const c of res.cycles)
      for (const p of c.points)
        if (p.diffType === 'PERCENT' && p.diffValue > best.v) best = { v: p.diffValue, cycle: c.index, x: p.xPpb };
    expect(best.v).toBeCloseTo(1.7308, 4);
    expect(best.cycle).toBe(2);
    expect(best.x).toBe(52);
  });

  it('zero points use AbsDiff and every point passes', () => {
    const zero = res.cycles[0].points[0];
    expect(zero.diffType).toBe('ABS_PPB');
    expect(zero.diffValue).toBeCloseTo(0.3, 12);
    expect(res.cycles.flatMap((c) => c.points).every((p) => p.pass)).toBe(true);
  });

  it('is CONFORME with no fail reasons', () => {
    expect(res.overallResult).toBe('CONFORME');
    expect(res.failReasons).toEqual([]);
    expect(res.requiresFullVerification).toBe(false);
    const ids = new Set<string>(res.rules.map((r) => r.id));
    for (const id of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8']) expect(ids.has(id)).toBe(true);
    expect(res.engineVersion).toBe('1.0.0');
    expect(res.limitsVersion).toBe('1.0.0');
  });

  it('is deterministic', () => {
    expect(evaluateVerification(t3Input(), DEFAULT_CONFIG, DEFAULT_LIMITS)).toEqual(res);
  });
});

describe('evaluateVerification - T5 reverification failing only on R1', () => {
  const ys = T3_X.map((x) => 1.024 * x + 0.2);
  const input: VerificationInput = {
    kind: 'REVERIFICATION_1_CYCLE',
    cycles: [cycle(1, ys)],
    internalFactors: { span: 1.002, zero: 0.1 },
    lastVerification: {
      meanSlope: T3_MEAN_SLOPE,
      meanIntercept: T3_MEAN_INTERCEPT,
      internalFactors: { span: 1.002, zero: 0.1 },
    },
  };
  const res = evaluateVerification(input, DEFAULT_CONFIG, DEFAULT_LIMITS);

  it('slope 1.024 and R1 fails with |dm| = 0.0166173', () => {
    expect(res.cycles[0].regression!.slope).toBeCloseTo(1.024, 10);
    const r1 = res.rules.find((r) => r.id === 'R1')!;
    expect(r1.value).toBeCloseTo(0.0166173, 7);
    expect(r1.pass).toBe(false);
  });

  it('R2-R5, V1, V2, V8 pass; max %Diff ~ 2.7846 % at x = 52', () => {
    expect(failing(res)).toEqual(['R1']);
    const pct = res.cycles[0].points.filter((p) => p.diffType === 'PERCENT');
    const max = pct.reduce((a, p) => (p.diffValue > a.diffValue ? p : a));
    expect(max.diffValue).toBeCloseTo(2.7846, 4);
    expect(max.xPpb).toBe(52);
  });

  it('is NO_CONFORME and requires a full 3-cycle verification', () => {
    expect(res.overallResult).toBe('NO_CONFORME');
    expect(res.requiresFullVerification).toBe(true);
    expect(res.failReasons.some((f) => f.includes(REVERIFICATION_FAILED_MESSAGE))).toBe(true);
    expect(REVERIFICATION_FAILED_MESSAGE).toBe('requiere verificación completa de 3 ciclos');
    expect(res.rules.some((r) => r.id === 'V3')).toBe(false);
  });

  it('R5 fails when internal factors changed', () => {
    const changed = evaluateVerification(
      { ...input, cycles: [cycle(1, T3_Y[0])], internalFactors: { span: 1.01, zero: 0.1 } },
      DEFAULT_CONFIG,
      DEFAULT_LIMITS,
    );
    expect(failing(changed)).toEqual(['R5']);
    expect(changed.requiresFullVerification).toBe(true);
  });

  it('a reverification without a previous verification cannot pass R1/R2/R5', () => {
    const none = evaluateVerification({ ...input, lastVerification: undefined }, DEFAULT_CONFIG, DEFAULT_LIMITS);
    expect(failing(none)).toEqual(expect.arrayContaining(['R1', 'R2', 'R5']));
  });

  it('a reverification must carry exactly one cycle', () => {
    expect(() =>
      evaluateVerification({ ...input, cycles: [cycle(1, ys), cycle(2, ys)] }, DEFAULT_CONFIG, DEFAULT_LIMITS),
    ).toThrow();
  });
});

describe('evaluateVerification - T7 edge cases', () => {
  it('two cycles in a verification -> V7 fails', () => {
    const res = evaluateVerification(
      { kind: 'VERIFICATION_3_CYCLES', cycles: T3_Y.slice(0, 2).map((ys, i) => cycle(i + 1, ys)) },
      DEFAULT_CONFIG,
      DEFAULT_LIMITS,
    );
    expect(failing(res)).toEqual(['V7']);
    expect(res.overallResult).toBe('NO_CONFORME');
    expect(res.failReasons.join(' ')).toMatch(/V7/);
  });

  it('a cycle with fewer than zero + 6 points -> V8 fails', () => {
    const short = { index: 1, points: cycle(1, T3_Y[0]).points.slice(0, 6) };
    const res = evaluateVerification(
      { kind: 'VERIFICATION_3_CYCLES', cycles: [short, cycle(2, T3_Y[1]), cycle(3, T3_Y[2])] },
      DEFAULT_CONFIG,
      DEFAULT_LIMITS,
    );
    expect(failing(res)).toContain('V8');
    expect(res.cycles[0].pass).toBe(false);
    expect(res.overallResult).toBe('NO_CONFORME');
  });

  it('a degenerate cycle does not throw: it fails', () => {
    const flat = { index: 1, points: T3_X.map((_, j) => ({ order: j + 1, setpointPpb: 0, xPpb: 0, yPpb: 0.1 })) };
    const res = evaluateVerification(
      { kind: 'VERIFICATION_3_CYCLES', cycles: [flat, cycle(2, T3_Y[1]), cycle(3, T3_Y[2])] },
      DEFAULT_CONFIG,
      DEFAULT_LIMITS,
    );
    expect(res.cycles[0].regression).toBeNull();
    expect(res.overallResult).toBe('NO_CONFORME');
  });

  it('T7: O3 loss of 6 % -> D1 fails', () => {
    const res = evaluateVerification({ ...t3Input(), photometry: { lossFraction: 0.06 } }, DEFAULT_CONFIG, DEFAULT_LIMITS);
    expect(failing(res)).toEqual(['D1']);
    expect(res.overallResult).toBe('NO_CONFORME');
  });

  it('D2 is evaluated when a linearity error is supplied', () => {
    const res = evaluateVerification(
      { ...t3Input(), photometry: { lossFraction: 0.02, linearityErrorPercent: 3.5 } },
      DEFAULT_CONFIG,
      DEFAULT_LIMITS,
    );
    expect(failing(res)).toEqual(['D2']);
  });

  it('Q1 is informative and never fails the overall result', () => {
    const res = evaluateVerification(
      { ...t3Input(), qualification: [{ referencePpb: 100, measuredPpb: 120 }] },
      DEFAULT_CONFIG,
      DEFAULT_LIMITS,
    );
    const q1 = res.rules.find((r) => r.id === 'Q1')!;
    expect(q1.pass).toBe(false);
    expect(res.overallResult).toBe('CONFORME');
  });
});

describe('evaluateVerification - Eq. 10 traceability option 2', () => {
  it('converts x before differences and regression when the reference used option 2', () => {
    const m = 1.01;
    const b = 0.5;
    // Raw reference readings are "indicated" values; the true standard is (x - b) / m.
    const rawX = T3_X.map((x) => m * x + b);
    const input: VerificationInput = {
      kind: 'VERIFICATION_3_CYCLES',
      cycles: T3_Y.map((ys, i) => cycle(i + 1, ys, rawX)),
      referenceVerification: { traceabilityOption: 2, meanSlope: m, meanIntercept: b },
    };
    const converted = evaluateVerification(input, DEFAULT_CONFIG, DEFAULT_LIMITS);
    const plain = evaluateVerification(t3Input(), DEFAULT_CONFIG, DEFAULT_LIMITS);
    expect(converted.aggregates!.meanSlope).toBeCloseTo(plain.aggregates!.meanSlope, 10);
    expect(converted.cycles[0].points[2].xPpb).toBeCloseTo(52, 10);
    expect(converted.cycles[0].points[2].xRawPpb).toBeCloseTo(rawX[2], 12);
    expect(converted.eq10Applied).toBe(true);
    expect(plain.eq10Applied).toBe(false);
  });

  it('option 1 leaves x unchanged', () => {
    const res = evaluateVerification(
      { ...t3Input(), referenceVerification: { traceabilityOption: 1, meanSlope: 1.2, meanIntercept: 3 } },
      DEFAULT_CONFIG,
      DEFAULT_LIMITS,
    );
    expect(res.aggregates!.meanSlope).toBeCloseTo(T3_MEAN_SLOPE, 7);
  });
});

describe('evaluateVerification - config', () => {
  it('includeZeroInRegression = false changes the fit', () => {
    const res = evaluateVerification(
      t3Input(),
      { ...DEFAULT_CONFIG, includeZeroInRegression: false },
      DEFAULT_LIMITS,
    );
    expect(res.aggregates!.meanSlope).not.toBeCloseTo(T3_MEAN_SLOPE, 6);
  });
});
