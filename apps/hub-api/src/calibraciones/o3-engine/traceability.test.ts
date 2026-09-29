import { describe, it, expect } from 'vitest';
import {
  validateTraceability,
  checkPointDistribution,
  computeCalibrationScale,
  proposeSetpoints,
  computeValidUntil,
  type TraceabilityInput,
  type EquipmentInfo,
} from './traceability.js';
import { DEFAULT_CONFIG } from './limits.js';

const srp: EquipmentInfo = {
  id: 'srp',
  type: 'SRP',
  hasPhotometer: true,
  application: 'BENCH',
  currentLevel: 1,
};
const l2Bench: EquipmentInfo = {
  id: '6103-S',
  type: 'PHOTOMETRIC_CALIBRATOR',
  hasPhotometer: true,
  application: 'BENCH',
  currentLevel: 2,
};
const candidate: EquipmentInfo = {
  id: '6103-T',
  type: 'PHOTOMETRIC_CALIBRATOR',
  hasPhotometer: true,
  application: 'FIELD',
  currentLevel: null,
};

const base = (over: Partial<TraceabilityInput> = {}): TraceabilityInput => ({
  reference: l2Bench,
  candidate,
  testDate: '2026-09-29',
  referenceVerification: {
    status: 'APPROVED',
    validUntil: '2027-01-01',
    internalFactors: { span: 1.002, zero: 0.1 },
    route: 'SAMPLE_IN',
    maxVerifiedPointPpb: 400,
  },
  referenceCurrentInternalFactors: { span: 1.002, zero: 0.1 },
  referenceRoute: 'SAMPLE_IN',
  candidateMaxPointPpb: 200,
  labTempStartC: 22,
  labTempEndC: 23,
  ...over,
});

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('§7 traceability validations', () => {
  it('valid Level 2 bench -> Level 3 has no blocking issues', () => {
    const r = validateTraceability(base());
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.candidateLevel).toBe(3);
  });

  it('Level 2 candidate requires a Level 1 SRP', () => {
    expect(validateTraceability(base({ reference: srp })).blocking).toEqual([]);
    const notSrp = { ...srp, type: 'PHOTOMETRIC_CALIBRATOR' as const };
    expect(codes(validateTraceability(base({ reference: notSrp })).blocking)).toContain('LEVEL2_REQUIRES_SRP');
  });

  it('T7: Level 3 against a FIELD Level 2 is blocked', () => {
    const r = validateTraceability(base({ reference: { ...l2Bench, application: 'FIELD' } }));
    expect(codes(r.blocking)).toContain('LEVEL3_REQUIRES_BENCH_LEVEL2');
  });

  it('candidate level must be reference level + 1', () => {
    const r = validateTraceability(base({ candidate: { ...candidate, currentLevel: 2 } }));
    expect(codes(r.blocking)).toContain('LEVEL_MISMATCH');
  });

  it('Level 4 is blocked unless a director overrides it (then quarterly warning)', () => {
    const l3 = { ...l2Bench, currentLevel: 3 as const };
    expect(codes(validateTraceability(base({ reference: l3 })).blocking)).toContain('LEVEL4_DISCOURAGED');
    const ok = validateTraceability(base({ reference: l3, directorOverride: true }));
    expect(ok.blocking).toEqual([]);
    expect(codes(ok.warnings)).toContain('LEVEL4_QUARTERLY_REVERIFICATION');
  });

  it('T7: a GENERATOR_ONLY candidate is blocked; so is one without photometer, and as reference', () => {
    const gen = { ...candidate, type: 'GENERATOR_ONLY' as const, hasPhotometer: false };
    expect(codes(validateTraceability(base({ candidate: gen })).blocking)).toContain('CANDIDATE_NOT_PHOTOMETRIC');
    const noPhot = { ...candidate, hasPhotometer: false };
    expect(codes(validateTraceability(base({ candidate: noPhot })).blocking)).toContain('CANDIDATE_NOT_PHOTOMETRIC');
    const genRef = { ...l2Bench, type: 'GENERATOR_ONLY' as const };
    expect(codes(validateTraceability(base({ reference: genRef })).blocking)).toContain('REFERENCE_NOT_PHOTOMETRIC');
  });

  it('reference verification must be APPROVED and valid on the test date', () => {
    const draft = validateTraceability(
      base({ referenceVerification: { ...base().referenceVerification!, status: 'CALCULATED' } }),
    );
    expect(codes(draft.blocking)).toContain('REFERENCE_NOT_APPROVED');
    const expired = validateTraceability(
      base({ referenceVerification: { ...base().referenceVerification!, validUntil: '2026-09-28' } }),
    );
    expect(codes(expired.blocking)).toContain('REFERENCE_EXPIRED');
    const sameDay = validateTraceability(
      base({ referenceVerification: { ...base().referenceVerification!, validUntil: '2026-09-29' } }),
    );
    expect(sameDay.blocking).toEqual([]);
    expect(codes(validateTraceability(base({ referenceVerification: undefined })).blocking)).toContain(
      'REFERENCE_WITHOUT_VERIFICATION',
    );
  });

  it('reference internal factors must be unchanged', () => {
    const r = validateTraceability(base({ referenceCurrentInternalFactors: { span: 1.01, zero: 0.1 } }));
    expect(codes(r.blocking)).toContain('REFERENCE_FACTORS_CHANGED');
  });

  it('T7: a candidate point above the reference verified range is blocked', () => {
    const r = validateTraceability(base({ candidateMaxPointPpb: 401 }));
    expect(codes(r.blocking)).toContain('ABOVE_REFERENCE_RANGE');
    expect(validateTraceability(base({ candidateMaxPointPpb: 400 })).blocking).toEqual([]);
  });

  it('warns on lab temperature outside 20-30 °C and on route mismatch', () => {
    expect(codes(validateTraceability(base({ labTempEndC: 30.5 })).warnings)).toContain('LAB_TEMPERATURE');
    expect(codes(validateTraceability(base({ labTempStartC: 19.9 })).warnings)).toContain('LAB_TEMPERATURE');
    expect(codes(validateTraceability(base({ referenceRoute: 'INTERNAL' })).warnings)).toContain('ROUTE_MISMATCH');
  });

  it('includes point distribution warnings when setpoints are given', () => {
    const r = validateTraceability(base({ setpointsPpb: [0, 10, 12, 14, 16, 18, 200] }));
    expect(codes(r.warnings)).toContain('POINT_DISTRIBUTION_GAP');
  });
});

