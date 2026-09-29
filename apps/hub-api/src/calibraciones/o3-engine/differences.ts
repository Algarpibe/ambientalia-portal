import type { DiffType } from './types.js';
import type { EngineConfig } from './limits.js';

export interface PointDifference {
  value: number;
  type: DiffType;
}

/**
 * Percent difference. TAD 2023 App. A Eq. 1: %Diff = |y - x| / x * 100.
 * Only defined for x > 0; callers must route x <= threshold to absDiff.
 */
export function percentDiff(x: number, y: number): number {
  if (!(x > 0)) throw new RangeError(`percentDiff requires x > 0 (got ${x})`);
  return (Math.abs(y - x) / x) * 100;
}

/** Absolute (signed) difference in ppb. TAD 2023 App. A Eq. 2: AbsDiff = y - x. */
export function absDiff(x: number, y: number): number {
  return y - x;
}

/**
 * Selects Eq. 1 or Eq. 2 for one point (TAD 2023 App. A: "at or below 50 ppb").
 * x <= threshold -> AbsDiff; otherwise %Diff. x <= 0 always uses AbsDiff so the
 * engine never divides by zero, whatever the configured threshold.
 */
export function pointDifference(
  x: number,
  y: number,
  config: Pick<EngineConfig, 'absDiffThresholdPpb'>,
): PointDifference {
  if (x <= config.absDiffThresholdPpb || x <= 0) return { value: absDiff(x, y), type: 'ABS_PPB' };
  return { value: percentDiff(x, y), type: 'PERCENT' };
}
