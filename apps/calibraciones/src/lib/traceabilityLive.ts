/**
 * Live §7 traceability check in the browser (step 1 of the wizard).
 *
 * Mirrors what hub-api `service.calculate` feeds `validateTraceability`
 * (referenceInfoFromCertificate / referenceInfoFromVerification, the extra
 * REFERENCE_NOT_CONFORME rule, D-025 inputs). It is a PREVIEW: the server
 * resolves the reference verification from the database at calculate time
 * and its 422 list is authoritative.
 */
import {
  validateTraceability,
  type EquipmentInfo,
  type Issue,
  type ReferenceVerificationInfo,
  type Route,
  type TraceabilityResult,
  type VerificationKind,
} from '../engine';
import type { Equipment, Verification, VerificationDraftInput } from '../types';

export function toEquipmentInfo(e: Equipment): EquipmentInfo {
  return { id: e.id, type: e.type, hasPhotometer: e.hasPhotometer, application: e.application, currentLevel: e.currentLevel };
}

/** D-018: an SRP's external certificate plays the approved reference verification. */
export function referenceInfoFromCertificate(
  eq: Pick<Equipment, 'certificateValidUntil' | 'certificateMaxPpb' | 'certificateRoute'>,
  testRoute: Route | null,
): ReferenceVerificationInfo | undefined {
  if (!eq.certificateValidUntil || eq.certificateMaxPpb === null) return undefined;
  return {
    status: 'APPROVED',
    validUntil: eq.certificateValidUntil,
    internalFactors: {},
    route: eq.certificateRoute ?? testRoute ?? 'SAMPLE_IN',
    maxVerifiedPointPpb: eq.certificateMaxPpb,
  };
}

export function referenceInfoFromVerification(v: Verification): ReferenceVerificationInfo {
  return {
    status: v.status,
    validUntil: v.validUntil ?? v.verificationDate,
    internalFactors: v.internalFactorsAfter ?? v.internalFactorsBefore ?? {},
    route: v.candidateRoute ?? 'SAMPLE_IN',
    maxVerifiedPointPpb: v.maxVerifiedPointPpb ?? 0,
  };
}

/**
 * The equipment's current valid verification as of a date, from its history:
 * the latest APPROVED + CONFORME on or before the date (a newer version wins
 * on the same date). Approximates hub-api `repo.currentVerifications`.
 */
export function pickCurrentVerification(
  history: readonly Verification[],
  asOf: string,
  kind?: VerificationKind,
): Verification | null {
  const candidates = history
    .filter(
      (v) =>
        v.status === 'APPROVED' &&
        v.overallResult === 'CONFORME' &&
        v.verificationDate.slice(0, 10) <= asOf &&
        (!kind || v.kind === kind),
    )
    .sort((a, b) => b.verificationDate.localeCompare(a.verificationDate) || b.version - a.version);
  return candidates[0] ?? null;
}

const NOT_CONFORME: Issue = {
  code: 'REFERENCE_NOT_CONFORME' as Issue['code'],
  messageEs: 'La verificación del patrón resultó NO CONFORME.',
  reference: 'IN.5.5.3 cap. 11 / TAD 2023',
};

export function liveTraceability(args: {
  reference: Equipment;
  candidate: Equipment;
  /** The reference's verification in use (ignored for an SRP). */
  referenceVerification: Verification | null;
  payload: VerificationDraftInput;
}): TraceabilityResult {
  const { reference, candidate, referenceVerification: rv, payload: p } = args;
  const refInfo =
    reference.type === 'SRP'
      ? referenceInfoFromCertificate(reference, p.referenceRoute)
      : rv
        ? referenceInfoFromVerification(rv)
        : undefined;
  const allPoints = p.cycles.flatMap((c) => c.points);
  const cycle1 = [...p.cycles].sort((a, b) => a.index - b.index)[0];
  const setpoints = (cycle1?.points ?? []).map((pt) => pt.setpointPpb).filter((s): s is number => s !== null);
  const result = validateTraceability({
    reference: toEquipmentInfo(reference),
    candidate: toEquipmentInfo(candidate),
    testDate: p.verificationDate,
    referenceVerification: refInfo,
    ...(p.referenceInternalFactors ? { referenceCurrentInternalFactors: p.referenceInternalFactors } : {}),
    ...(p.referenceRoute ? { referenceRoute: p.referenceRoute } : {}),
    directorOverride: p.directorOverrideLevel4,
    ...(allPoints.length ? { candidateMaxPointPpb: Math.max(...allPoints.map((pt) => pt.xPpb)) } : {}),
    ...(p.labTempStartC !== null ? { labTempStartC: p.labTempStartC } : {}),
    ...(p.labTempEndC !== null ? { labTempEndC: p.labTempEndC } : {}),
    ...(setpoints.length ? { setpointsPpb: setpoints } : {}),
    ...(p.calibrationScalePpb !== null ? { scalePpb: p.calibrationScalePpb } : {}),
  });
  if (reference.type !== 'SRP' && rv && rv.status === 'APPROVED' && rv.overallResult !== 'CONFORME') {
    result.blocking.push(NOT_CONFORME);
  }
  return result;
}
