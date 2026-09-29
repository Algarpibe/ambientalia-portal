/**
 * Traceability and business validations run before calculating (master prompt
 * §7; TAD 2023 §3.2, §4.5). Pure functions: they return issues, they never throw
 * for business-rule violations.
 */

import type { InternalFactors } from './types.js';
import type { EngineConfig } from './limits.js';

export type EquipmentType = 'SRP' | 'PHOTOMETRIC_CALIBRATOR' | 'GENERATOR_ONLY' | 'ANALYZER';
export type Application = 'BENCH' | 'FIELD';
export type Level = 1 | 2 | 3 | 4;
export type Route = 'SAMPLE_IN' | 'INTERNAL' | 'OTHER';
export type VerificationStatus = 'DRAFT' | 'CALCULATED' | 'APPROVED' | 'REJECTED';

export interface EquipmentInfo {
  id: string;
  type: EquipmentType;
  hasPhotometer: boolean;
  application: Application;
  currentLevel: Level | null;
}

export interface ReferenceVerificationInfo {
  status: VerificationStatus;
  /** ISO date (YYYY-MM-DD). Valid through this date, inclusive. */
  validUntil: string;
  /** Internal factors recorded at that verification. */
  internalFactors: InternalFactors;
  /** Route with which the reference was verified. */
  route: Route;
  /** Highest point verified for the reference (its range of use), ppb. */
  maxVerifiedPointPpb: number;
}

export interface TraceabilityInput {
  reference: EquipmentInfo;
  candidate: EquipmentInfo;
  /** ISO date of the test (YYYY-MM-DD). */
  testDate: string;
  referenceVerification?: ReferenceVerificationInfo;
  /** Reference internal factors as observed on the test date. */
  referenceCurrentInternalFactors?: InternalFactors;
  /** Route used for the reference in this test. */
  referenceRoute?: Route;
  /** Director enables a Level 4 candidate (TAD §4.5 strongly discourages it). */
  directorOverride?: boolean;
  /** Highest candidate point planned or measured, ppb. */
  candidateMaxPointPpb?: number;
  labTempStartC?: number;
  labTempEndC?: number;
  /** Planned setpoints (ppb, zero included) for the distribution check. */
  setpointsPpb?: number[];
  /** Calibration scale (ppb); defaults to the highest setpoint. */
  scalePpb?: number;
}

export type IssueCode =
  | 'REFERENCE_WITHOUT_LEVEL'
  | 'LEVEL_OUT_OF_RANGE'
  | 'LEVEL_MISMATCH'
  | 'LEVEL2_REQUIRES_SRP'
  | 'LEVEL3_REQUIRES_BENCH_LEVEL2'
  | 'LEVEL4_DISCOURAGED'
  | 'LEVEL4_QUARTERLY_REVERIFICATION'
  | 'CANDIDATE_NOT_PHOTOMETRIC'
  | 'REFERENCE_NOT_PHOTOMETRIC'
  | 'REFERENCE_WITHOUT_VERIFICATION'
  | 'REFERENCE_NOT_APPROVED'
  | 'REFERENCE_EXPIRED'
  | 'REFERENCE_FACTORS_CHANGED'
  | 'ABOVE_REFERENCE_RANGE'
  | 'POINT_DISTRIBUTION_GAP'
  | 'POINT_DISTRIBUTION_CLUSTERED'
  | 'LAB_TEMPERATURE'
  | 'ROUTE_MISMATCH';

export interface Issue {
  code: IssueCode;
  /** User-facing message in Spanish (es-CO). */
  messageEs: string;
  reference: string;
}

export interface TraceabilityResult {
  blocking: Issue[];
  warnings: Issue[];
  /** Level the candidate will get (reference level + 1), or null if unknown. */
  candidateLevel: number | null;
}

const PROMPT_S7 = 'IN.5.5.3 cap. 11 / TAD 2023';
const LAB_TEMP_MIN_C = 20;
const LAB_TEMP_MAX_C = 30;

const issue = (code: IssueCode, messageEs: string, reference = PROMPT_S7): Issue => ({ code, messageEs, reference });

const isPhotometric = (e: EquipmentInfo) => e.type !== 'GENERATOR_ONLY' && e.hasPhotometer;

function sameFactors(a: InternalFactors, b: InternalFactors): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && Object.is(a[k], b[k]));
}

