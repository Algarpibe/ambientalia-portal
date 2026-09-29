/** Cycle aggregates (TAD 2023 App. A Eq. 6-9). */

export interface CycleCoefficients {
  slope: number;
  intercept: number;
}

export interface CycleStats {
  n: number;
  meanSlope: number;
  meanIntercept: number;
  sdSlope: number;
  sdIntercept: number;
}

/** Arithmetic mean. TAD 2023 App. A Eq. 6 / Eq. 7: (1/n) Σ v. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('mean of an empty set');
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/**
 * POPULATION standard deviation (divides by n, NOT n - 1).
 * TAD 2023 App. A Eq. 8 / Eq. 9: SD = √[(1/n) Σ (v - v̄)²].
 */
export function populationSd(values: readonly number[]): number {
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / values.length);
}

/** m̄, b̄ (Eq. 6-7) and SDm, SDb (Eq. 8-9) over the given cycles. */
export function cycleStats(cycles: readonly CycleCoefficients[]): CycleStats {
  if (cycles.length === 0) throw new RangeError('cycleStats needs at least one cycle');
  const slopes = cycles.map((c) => c.slope);
  const intercepts = cycles.map((c) => c.intercept);
  return {
    n: cycles.length,
    meanSlope: mean(slopes),
    meanIntercept: mean(intercepts),
    sdSlope: populationSd(slopes),
    sdIntercept: populationSd(intercepts),
  };
}
