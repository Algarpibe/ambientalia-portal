/**
 * Acceptance rules (TAD 2023 Table 4-1, 40 CFR 50 App. D). Each rule is a pure
 * function returning a RuleResult with its Spanish text, normative reference,
 * computed value, limit and pass/fail.
 *
 * Comparison semantics: strict limits ("<") use plain `<`. Inclusive limits
 * ("≤", "±") allow a 1e-9 absolute tolerance so that float64 representation
 * error (e.g. 1.015 - 1.0 = 0.015000000000000124) does not fail a value that
 * is exactly at the limit. See DECISIONS.md.
 */

import type { InternalFactors, RuleId, RuleResult, RuleScope } from './types.js';
import type { Limits } from './limits.js';

const INCLUSIVE_EPS = 1e-9;

const lte = (value: number, limit: number) => value <= limit + INCLUSIVE_EPS;
const lt = (value: number, limit: number) => value < limit;

/** es-CO number text for limit descriptions (comma decimal). */
const es = (n: number) => String(n).replace('.', ',');

const TAD_T41 = 'TAD 2023 (EPA-454/B-22-003) Tabla 4-1';

function result(
  id: RuleId,
  appliesTo: RuleScope,
  textEs: string,
  reference: string,
  value: number | null,
  limit: number | null,
  limitText: string,
  pass: boolean,
  informative = false,
): RuleResult {
  return { id, textEs, reference, value, limit, limitText, pass, appliesTo, informative };
}

/** V1 - %Diff per point (x > threshold) < 3.1 %. TAD 2023 Table 4-1; App. A Eq. 1. */
export function ruleV1(percentDiffValue: number, limits: Pick<Limits, 'V1'>): RuleResult {
  const max = limits.V1.maxPercent;
  return result(
    'V1',
    'POINT',
    'Diferencia porcentual del punto (x > 50 ppb)',
    `${TAD_T41}; App. A Ec. 1`,
    percentDiffValue,
    max,
    `< ${es(max)} %`,
    lt(percentDiffValue, max),
  );
}

/** V2 - |AbsDiff| per point (x <= threshold) <= 1.5 ppb (inclusive by default). TAD 2023 Table 4-1; App. A Eq. 2. */
export function ruleV2(absDiffValue: number, limits: Pick<Limits, 'V2'>): RuleResult {
  const { maxAbsPpb, inclusive } = limits.V2;
  const v = Math.abs(absDiffValue);
  return result(
    'V2',
    'POINT',
    'Diferencia absoluta del punto (x ≤ 50 ppb, incluido el cero)',
    `${TAD_T41}; App. A Ec. 2`,
    absDiffValue,
    maxAbsPpb,
    `${inclusive ? '≤' : '<'} ${es(maxAbsPpb)} ppb`,
    inclusive ? lte(v, maxAbsPpb) : lt(v, maxAbsPpb),
  );
}

/** V3 - per-cycle slope 1.00 ± 0.03. TAD 2023 Table 4-1; App. A Eq. 3. */
export function ruleV3(slope: number, limits: Pick<Limits, 'V3'>): RuleResult {
  const { nominal, tolerance } = limits.V3;
  return result(
    'V3',
    'CYCLE',
    'Pendiente del ciclo',
    `${TAD_T41}; App. A Ec. 3`,
    slope,
    tolerance,
    `${es(nominal)} ± ${es(tolerance)}`,
    lte(Math.abs(slope - nominal), tolerance),
  );
}

/** V4 - per-cycle intercept 0 ± 3 ppb. TAD 2023 Table 4-1; App. A Eq. 4. */
export function ruleV4(intercept: number, limits: Pick<Limits, 'V4'>): RuleResult {
  const { nominal, tolerancePpb } = limits.V4;
  return result(
    'V4',
    'CYCLE',
    'Intercepto del ciclo',
    `${TAD_T41}; App. A Ec. 4`,
    intercept,
    tolerancePpb,
    `${es(nominal)} ± ${es(tolerancePpb)} ppb`,
    lte(Math.abs(intercept - nominal), tolerancePpb),
  );
}

