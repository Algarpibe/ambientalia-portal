/**
 * Test data for the report/label/export builders: the TAD T3 example
 * (master prompt §9) evaluated by the real engine, shaped like the API
 * detail of a stored verification (SRP-CALAIRE → 6103-S).
 */
import { T3_X, T3_Y } from '../../../hub-api/src/calibraciones/o3-engine/fixtures.test-data';
import { DEFAULT_CONFIG, DEFAULT_LIMITS, evaluateVerification, type VerificationInput } from '../engine';
import type { Equipment, Verification, VerificationDetail } from '../types';

const baseEquipment = {
  notes: null,
  certificateNumber: null,
  certificateValidUntil: null,
  certificateMaxPpb: null,
  certificateRoute: null,
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
} as const;

export const SRP: Equipment = {
  ...baseEquipment,
  id: 'eq-srp',
  brand: 'NIST',
  model: 'SRP',
  serial: 'DEMO-SRP-001',
  internalCode: 'SRP-CALAIRE',
  type: 'SRP',
  hasPhotometer: true,
  application: 'BENCH',
  currentLevel: 1,
  certificateNumber: 'DEMO-CERT-001',
  certificateValidUntil: '2027-06-30',
  certificateMaxPpb: 500,
  certificateRoute: 'SAMPLE_IN',
};

export const BENCH_6103: Equipment = {
  ...baseEquipment,
  id: 'eq-6103s',
  brand: 'Environics',
  model: '6103',
  serial: 'DEMO-6103-S',
  internalCode: '6103-S',
  type: 'PHOTOMETRIC_CALIBRATOR',
  hasPhotometer: true,
  application: 'BENCH',
  currentLevel: 2,
};

export function t3Detail(overrides: Partial<Verification> = {}): VerificationDetail {
  const input: VerificationInput = {
    kind: 'VERIFICATION_3_CYCLES',
    cycles: T3_Y.map((ys, i) => ({
      index: i + 1,
      points: T3_X.map((x, j) => ({ order: j + 1, setpointPpb: x, xPpb: x, yPpb: ys[j] })),
    })),
  };
  const evaluation = evaluateVerification(input, DEFAULT_CONFIG, DEFAULT_LIMITS);
  const agg = evaluation.aggregates!;
  return {
    id: '3f2a9c1e-0000-4000-8000-000000000001',
    kind: 'VERIFICATION_3_CYCLES',
    verificationDate: '2026-09-01',
    location: 'Laboratorio Bogotá',
    referenceEquipmentId: SRP.id,
    candidateEquipmentId: BENCH_6103.id,
    referenceVerificationId: null,
    referenceRoute: 'SAMPLE_IN',
    candidateRoute: 'SAMPLE_IN',
    traceabilityOption: 1,
    internalFactorsBefore: { span: 1.0021, zero: 0.3 },
    internalFactorsAfter: { span: 1.0, zero: 0 },
    referenceInternalFactors: null,
    labTempStartC: 22,
    labTempEndC: 23.5,
    labRhPct: 45,
    baroPressureTorr: 560.2,
    totalFlowSlpm: 5,
    calibrationScalePpb: 200,
    acceptanceChecklist: { warmup: true, leakTest: true, diagnostics: true, tpContrast: true, averaging: true, noiseFilt: false, warmupMinutes: 45 },
    photometry: null,
    directorOverrideLevel4: false,
    status: 'APPROVED',
    technicianId: 'u-tech',
    technicianEmail: 'tecnico@ambientalia.test',
    approvedById: 'u-dir',
    approvedByEmail: 'director@ambientalia.test',
    candidateLastVerificationId: null,
    meanSlope: agg.meanSlope,
    meanIntercept: agg.meanIntercept,
    sdSlope: agg.sdSlope,
    sdIntercept: agg.sdIntercept,
    maxVerifiedPointPpb: agg.maxVerifiedPointPpb,
    overallResult: evaluation.overallResult,
    failReasons: evaluation.failReasons,
    candidateLevel: 2,
    validUntil: '2027-09-01',
    reverificationDue: null,
    engineVersion: evaluation.engineVersion,
    limitsVersion: evaluation.limitsVersion,
    limitsSnapshot: DEFAULT_LIMITS,
    configSnapshot: DEFAULT_CONFIG,
    engineInput: input,
    evaluation,
    traceabilityWarnings: [],
    version: 1,
    supersedesId: null,
    changeReason: null,
    rejectionReason: null,
    calculatedAt: '2026-09-01T15:00:00Z',
    approvedAt: '2026-09-02T10:00:00Z',
    rejectedAt: null,
    createdAt: '2026-09-01T14:00:00Z',
    updatedAt: '2026-09-02T10:00:00Z',
    cycles: evaluation.cycles.map((c) => ({
      index: c.index,
      slope: c.regression?.slope ?? null,
      intercept: c.regression?.intercept ?? null,
      r2: c.regression?.r2 ?? null,
      pass: c.pass,
      regressionError: c.regressionError,
      points: c.points.map((p) => ({
        order: p.order,
        setpointPpb: p.setpointPpb ?? null,
        xPpb: p.xRawPpb,
        yPpb: p.yPpb,
        cellTempXC: 25.1,
        cellTempYC: 25.3,
        cellPressXTorr: 560.1,
        cellPressYTorr: 559.8,
        readingsCount: null,
        timestampStable: `2026-09-0${c.index}T10:00:00Z`,
        xStdPpb: p.xPpb,
        diffValue: p.diffValue,
        diffType: p.diffType,
        pass: p.pass,
      })),
    })),
    ...overrides,
  };
}