describe('point distribution', () => {
  it('TAD example 0,15,52,89,126,163,200 is well distributed', () => {
    expect(checkPointDistribution([0, 15, 52, 89, 126, 163, 200])).toEqual([]);
  });
  it('flags a gap larger than twice the ideal spacing', () => {
    expect(codes(checkPointDistribution([0, 15, 30, 45, 60, 75, 200]))).toContain('POINT_DISTRIBUTION_GAP');
  });
  it('flags clustered points', () => {
    expect(codes(checkPointDistribution([0, 15, 20, 89, 126, 163, 200]))).toContain('POINT_DISTRIBUTION_CLUSTERED');
  });
});

describe('scale assistant', () => {
  it('scale = 1.5 x 3-year hourly maximum', () => {
    expect(computeCalibrationScale({ max3yHourlyPpb: 133.4, standardPpb: 70 })).toEqual({
      scalePpb: 1.5 * 133.4,
      basis: 'MAX_3Y_HOURLY',
    });
  });
  it('falls back to 1.5 x standard when 1.5 x max is below the standard', () => {
    expect(computeCalibrationScale({ max3yHourlyPpb: 40, standardPpb: 70 })).toEqual({
      scalePpb: 105,
      basis: 'STANDARD',
    });
  });
  it('reproduces the TAD example for scale 200', () => {
    expect(proposeSetpoints(200)).toEqual([0, 15, 52, 89, 126, 163, 200]);
  });
  it('lowest point and count are configurable', () => {
    expect(proposeSetpoints(100, { lowestPointPpb: 20, nonZeroPoints: 5 })).toEqual([0, 20, 40, 60, 80, 100]);
    expect(() => proposeSetpoints(10, { lowestPointPpb: 15 })).toThrow();
  });
});

describe('validity dates', () => {
  it('Level 2: 365 days, plus 182-day reverification when FIELD', () => {
    expect(computeValidUntil('2026-01-01', 2, 'BENCH', DEFAULT_CONFIG)).toEqual({
      validUntil: '2027-01-01',
      reverificationDue: null,
    });
    expect(computeValidUntil('2026-01-01', 2, 'FIELD', DEFAULT_CONFIG)).toEqual({
      validUntil: '2027-01-01',
      reverificationDue: '2026-07-02',
    });
  });
  it('Level 3: bench 365 days, field 182 days', () => {
    expect(computeValidUntil('2026-09-29', 3, 'BENCH', DEFAULT_CONFIG).validUntil).toBe('2027-09-29');
    expect(computeValidUntil('2026-09-29', 3, 'FIELD', DEFAULT_CONFIG).validUntil).toBe('2027-03-30');
  });
  it('handles leap years with day arithmetic, not calendar years', () => {
    expect(computeValidUntil('2027-06-01', 3, 'BENCH', DEFAULT_CONFIG).validUntil).toBe('2028-05-31');
  });
  it('rejects Level 1 and malformed dates', () => {
    expect(() => computeValidUntil('2026-01-01', 1, 'BENCH', DEFAULT_CONFIG)).toThrow();
    expect(() => computeValidUntil('2026-02-30', 2, 'BENCH', DEFAULT_CONFIG)).toThrow();
  });
});