/** Validates the §7 traceability rules for a reference/candidate pair. */
export function validateTraceability(input: TraceabilityInput): TraceabilityResult {
  const blocking: Issue[] = [];
  const warnings: Issue[] = [];
  const { reference: ref, candidate: cand } = input;

  // §7.2 - TAD 2023 §3.2: generator-only or photometer-less units cannot be reference or candidate.
  if (!isPhotometric(cand)) {
    blocking.push(
      issue(
        'CANDIDATE_NOT_PHOTOMETRIC',
        'El candidato es solo generador o no tiene fotómetro: no puede ser patrón de transferencia.',
        'TAD 2023 §3.2',
      ),
    );
  }
  if (!isPhotometric(ref)) {
    blocking.push(
      issue(
        'REFERENCE_NOT_PHOTOMETRIC',
        'El patrón es solo generador o no tiene fotómetro: no puede usarse como referencia.',
        'TAD 2023 §3.2',
      ),
    );
  }

  // §7.1 - candidate level = reference level + 1.
  let candidateLevel: number | null = null;
  if (ref.currentLevel === null) {
    blocking.push(issue('REFERENCE_WITHOUT_LEVEL', 'El patrón no tiene nivel de trazabilidad asignado.'));
  } else {
    candidateLevel = ref.currentLevel + 1;
    if (candidateLevel > 4) {
      blocking.push(issue('LEVEL_OUT_OF_RANGE', 'La cadena de trazabilidad no admite niveles superiores a 4.'));
    }
    if (cand.currentLevel !== null && cand.currentLevel !== candidateLevel) {
      blocking.push(
        issue(
          'LEVEL_MISMATCH',
          `El candidato es de nivel ${cand.currentLevel}, pero con este patrón quedaría de nivel ${candidateLevel}.`,
        ),
      );
    }
    if (candidateLevel === 2 && !(ref.currentLevel === 1 && ref.type === 'SRP')) {
      blocking.push(issue('LEVEL2_REQUIRES_SRP', 'Un Nivel 2 exige un patrón de Nivel 1 (SRP).'));
    }
    if (candidateLevel === 3 && ref.application !== 'BENCH') {
      blocking.push(
        issue('LEVEL3_REQUIRES_BENCH_LEVEL2', 'Un Nivel 3 exige un patrón de Nivel 2 de banco, no de campo.'),
      );
    }
    if (candidateLevel === 4) {
      if (input.directorOverride) {
        warnings.push(
          issue(
            'LEVEL4_QUARTERLY_REVERIFICATION',
            'Nivel 4 habilitado por el Director Técnico: la reverificación pasa a ser trimestral.',
            'TAD 2023 §4.5',
          ),
        );
      } else {
        blocking.push(
          issue(
            'LEVEL4_DISCOURAGED',
            'Un Nivel 4 está fuertemente desaconsejado; solo el Director Técnico puede habilitarlo.',
            'TAD 2023 §4.5',
          ),
        );
      }
    }
  }

  // §7.3 - reference must hold an APPROVED, valid verification with unchanged factors.
  const rv = input.referenceVerification;
  if (!rv) {
    blocking.push(issue('REFERENCE_WITHOUT_VERIFICATION', 'El patrón no tiene una verificación registrada.'));
  } else {
    if (rv.status !== 'APPROVED') {
      blocking.push(issue('REFERENCE_NOT_APPROVED', 'La verificación del patrón no está aprobada.'));
    }
    if (parseIsoDate(rv.validUntil) < parseIsoDate(input.testDate)) {
      blocking.push(
        issue('REFERENCE_EXPIRED', `La verificación del patrón venció el ${rv.validUntil}.`),
      );
    }
    if (input.referenceCurrentInternalFactors && !sameFactors(input.referenceCurrentInternalFactors, rv.internalFactors)) {
      blocking.push(
        issue(
          'REFERENCE_FACTORS_CHANGED',
          'Los factores internos del patrón cambiaron desde su última verificación.',
        ),
      );
    }
    // §7.4 - range of use.
    if (input.candidateMaxPointPpb !== undefined && input.candidateMaxPointPpb > rv.maxVerifiedPointPpb) {
      blocking.push(
        issue(
          'ABOVE_REFERENCE_RANGE',
          `El punto más alto del candidato (${input.candidateMaxPointPpb} ppb) supera el rango verificado del patrón (${rv.maxVerifiedPointPpb} ppb).`,
        ),
      );
    }
    // §7.8 - measurement routes.
    if (input.referenceRoute !== undefined && input.referenceRoute !== rv.route) {
      warnings.push(
        issue(
          'ROUTE_MISMATCH',
          `La ruta del patrón (${input.referenceRoute}) difiere de la ruta con la que fue verificado (${rv.route}).`,
        ),
      );
    }
  }

  // §7.7 - lab conditions.
  for (const t of [input.labTempStartC, input.labTempEndC]) {
    if (t !== undefined && (t < LAB_TEMP_MIN_C || t > LAB_TEMP_MAX_C)) {
      warnings.push(
        issue('LAB_TEMPERATURE', `La temperatura del laboratorio (${t} °C) está fuera del rango 20–30 °C.`),
      );
      break;
    }
  }

  // §7.5 - point distribution.
  if (input.setpointsPpb && input.setpointsPpb.length > 0) {
    warnings.push(...checkPointDistribution(input.setpointsPpb, { scalePpb: input.scalePpb }));
  }

  return { blocking, warnings, candidateLevel };
}

/**
 * §7.5 point distribution warnings. With N non-zero points and scale S the
 * ideal spacing is S/N. Warns when any gap (zero and scale included) exceeds
 * gapFactor × ideal, or when two consecutive non-zero points are closer than
 * clusterFactor × ideal. Factors are assumptions (see DECISIONS.md).
 */
