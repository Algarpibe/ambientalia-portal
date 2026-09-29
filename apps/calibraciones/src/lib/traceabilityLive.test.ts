import { describe, expect, it } from 'vitest';
import type { Equipment, Verification } from '../types';
import { emptyDraft, toPayload } from './draft';
import { liveTraceability, pickCurrentVerification, referenceInfoFromCertificate } from './traceabilityLive';

const eq = (over: Partial<Equipment>): Equipment => ({
  id: 'e',
  brand: 'Environics',
  model: '6103',
  serial: 's',
  internalCode: 'X',
  type: 'PHOTOMETRIC_CALIBRATOR',
  hasPhotometer: true,
  application: 'BENCH',
  currentLevel: null,
  notes: null,
  certificateNumber: null,
  certificateValidUntil: null,
  certificateMaxPpb: null,
  certificateRoute: null,
  active: true,
  createdAt: '',
  updatedAt: '',
  ...over,
});

const SRP = eq({
  id: 'srp',
  type: 'SRP',
  currentLevel: 1,
  certificateNumber: 'C-1',
  certificateValidUntil: '2027-01-01',
  certificateMaxPpb: 500,
  certificateRoute: 'SAMPLE_IN',
});
const CAND = eq({ id: 'cand', internalCode: '6103-S' });

const ver = (over: Partial<Verification>): Verification =>
  ({
    id: 'v',
    kind: 'VERIFICATION_3_CYCLES',
    status: 'APPROVED',
    overallResult: 'CONFORME',
    verificationDate: '2026-01-10',
    version: 1,
    validUntil: '2027-01-10',
    reverificationDue: null,
    internalFactorsBefore: { span: 1 },
    internalFactorsAfter: null,
    candidateRoute: 'SAMPLE_IN',
    maxVerifiedPointPpb: 400,
    traceabilityOption: 1,
    meanSlope: 1.001,
    meanIntercept: 0.1,
    ...over,
  }) as Verification;

function payloadWith(maxX: number, extra: Partial<ReturnType<typeof emptyDraft>> = {}) {
  const d = { ...emptyDraft('2026-09-29'), referenceEquipmentId: 'srp', candidateEquipmentId: 'cand', ...extra };
  d.cycles[0].rows[0] = { ...d.cycles[0].rows[0], setpoint: '0', x: '0', y: '0' };
  d.cycles[0].rows[1] = { ...d.cycles[0].rows[1], setpoint: String(maxX), x: String(maxX), y: String(maxX) };
  return toPayload(d).payload;
}

describe('referenceInfoFromCertificate (D-018)', () => {
  it('an SRP certificate plays the approved reference verification', () => {
    expect(referenceInfoFromCertificate(SRP, null)).toEqual({
      status: 'APPROVED',
      validUntil: '2027-01-01',
      internalFactors: {},
      route: 'SAMPLE_IN',
      maxVerifiedPointPpb: 500,
    });
  });
  it('no certificate date or range → no reference verification', () => {
    expect(referenceInfoFromCertificate({ ...SRP, certificateMaxPpb: null }, null)).toBeUndefined();
  });
});

describe('liveTraceability', () => {
  it('SRP → photometric candidate within range: nothing blocks, candidate gets level 2', () => {
    const r = liveTraceability({ reference: SRP, candidate: CAND, referenceVerification: null, payload: payloadWith(200) });
    expect(r.blocking).toEqual([]);
    expect(r.candidateLevel).toBe(2);
  });
  it('blocking issues: generator-only candidate, point above the reference range, SRP without certificate', () => {
    const gen = eq({ id: 'cand', type: 'GENERATOR_ONLY', hasPhotometer: false });
    expect(
      liveTraceability({ reference: SRP, candidate: gen, referenceVerification: null, payload: payloadWith(200) }).blocking.map(
        (i) => i.code,
      ),
    ).toContain('CANDIDATE_NOT_PHOTOMETRIC');
    expect(
      liveTraceability({ reference: SRP, candidate: CAND, referenceVerification: null, payload: payloadWith(600) }).blocking.map(
        (i) => i.code,
      ),
    ).toEqual(['ABOVE_REFERENCE_RANGE']);
    expect(
      liveTraceability({
        reference: { ...SRP, certificateValidUntil: null },
        candidate: CAND,
        referenceVerification: null,
        payload: payloadWith(200),
      }).blocking.map((i) => i.code),
    ).toEqual(['REFERENCE_WITHOUT_VERIFICATION']);
  });
  it('warnings are kept apart from blocking issues (lab temperature)', () => {
    const r = liveTraceability({
      reference: SRP,
      candidate: CAND,
      referenceVerification: null,
      payload: payloadWith(200, { labTempStartC: '31' }),
    });
    expect(r.blocking).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('LAB_TEMPERATURE');
  });
  it('a NO CONFORME approved reference verification blocks (service extra rule)', () => {
    const ref = eq({ id: 'ref', currentLevel: 2 });
    const r = liveTraceability({
      reference: ref,
      candidate: CAND,
      referenceVerification: ver({ overallResult: 'NO_CONFORME', validUntil: null }),
      payload: payloadWith(200),
    });
    expect(r.blocking.map((i) => i.code)).toContain('REFERENCE_NOT_CONFORME');
  });
});

describe('pickCurrentVerification', () => {
  const history = [
    ver({ id: 'draft', status: 'DRAFT', verificationDate: '2026-09-01' }),
    ver({ id: 'future', verificationDate: '2026-12-01' }),
    ver({ id: 'rev', kind: 'REVERIFICATION_1_CYCLE', verificationDate: '2026-06-01' }),
    ver({ id: 'nc', overallResult: 'NO_CONFORME', verificationDate: '2026-05-01' }),
    ver({ id: 'old', verificationDate: '2026-01-10' }),
    ver({ id: 'old-v2', verificationDate: '2026-01-10', version: 2 }),
  ];
  it('latest APPROVED + CONFORME on or before the date; a newer version wins on the same date', () => {
    expect(pickCurrentVerification(history, '2026-09-29')?.id).toBe('rev');
    expect(pickCurrentVerification(history, '2026-09-29', 'VERIFICATION_3_CYCLES')?.id).toBe('old-v2');
    expect(pickCurrentVerification(history, '2025-01-01')).toBeNull();
  });
});
