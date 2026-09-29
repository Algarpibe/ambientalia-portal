/** Traceability option 2: standard concentration from indicated value (TAD 2023 App. A Eq. 10). */

/**
 * TAD 2023 App. A Eq. 10: Std = (1/m̄)·(Indicated - b̄), using the CURRENT
 * m̄ and b̄ of the reference equipment's valid verification.
 */
export function toStandardConcentration(indicatedPpb: number, meanSlope: number, meanIntercept: number): number {
  if (!Number.isFinite(meanSlope) || meanSlope === 0) {
    throw new RangeError(`Eq. 10 requires a finite, non-zero slope (got ${meanSlope})`);
  }
  if (!Number.isFinite(meanIntercept)) throw new RangeError('Eq. 10 requires a finite intercept');
  return (indicatedPpb - meanIntercept) / meanSlope;
}

export interface Eq10Coefficients {
  meanSlope: number;
  meanIntercept: number;
}

/**
 * Converts every reference reading x of a cycle with Eq. 10. Used automatically
 * when the reference verification used traceabilityOption 2. Keeps the raw
 * reading in xRawPpb.
 */
export function convertPointsToStandard<P extends { xPpb: number }>(
  points: readonly P[],
  coeffs: Eq10Coefficients,
): (P & { xRawPpb: number })[] {
  return points.map((p) => ({
    ...p,
    xRawPpb: p.xPpb,
    xPpb: toStandardConcentration(p.xPpb, coeffs.meanSlope, coeffs.meanIntercept),
  }));
}