export function checkPointDistribution(
  setpointsPpb: readonly number[],
  opts: { scalePpb?: number; gapFactor?: number; clusterFactor?: number } = {},
): Issue[] {
  const gapFactor = opts.gapFactor ?? 2;
  const clusterFactor = opts.clusterFactor ?? 0.5;
  const nonZero = [...setpointsPpb].filter((v) => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [];
  const scale = opts.scalePpb ?? nonZero[nonZero.length - 1];
  const ideal = scale / nonZero.length;
  const out: Issue[] = [];

  const stops = [0, ...nonZero];
  if (scale > nonZero[nonZero.length - 1]) stops.push(scale);
  for (let i = 1; i < stops.length; i++) {
    if (stops[i] - stops[i - 1] > gapFactor * ideal) {
      out.push(
        issue(
          'POINT_DISTRIBUTION_GAP',
          `Hay un hueco entre ${stops[i - 1]} y ${stops[i]} ppb mayor que el doble del espaciado ideal.`,
          'TAD 2023 §4 / IN.5.5.3 §7.5',
        ),
      );
      break;
    }
  }
  for (let i = 1; i < nonZero.length; i++) {
    if (nonZero[i] - nonZero[i - 1] < clusterFactor * ideal) {
      out.push(
        issue(
          'POINT_DISTRIBUTION_CLUSTERED',
          `Los puntos ${nonZero[i - 1]} y ${nonZero[i]} ppb están agrupados.`,
          'TAD 2023 §4 / IN.5.5.3 §7.5',
        ),
      );
      break;
    }
  }
  return out;
}

export interface ScaleResult {
  scalePpb: number;
  basis: 'MAX_3Y_HOURLY' | 'STANDARD';
}

/**
 * §7.6 scale assistant: scale = 1.5 × 3-year hourly maximum; if that is below
 * the air-quality standard, use 1.5 × standard.
 */
export function computeCalibrationScale(input: { max3yHourlyPpb: number; standardPpb: number }): ScaleResult {
  const fromMax = 1.5 * input.max3yHourlyPpb;
  if (fromMax < input.standardPpb) return { scalePpb: 1.5 * input.standardPpb, basis: 'STANDARD' };
  return { scalePpb: fromMax, basis: 'MAX_3Y_HOURLY' };
}

/**
 * §7.6 proposed setpoints: zero plus `nonZeroPoints` points equally spaced from
 * `lowestPointPpb` up to the scale. Defaults (6 points, lowest 15 ppb)
 * reproduce the TAD example for scale 200: 0, 15, 52, 89, 126, 163, 200.
 * The TAD rule for choosing the lowest point is not given in the prompt; 15 ppb
 * is taken from its example (see DECISIONS.md). No rounding is applied.
 */
export function proposeSetpoints(
  scalePpb: number,
  opts: { lowestPointPpb?: number; nonZeroPoints?: number } = {},
): number[] {
  const low = opts.lowestPointPpb ?? 15;
  const n = opts.nonZeroPoints ?? 6;
  if (!(n >= 2) || !Number.isInteger(n)) throw new RangeError('nonZeroPoints must be an integer >= 2');
  if (!(low > 0) || !(scalePpb > low)) throw new RangeError('scale must be greater than the lowest point (> 0)');
  const step = (scalePpb - low) / (n - 1);
  const pts = [0];
  for (let k = 0; k < n - 1; k++) pts.push(low + k * step);
  pts.push(scalePpb);
  return pts;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Parses a real calendar date YYYY-MM-DD to a UTC epoch-ms value; throws otherwise. */
function parseIsoDate(s: string): number {
  const m = ISO_DATE.exec(s);
  if (!m) throw new RangeError(`invalid ISO date: ${s}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new RangeError(`invalid calendar date: ${s}`);
  }
  return t;
}

function addDays(iso: string, days: number): string {
  return new Date(parseIsoDate(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

export interface ValidityResult {
  validUntil: string;
  /** Extra reverification due date (Level 2 FIELD, Level 4), or null. */
  reverificationDue: string | null;
}

/**
 * §7.9 validity: Level 2 annual (365 d) + 182 d reverification if FIELD;
 * Level 3 BENCH 365 d; Level 3 FIELD 182 d; Level 4 (override) quarterly.
 * "Annual" is taken as 365 days (DECISIONS.md). Level 1 (SRP) is certified
 * externally and is not computed here.
 */
export function computeValidUntil(
  verificationDate: string,
  level: Level,
  application: Application,
  config: Pick<EngineConfig, 'validityDays'>,
): ValidityResult {
  const d = config.validityDays;
  switch (level) {
    case 2:
      return {
        validUntil: addDays(verificationDate, d.level2Annual),
        reverificationDue: application === 'FIELD' ? addDays(verificationDate, d.level2FieldReverification) : null,
      };
    case 3:
      return {
        validUntil: addDays(verificationDate, application === 'BENCH' ? d.level3Bench : d.level3Field),
        reverificationDue: null,
      };
    case 4: {
      const q = addDays(verificationDate, d.level4Quarterly);
      return { validUntil: q, reverificationDue: q };
    }
    default:
      throw new RangeError('Level 1 (SRP) validity is set by its external certificate');
  }
}
