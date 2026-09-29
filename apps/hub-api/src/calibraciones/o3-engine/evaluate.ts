/**
 * Full evaluation of a verification (3 cycles) or reverification (1 cycle):
 * TAD 2023 App. A Eq. 1-10 + Table 4-1, and 40 CFR 50 App. D (D1, D2) when
 * photometry data is supplied. Deterministic, float64, no intermediate rounding.
 */

import type { DiffType, InternalFactors, OverallResult, RuleResult, VerificationKind } from './types.js';
import type { EngineConfig, Limits } from './limits.js';
import { pointDifference } from './differences.js';
import { leastSquares, DegenerateRegressionError, type RegressionResult } from './regression.js';
import { cycleStats } from './statistics.js';
import { convertPointsToStandard } from './equation10.js';
import {
  ruleV1,
  ruleV2,
  ruleV3,
  ruleV4,
  ruleV5,
  ruleV6,
  ruleV7,
  ruleV8,
  ruleR1,
  ruleR2,
  ruleR3,
  ruleR4,
  ruleR5,
  ruleQ1,
  ruleD1,
  ruleD2,
} from './rules.js';
import { ENGINE_VERSION } from './version.js';

export const REVERIFICATION_FAILED_MESSAGE = 'requiere verificación completa de 3 ciclos';

export interface PointInput {
  order: number;
  /** Nominal setpoint; setpoint 0 identifies the zero point. */
  setpointPpb?: number;
  /** Reference (x) reading, ppb. "Indicated" value when the reference uses option 2. */
  xPpb: number;
  /** Candidate (y) reading, ppb. */
  yPpb: number;
}

export interface CycleInput {
  index: number;
  points: PointInput[];
}

export interface VerificationInput {
  kind: VerificationKind;
  cycles: CycleInput[];
  /** Current verification of the reference equipment; option 2 triggers Eq. 10 on every x. */
  referenceVerification?: { traceabilityOption: 1 | 2; meanSlope: number; meanIntercept: number };
  /** Candidate's last full verification (R1, R2, R5). */
  lastVerification?: { meanSlope: number; meanIntercept: number; internalFactors?: InternalFactors };
  /** Candidate internal factors at this test (R5). */
  internalFactors?: InternalFactors;
  /** App. D data: D1 loss fraction (0-1) and D2 linearity error (%). */
  photometry?: { lossFraction?: number; linearityErrorPercent?: number };
  /** Informative Q1 qualification pairs. */
  qualification?: { referencePpb: number; measuredPpb: number }[];
}

export interface PointResult {
  order: number;
  setpointPpb?: number;
  /** x used in the calculation (after Eq. 10 when applied). */
  xPpb: number;
  /** Raw reference reading before Eq. 10. */
  xRawPpb: number;
  yPpb: number;
  isZero: boolean;
  diffValue: number;
  diffType: DiffType;
  pass: boolean;
  fitted: number | null;
  residual: number | null;
}

export interface CycleResult {
  index: number;
  points: PointResult[];
  regression: RegressionResult | null;
  /** Reason in es-CO when the regression could not be computed. */
  regressionError: string | null;
  pass: boolean;
}

export interface Aggregates {
  meanSlope: number;
  meanIntercept: number;
  sdSlope: number;
  sdIntercept: number;
  /** Highest x verified (standard units), i.e. the candidate range of use. */
  maxVerifiedPointPpb: number;
}

export interface EvaluationResult {
  kind: VerificationKind;
  engineVersion: string;
  limitsVersion: string;
  eq10Applied: boolean;
  cycles: CycleResult[];
  aggregates: Aggregates | null;
  rules: RuleResult[];
  overallResult: OverallResult;
  failReasons: string[];
  /** True when a failed reverification requires a full 3-cycle verification. */
  requiresFullVerification: boolean;
}

const isZeroPoint = (p: PointInput) => (p.setpointPpb !== undefined ? p.setpointPpb === 0 : p.xPpb === 0);

const tag = (r: RuleResult, cycleIndex?: number, pointOrder?: number): RuleResult => ({
  ...r,
  ...(cycleIndex !== undefined ? { cycleIndex } : {}),
  ...(pointOrder !== undefined ? { pointOrder } : {}),
});

function describeFailure(r: RuleResult): string {
  const where =
    r.pointOrder !== undefined
      ? ` (ciclo ${r.cycleIndex}, punto ${r.pointOrder})`
      : r.cycleIndex !== undefined
        ? ` (ciclo ${r.cycleIndex})`
        : '';
  const value = r.value === null ? '' : `: ${r.value}`;
  return `${r.id} – ${r.textEs}${where}${value} (límite ${r.limitText})`;
}

/**
 * Evaluates a verification or reverification. Throws only for structurally
 * invalid input (e.g. a reverification without exactly one cycle); every
 * acceptance problem is reported through rules and failReasons.
 */
