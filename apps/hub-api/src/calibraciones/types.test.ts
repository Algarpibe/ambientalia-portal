import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_LIMITS } from './o3-engine/index.js';
import {
  CalError,
  parseConfig,
  parseEquipmentInput,
  parseLimitsInput,
  parseVerificationDraft,
} from './types.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function expectInvalid(fn: () => unknown, field?: string): CalError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CalError);
    const err = e as CalError;
    expect(err.status).toBe(400);
    expect(err.code).toBe('invalid_input');
    if (field) expect(err.field).toBe(field);
    return err;
  }
  throw new Error('expected a CalError');
}

const equipment = {
  brand: 'Thermo',
  model: '49i-PS',
  serial: 'SN-1',
  internalCode: '6103-S',
  type: 'PHOTOMETRIC_CALIBRATOR',
  hasPhotometer: true,
  application: 'BENCH',
};

describe('parseEquipmentInput', () => {
  it('accepts a minimal equipment and fills optional fields with null/defaults', () => {
    expect(parseEquipmentInput(equipment)).toEqual({
      ...equipment,
      currentLevel: null,
      notes: null,
      certificateNumber: null,
      certificateValidUntil: null,
      certificateMaxPpb: null,
      certificateRoute: null,
      active: true,
    });
  });

  it('rejects an unknown type', () => {
    expectInvalid(() => parseEquipmentInput({ ...equipment, type: 'LAMP' }), 'type');
  });

  it('rejects a level outside 1-4', () => {
    expectInvalid(() => parseEquipmentInput({ ...equipment, currentLevel: 5 }), 'currentLevel');
  });

  it('rejects a missing internal code', () => {
    expectInvalid(() => parseEquipmentInput({ ...equipment, internalCode: '  ' }), 'internalCode');
  });

  it('rejects an invalid certificate date', () => {
    expectInvalid(() => parseEquipmentInput({ ...equipment, certificateValidUntil: '2026-02-30' }), 'certificateValidUntil');
  });
});

const draft = {
  kind: 'VERIFICATION_3_CYCLES',
  verificationDate: '2026-09-01',
  referenceEquipmentId: UUID_A,
  candidateEquipmentId: UUID_B,
  cycles: [{ index: 1, points: [{ order: 1, setpointPpb: 0, xPpb: 0, yPpb: 0.3 }] }],
};

describe('parseVerificationDraft', () => {
  it('accepts a minimal draft with defaults', () => {
    const v = parseVerificationDraft(draft);
    expect(v.traceabilityOption).toBe(1);
    expect(v.referenceVerificationId).toBeNull();
    expect(v.directorOverrideLevel4).toBe(false);
    expect(v.cycles[0].points[0]).toMatchObject({ order: 1, setpointPpb: 0, xPpb: 0, yPpb: 0.3 });
  });

  it('rejects the same equipment as reference and candidate', () => {
    expectInvalid(() => parseVerificationDraft({ ...draft, candidateEquipmentId: UUID_A }), 'candidateEquipmentId');
  });

  it('rejects a non-UUID equipment id', () => {
    expectInvalid(() => parseVerificationDraft({ ...draft, referenceEquipmentId: 'abc' }), 'referenceEquipmentId');
  });

  it('rejects duplicated cycle indexes', () => {
    const c = draft.cycles[0];
    expectInvalid(() => parseVerificationDraft({ ...draft, cycles: [c, c] }), 'cycles');
  });

  it('rejects duplicated point orders in a cycle', () => {
    const p = draft.cycles[0].points[0];
    expectInvalid(() => parseVerificationDraft({ ...draft, cycles: [{ index: 1, points: [p, p] }] }), 'cycles');
  });

  it('rejects non-finite readings', () => {
    expectInvalid(() =>
      parseVerificationDraft({ ...draft, cycles: [{ index: 1, points: [{ order: 1, xPpb: 'x', yPpb: 1 }] }] }),
    );
  });

  it('rejects a traceability option other than 1 or 2', () => {
    expectInvalid(() => parseVerificationDraft({ ...draft, traceabilityOption: 3 }), 'traceabilityOption');
  });

  it('rejects internal factors that are not numeric maps', () => {
    expectInvalid(() => parseVerificationDraft({ ...draft, internalFactorsBefore: { span: 'a' } }), 'internalFactorsBefore');
  });

  it('rejects an unknown kind', () => {
    expectInvalid(() => parseVerificationDraft({ ...draft, kind: 'OTHER' }), 'kind');
  });
});

describe('parseLimitsInput', () => {
  const clone = () => JSON.parse(JSON.stringify(DEFAULT_LIMITS));

  it('accepts a limits object with the engine structure', () => {
    const l = { ...clone(), version: '1.1.0' };
    expect(parseLimitsInput({ version: '1.1.0', limits: l, reason: 'Ajuste' })).toEqual({
      version: '1.1.0',
      limits: l,
      reason: 'Ajuste',
    });
  });

  it('requires a reason', () => {
    expectInvalid(() => parseLimitsInput({ version: '1.1.0', limits: { ...clone(), version: '1.1.0' } }), 'reason');
  });

  it('requires limits.version to match the version', () => {
    expectInvalid(() => parseLimitsInput({ version: '1.1.0', limits: clone(), reason: 'x' }), 'version');
  });

  it('rejects a missing rule', () => {
    const l = { ...clone(), version: '1.1.0' };
    delete l.V1;
    expectInvalid(() => parseLimitsInput({ version: '1.1.0', limits: l, reason: 'x' }), 'limits');
  });

  it('rejects a wrong value type', () => {
    const l = { ...clone(), version: '1.1.0' };
    l.V2.inclusive = 'yes';
    expectInvalid(() => parseLimitsInput({ version: '1.1.0', limits: l, reason: 'x' }), 'limits');
  });

  it('rejects unknown extra keys', () => {
    const l = { ...clone(), version: '1.1.0', V9: { max: 1 } };
    expectInvalid(() => parseLimitsInput({ version: '1.1.0', limits: l, reason: 'x' }), 'limits');
  });
});

describe('parseConfig', () => {
  const clone = () => JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  it('accepts the default config', () => {
    expect(parseConfig({ config: clone(), reason: 'x' })).toEqual({ config: clone(), reason: 'x' });
  });

  it('rejects non-positive validity days', () => {
    const c = clone();
    c.validityDays.level3Bench = 0;
    expectInvalid(() => parseConfig({ config: c, reason: 'x' }), 'config');
  });

  it('rejects a negative threshold', () => {
    expectInvalid(() => parseConfig({ config: { ...clone(), absDiffThresholdPpb: -1 }, reason: 'x' }), 'config');
  });

  it('requires a reason', () => {
    expectInvalid(() => parseConfig({ config: clone() }), 'reason');
  });
});