/** V5 - SD of slopes < 0.0075. TAD 2023 Table 4-1; App. A Eq. 8. */
export function ruleV5(sdSlope: number, limits: Pick<Limits, 'V5'>): RuleResult {
  const max = limits.V5.max;
  return result(
    'V5',
    'VERIFICATION',
    'Desviación estándar de las pendientes (SDm)',
    `${TAD_T41}; App. A Ec. 8`,
    sdSlope,
    max,
    `< ${es(max)}`,
    lt(sdSlope, max),
  );
}

/** V6 - SD of intercepts < 1.00 ppb. TAD 2023 Table 4-1; App. A Eq. 9. */
export function ruleV6(sdIntercept: number, limits: Pick<Limits, 'V6'>): RuleResult {
  const max = limits.V6.maxPpb;
  return result(
    'V6',
    'VERIFICATION',
    'Desviación estándar de los interceptos (SDb)',
    `${TAD_T41}; App. A Ec. 9`,
    sdIntercept,
    max,
    `< ${es(max)} ppb`,
    lt(sdIntercept, max),
  );
}

/** V7 - number of cycles = 3. TAD 2023 Table 4-1. */
export function ruleV7(cycleCount: number, limits: Pick<Limits, 'V7'>): RuleResult {
  const req = limits.V7.requiredCycles;
  return result(
    'V7',
    'VERIFICATION',
    'Número de ciclos de la verificación',
    TAD_T41,
    cycleCount,
    req,
    `= ${req}`,
    cycleCount === req,
  );
}

/** V8 - each cycle: zero + at least 6 points. TAD 2023 Table 4-1. */
export function ruleV8(zeroPoints: number, nonZeroPoints: number, limits: Pick<Limits, 'V8'>): RuleResult {
  const { minZeroPoints, minNonZeroPoints } = limits.V8;
  return result(
    'V8',
    'CYCLE',
    `Puntos del ciclo (cero: ${zeroPoints}, no cero: ${nonZeroPoints})`,
    TAD_T41,
    nonZeroPoints,
    minNonZeroPoints,
    `cero + ≥ ${minNonZeroPoints} puntos`,
    zeroPoints >= minZeroPoints && nonZeroPoints >= minNonZeroPoints,
  );
}

/** R1 - |m - m̄(last verification)| <= 0.015. TAD 2023 Table 4-1. */
export function ruleR1(slope: number, lastMeanSlope: number, limits: Pick<Limits, 'R1'>): RuleResult {
  const max = limits.R1.max;
  const v = Math.abs(slope - lastMeanSlope);
  return result(
    'R1',
    'REVERIFICATION',
    'Diferencia entre la pendiente y la pendiente promedio de la última verificación',
    TAD_T41,
    v,
    max,
    `≤ ${es(max)}`,
    lte(v, max),
  );
}

/** R2 - |b - b̄(last verification)| <= 1.5 ppb. TAD 2023 Table 4-1. */
export function ruleR2(intercept: number, lastMeanIntercept: number, limits: Pick<Limits, 'R2'>): RuleResult {
  const max = limits.R2.maxPpb;
  const v = Math.abs(intercept - lastMeanIntercept);
  return result(
    'R2',
    'REVERIFICATION',
    'Diferencia entre el intercepto y el intercepto promedio de la última verificación',
    TAD_T41,
    v,
    max,
    `≤ ${es(max)} ppb`,
    lte(v, max),
  );
}

/** R3 - reverification slope 1.00 ± 0.03. TAD 2023 Table 4-1. */
export function ruleR3(slope: number, limits: Pick<Limits, 'R3'>): RuleResult {
  const { nominal, tolerance } = limits.R3;
  return result(
    'R3',
    'REVERIFICATION',
    'Pendiente de la reverificación',
    TAD_T41,
    slope,
    tolerance,
    `${es(nominal)} ± ${es(tolerance)}`,
    lte(Math.abs(slope - nominal), tolerance),
  );
}

/** R4 - reverification intercept 0 ± 3 ppb. TAD 2023 Table 4-1. */
export function ruleR4(intercept: number, limits: Pick<Limits, 'R4'>): RuleResult {
  const { nominal, tolerancePpb } = limits.R4;
  return result(
    'R4',
    'REVERIFICATION',
    'Intercepto de la reverificación',
    TAD_T41,
    intercept,
    tolerancePpb,
    `${es(nominal)} ± ${es(tolerancePpb)} ppb`,
    lte(Math.abs(intercept - nominal), tolerancePpb),
  );
}