export function evaluateVerification(
  input: VerificationInput,
  config: EngineConfig,
  limits: Limits,
): EvaluationResult {
  const isReverification = input.kind === 'REVERIFICATION_1_CYCLE';
  if (isReverification && input.cycles.length !== 1) {
    throw new RangeError(`a reverification needs exactly 1 cycle (got ${input.cycles.length})`);
  }

  const ref = input.referenceVerification;
  const eq10Applied = ref?.traceabilityOption === 2;
  const rules: RuleResult[] = [];

  const cycles: CycleResult[] = input.cycles.map((c) => {
    const pts = eq10Applied
      ? convertPointsToStandard(c.points, { meanSlope: ref!.meanSlope, meanIntercept: ref!.meanIntercept })
      : c.points.map((p) => ({ ...p, xRawPpb: p.xPpb }));

    const cycleRules: RuleResult[] = [];
    const points: PointResult[] = pts.map((p, j) => {
      const d = pointDifference(p.xPpb, p.yPpb, config);
      const rule = d.type === 'PERCENT' ? ruleV1(d.value, limits) : ruleV2(d.value, limits);
      cycleRules.push(tag(rule, c.index, p.order));
      return {
        order: p.order,
        ...(p.setpointPpb !== undefined ? { setpointPpb: p.setpointPpb } : {}),
        xPpb: p.xPpb,
        xRawPpb: p.xRawPpb,
        yPpb: p.yPpb,
        isZero: isZeroPoint(c.points[j]),
        diffValue: d.value,
        diffType: d.type,
        pass: rule.pass,
        fitted: null,
        residual: null,
      };
    });

    const zeroCount = points.filter((p) => p.isZero).length;
    cycleRules.push(tag(ruleV8(zeroCount, points.length - zeroCount, limits), c.index));

    let regression: RegressionResult | null = null;
    let regressionError: string | null = null;
    try {
      regression = leastSquares(
        points.map((p) => ({ x: p.xPpb, y: p.yPpb, zero: p.isZero })),
        { includeZero: config.includeZeroInRegression },
      );
      points.forEach((p, j) => {
        p.fitted = regression!.fitted[j];
        p.residual = regression!.residuals[j];
      });
    } catch (e) {
      if (!(e instanceof DegenerateRegressionError)) throw e;
      regressionError = 'No se pudo calcular la regresión del ciclo: faltan puntos o todos los x son iguales.';
    }

    if (regression && !isReverification) {
      cycleRules.push(tag(ruleV3(regression.slope, limits), c.index));
      cycleRules.push(tag(ruleV4(regression.intercept, limits), c.index));
    }

    rules.push(...cycleRules);
    return {
      index: c.index,
      points,
      regression,
      regressionError,
      pass: regression !== null && cycleRules.every((r) => r.pass),
    };
  });

  const fitted = cycles.filter((c) => c.regression !== null);
  let aggregates: Aggregates | null = null;
  if (fitted.length > 0) {
    const s = cycleStats(fitted.map((c) => ({ slope: c.regression!.slope, intercept: c.regression!.intercept })));
    aggregates = {
      meanSlope: s.meanSlope,
      meanIntercept: s.meanIntercept,
      sdSlope: s.sdSlope,
      sdIntercept: s.sdIntercept,
      maxVerifiedPointPpb: Math.max(...cycles.flatMap((c) => c.points.map((p) => p.xPpb))),
    };
  }

  if (isReverification) {
    const reg = cycles[0].regression;
    const last = input.lastVerification;
    if (reg) {
      rules.push(
        last
          ? ruleR1(reg.slope, last.meanSlope, limits)
          : { ...ruleR1(reg.slope, Number.NaN, limits), textEs: 'Sin verificación previa para comparar la pendiente', pass: false },
      );
      rules.push(
        last
          ? ruleR2(reg.intercept, last.meanIntercept, limits)
          : { ...ruleR2(reg.intercept, Number.NaN, limits), textEs: 'Sin verificación previa para comparar el intercepto', pass: false },
      );
      rules.push(ruleR3(reg.slope, limits));
      rules.push(ruleR4(reg.intercept, limits));
    }
    rules.push(ruleR5(input.internalFactors, last?.internalFactors));
  } else {
    rules.push(ruleV7(input.cycles.length, limits));
    if (aggregates) {
      rules.push(ruleV5(aggregates.sdSlope, limits));
      rules.push(ruleV6(aggregates.sdIntercept, limits));
    }
  }

  if (input.photometry?.lossFraction !== undefined) rules.push(ruleD1(input.photometry.lossFraction, limits));
  if (input.photometry?.linearityErrorPercent !== undefined) {
    rules.push(ruleD2(input.photometry.linearityErrorPercent, limits));
  }
  for (const q of input.qualification ?? []) rules.push(ruleQ1(q.referencePpb, q.measuredPpb, limits));

  const failReasons = rules.filter((r) => !r.pass && !r.informative).map(describeFailure);
  for (const c of cycles) {
    if (c.regressionError) failReasons.push(`Ciclo ${c.index}: ${c.regressionError}`);
  }
  if (cycles.length === 0) failReasons.push('La verificación no tiene ciclos.');

  const overallResult: OverallResult = failReasons.length === 0 ? 'CONFORME' : 'NO_CONFORME';
  const requiresFullVerification = isReverification && overallResult === 'NO_CONFORME';
  if (requiresFullVerification) failReasons.push(`El equipo ${REVERIFICATION_FAILED_MESSAGE}.`);

  return {
    kind: input.kind,
    engineVersion: ENGINE_VERSION,
    limitsVersion: limits.version,
    eq10Applied,
    cycles,
    aggregates,
    rules,
    overallResult,
    failReasons,
    requiresFullVerification,
  };
}
