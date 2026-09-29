import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_LIMITS, evaluateVerification } from './o3-engine/index.js';
import { T3_MEAN_INTERCEPT, T3_MEAN_SLOPE, T3_X, T3_Y } from './o3-engine/fixtures.test-data.js';
import {
  buildEngineInput,
  compareReproducibility,
  referenceInfoFromCertificate,
  referenceInfoFromVerification,
  validityStatus,
} from './service.js';
import type { CycleDraft, Equipment, Verification } from './types.js';

const t3Cycles = (): CycleDraft[] =>
  T3_Y.map((ys, i) => ({
    index: i + 1,
    points: T3_X.map((x, j) => ({ order: j + 1, setpointPpb: x, xPpb: x, yPpb: ys[j] })),
  }));

describe('validityStatus', () => {
  const today = '2026-09-29';

  it('no dates → NO_VALIDITY', () => {
    expect(validityStatus(null, null, today)).toEqual({ dueDate: null, daysLeft: null, bucket: 'NO_VALIDITY' });
  });

  it('uses the earliest of valid-until and reverification-due', () => {
    expect(validityStatus('2027-01-01', '2026-10-09', today)).toMatchObject({ dueDate: '2026-10-09', daysLeft: 10 });
  });

  it.each([
    ['2026-09-28', -1, 'EXPIRED'],
    ['2026-09-29', 0, 'DUE_TODAY'],
    ['2026-09-30', 1, 'DUE_15'],
    ['2026-10-14', 15, 'DUE_15'],
    ['2026-10-15', 16, 'DUE_30'],
    ['2026-10-29', 30, 'DUE_30'],
    ['2026-10-30', 31, 'OK'],
  ])('due %s → %i days, %s', (due, days, bucket) => {
    expect(validityStatus(due, null, today)).toEqual({ dueDate: due, daysLeft: days, bucket });
  });
});

describe('buildEngineInput', () => {
  it('maps the T3 draft to an engine input that reproduces the TAD example', () => {
    const input = buildEngineInput(
      { kind: 'VERIFICATION_3_CYCLES', cycles: t3Cycles(), internalFactorsBefore: null, photometry: null },
      {},
    );
    expect(input.kind).toBe('VERIFICATION_3_CYCLES');
    expect(input.referenceVerification).toBeUndefined();
    const r = evaluateVerification(input, DEFAULT_CONFIG, DEFAULT_LIMITS);
    expect(r.overallResult).toBe('CONFORME');
    expect(r.aggregates!.meanSlope).toBeCloseTo(T3_MEAN_SLOPE, 6);
    expect(r.aggregates!.meanIntercept).toBeCloseTo(T3_MEAN_INTERCEPT, 6);
  });

  it('omits a null setpoint and passes reference, last verification and factors through', () => {
    const input = buildEngineInput(
      {
        kind: 'REVERIFICATION_1_CYCLE',
        cycles: [{ index: 1, points: [{ order: 1, setpointPpb: null, xPpb: 10, yPpb: 10.1 }] }],
        internalFactorsBefore: { span: 1.01 },
        photometry: { lossFraction: 0.01 },
      },
      {
        referenceVerification: { traceabilityOption: 2, meanSlope: 1.01, meanIntercept: 0.2 },
        lastVerification: { meanSlope: 1, meanIntercept: 0, internalFactors: { span: 1.01 } },
      },
    );
    expect(input.cycles[0].points[0]).toEqual({ order: 1, xPpb: 10, yPpb: 10.1 });
    expect(input.referenceVerification).toEqual({ traceabilityOption: 2, meanSlope: 1.01, meanIntercept: 0.2 });
    expect(input.lastVerification).toEqual({ meanSlope: 1, meanIntercept: 0, internalFactors: { span: 1.01 } });
    expect(input.internalFactors).toEqual({ span: 1.01 });
    expect(input.photometry).toEqual({ lossFraction: 0.01 });
  });

  it('does not pass a last verification to a full verification', () => {
    const input = buildEngineInput(
      { kind: 'VERIFICATION_3_CYCLES', cycles: t3Cycles(), internalFactorsBefore: null, photometry: null },
      { lastVerification: { meanSlope: 1, meanIntercept: 0 } },
    );
    expect(input.lastVerification).toBeUndefined();
  });
});

describe('reference info', () => {
  const srp = {
    certificateValidUntil: '2027-03-01',
    certificateMaxPpb: 500,
    certificateRoute: null,
  } as Pick<Equipment, 'certificateValidUntil' | 'certificateMaxPpb' | 'certificateRoute'>;

  it('an SRP without a certificate has no reference verification', () => {
    expect(referenceInfoFromCertificate({ ...srp, certificateValidUntil: null }, 'SAMPLE_IN')).toBeUndefined();
  });

  it('an SRP certificate becomes an APPROVED reference verification; unknown route = test route', () => {
    expect(referenceInfoFromCertificate(srp, 'INTERNAL')).toEqual({
      status: 'APPROVED',
      validUntil: '2027-03-01',
      internalFactors: {},
      route: 'INTERNAL',
      maxVerifiedPointPpb: 500,
    });
  });

  it('a verification maps factors-after (else before), candidate route and range', () => {
    const v = {
      status: 'APPROVED',
      validUntil: '2027-09-01',
      verificationDate: '2026-09-01',
      internalFactorsBefore: { span: 1 },
      internalFactorsAfter: { span: 1.02 },
      candidateRoute: 'SAMPLE_IN',
      maxVerifiedPointPpb: 200,
    } as unknown as Verification;
    expect(referenceInfoFromVerification(v)).toEqual({
      status: 'APPROVED',
      validUntil: '2027-09-01',
      internalFactors: { span: 1.02 },
      route: 'SAMPLE_IN',
      maxVerifiedPointPpb: 200,
    });
    expect(referenceInfoFromVerification({ ...v, internalFactorsAfter: null }).internalFactors).toEqual({ span: 1 });
  });
});

describe('compareReproducibility', () => {
  it('identical after a JSON round trip (key order does not matter)', () => {
    expect(compareReproducibility({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toEqual({ identical: true, differences: [] });
  });

  it('treats NaN as the null it is stored as', () => {
    expect(compareReproducibility({ v: null }, { v: Number.NaN }).identical).toBe(true);
  });

  it('reports the path of each difference', () => {
    const r = compareReproducibility({ a: { b: 1 }, c: [1, 2] }, { a: { b: 2 }, c: [1] });
    expect(r.identical).toBe(false);
    expect(r.differences).toEqual(expect.arrayContaining(['a.b', 'c.length']));
  });

  it('a real evaluation is reproducible through JSON storage', () => {
    const input = buildEngineInput(
      { kind: 'VERIFICATION_3_CYCLES', cycles: t3Cycles(), internalFactorsBefore: null, photometry: null },
      {},
    );
    const stored = JSON.parse(JSON.stringify(evaluateVerification(input, DEFAULT_CONFIG, DEFAULT_LIMITS)));
    const again = evaluateVerification(JSON.parse(JSON.stringify(input)), DEFAULT_CONFIG, DEFAULT_LIMITS);
    expect(compareReproducibility(stored, again).identical).toBe(true);
  });
});