function sameFactors(a: InternalFactors, b: InternalFactors): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => k === kb[i] && Object.is(a[k], b[k]));
}

/**
 * R5 - internal factors identical to those of the last verification; if they
 * changed, a full 3-cycle verification is required. TAD 2023 Table 4-1.
 * Missing factors on either side fail (cannot prove "unchanged").
 */
export function ruleR5(current: InternalFactors | undefined, last: InternalFactors | undefined): RuleResult {
  const pass = current !== undefined && last !== undefined && sameFactors(current, last);
  return result(
    'R5',
    'REVERIFICATION',
    'Factores internos idénticos a los de la última verificación',
    TAD_T41,
    null,
    null,
    'Sin cambios',
    pass,
  );
}

/**
 * Q1 (informative) - repeatability against influence variables:
 * |measured - reference| <= max(4 % of reference, 4 ppb). TAD 2023 Table 4-1.
 * Never affects the overall result.
 */
export function ruleQ1(referencePpb: number, measuredPpb: number, limits: Pick<Limits, 'Q1'>): RuleResult {
  const { percent, ppb } = limits.Q1;
  const dev = measuredPpb - referencePpb;
  const allowed = Math.max((percent / 100) * Math.abs(referencePpb), ppb);
  return result(
    'Q1',
    'QUALIFICATION',
    'Repetibilidad frente a variables de influencia (informativo)',
    TAD_T41,
    dev,
    allowed,
    `± ${es(percent)} % o ± ${es(ppb)} ppb (el mayor)`,
    lte(Math.abs(dev), allowed),
    true,
  );
}

/** D1 - O3 loss fraction <= 5 % (L >= 0.95). 40 CFR 50 App. D §5.2.5. */
export function ruleD1(lossFraction: number, limits: Pick<Limits, 'D1'>): RuleResult {
  const max = limits.D1.maxLossFraction;
  return result(
    'D1',
    'APP_D',
    'Pérdida de ozono en el fotómetro',
    '40 CFR 50 App. D §5.2.5',
    lossFraction * 100,
    max * 100,
    `≤ ${es(max * 100)} %`,
    lte(lossFraction, max),
  );
}

/** D2 - |linearity error| < 3 %. 40 CFR 50 App. D §5.2.3. */
export function ruleD2(linearityErrorPercentValue: number, limits: Pick<Limits, 'D2'>): RuleResult {
  const max = limits.D2.maxPercent;
  return result(
    'D2',
    'APP_D',
    'Error de linealidad del fotómetro',
    '40 CFR 50 App. D §5.2.3',
    linearityErrorPercentValue,
    max,
    `|E| < ${es(max)} %`,
    lt(Math.abs(linearityErrorPercentValue), max),
  );
}

/**
 * C1 - analyzer one-point check in the 5-80 ppb range: passes when
 * |%diff| <= 7.1 % OR |diff| <= 1.5 ppb (whichever is less restrictive).
 * A reference concentration outside 5-80 ppb fails (the check is not valid
 * there). TAD 2023 Table 4-1 (analyzers, optional module).
 */
export function ruleC1(referencePpb: number, analyzerPpb: number, limits: Pick<Limits, 'C1'>): RuleResult {
  const { percent, ppb, minPpb, maxPpb } = limits.C1;
  const inRange = referencePpb >= minPpb && referencePpb <= maxPpb;
  const diff = analyzerPpb - referencePpb;
  const pct = inRange ? (Math.abs(diff) / referencePpb) * 100 : Number.NaN;
  const pass = inRange && (lte(pct, percent) || lte(Math.abs(diff), ppb));
  return result(
    'C1',
    'ANALYZER',
    inRange
      ? 'Verificación de un punto del analizador'
      : `Verificación de un punto del analizador: la concentración debe estar entre ${es(minPpb)} y ${es(maxPpb)} ppb`,
    TAD_T41,
    inRange ? pct : null,
    percent,
    `± ${es(percent)} % o ± ${es(ppb)} ppb`,
    pass,
  );
}
