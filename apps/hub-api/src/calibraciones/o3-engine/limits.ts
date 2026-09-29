/**
 * Default acceptance limits (TAD 2023 Table 4-1 as transcribed in the master
 * prompt §6, plus 40 CFR 50 App. D) and engine configuration.
 *
 * The limits object is versioned: every stored verification must keep the
 * LIMITS_VERSION it was evaluated with so it can be recalculated identically.
 * Any change to a default value requires bumping LIMITS_VERSION.
 */

export const LIMITS_VERSION = '1.0.0';

export interface Limits {
  version: string;
  /** V1 - %Diff per point (x > threshold), strict: %Diff < maxPercent. */
  V1: { maxPercent: number };
  /** V2 - |AbsDiff| per point (x <= threshold). Inclusive (<=) by default; see DECISIONS.md. */
  V2: { maxAbsPpb: number; inclusive: boolean };
  /** V3 - per-cycle slope within nominal +/- tolerance (inclusive). */
  V3: { nominal: number; tolerance: number };
  /** V4 - per-cycle intercept within nominal +/- tolerance ppb (inclusive). */
  V4: { nominal: number; tolerancePpb: number };
  /** V5 - SD of slopes, strict: SDm < max. */
  V5: { max: number };
  /** V6 - SD of intercepts, strict: SDb < max (ppb). */
  V6: { maxPpb: number };
  /** V7 - required number of cycles in a full verification. */
  V7: { requiredCycles: number };
  /** V8 - a zero point plus at least minNonZeroPoints points per cycle. */
  V8: { minZeroPoints: number; minNonZeroPoints: number };
  /** R1 - |m - mBar(last verification)| <= max (inclusive). */
  R1: { max: number };
  /** R2 - |b - bBar(last verification)| <= max ppb (inclusive). */
  R2: { maxPpb: number };
  /** R3 - reverification slope within nominal +/- tolerance (inclusive). */
  R3: { nominal: number; tolerance: number };
  /** R4 - reverification intercept within nominal +/- tolerance ppb (inclusive). */
  R4: { nominal: number; tolerancePpb: number };
  /** Q1 - informative repeatability: |dev| <= max(percent of reference, ppb). */
  Q1: { percent: number; ppb: number };
  /** D1 - O3 loss fraction <= maxLossFraction (i.e. L >= 1 - maxLossFraction). */
  D1: { maxLossFraction: number };
  /** D2 - |linearity error| < maxPercent (strict). */
  D2: { maxPercent: number };
  /** C1 - analyzer one-point check in [minPpb, maxPpb]: |%diff| <= percent or |diff| <= ppb. */
  C1: { percent: number; ppb: number; minPpb: number; maxPpb: number };
  /** 40 CFR 50 App. D §3.1 photometer precision: SD <= max(ppb, percent of concentration). */
  photometerPrecision: { ppb: number; percent: number };
}

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  version: LIMITS_VERSION,
  V1: { maxPercent: 3.1 },
  V2: { maxAbsPpb: 1.5, inclusive: true },
  V3: { nominal: 1.0, tolerance: 0.03 },
  V4: { nominal: 0, tolerancePpb: 3 },
  V5: { max: 0.0075 },
  V6: { maxPpb: 1.0 },
  V7: { requiredCycles: 3 },
  V8: { minZeroPoints: 1, minNonZeroPoints: 6 },
  R1: { max: 0.015 },
  R2: { maxPpb: 1.5 },
  R3: { nominal: 1.0, tolerance: 0.03 },
  R4: { nominal: 0, tolerancePpb: 3 },
  Q1: { percent: 4, ppb: 4 },
  D1: { maxLossFraction: 0.05 },
  D2: { maxPercent: 3 },
  C1: { percent: 7.1, ppb: 1.5, minPpb: 5, maxPpb: 80 },
  photometerPrecision: { ppb: 5, percent: 3 },
});

export interface ValidityDays {
  /** Level 2: annual verification against the SRP. */
  level2Annual: number;
  /** Level 2 FIELD: additional reverification interval. */
  level2FieldReverification: number;
  /** Level 3 BENCH verification validity. */
  level3Bench: number;
  /** Level 3 FIELD verification validity. */
  level3Field: number;
  /** Level 4 (director override only): quarterly reverification. */
  level4Quarterly: number;
}

export interface EngineConfig {
  /** x <= threshold uses AbsDiff (Eq. 2); x > threshold uses %Diff (Eq. 1). */
  absDiffThresholdPpb: number;
  /** Whether zero points enter the least-squares fit (Eq. 3-4). */
  includeZeroInRegression: boolean;
  validityDays: ValidityDays;
}

export const DEFAULT_CONFIG: Readonly<EngineConfig> = Object.freeze({
  absDiffThresholdPpb: 50,
  includeZeroInRegression: true,
  validityDays: {
    level2Annual: 365,
    level2FieldReverification: 182,
    level3Bench: 365,
    level3Field: 182,
    level4Quarterly: 91,
  },
});
