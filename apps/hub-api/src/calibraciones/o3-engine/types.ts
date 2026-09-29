/**
 * Shared types of the O3 transfer-standard calculation engine.
 * Pure data shapes: no runtime code, no imports outside this folder.
 * All concentrations are in ppb (float64) unless a name says otherwise.
 */

export type DiffType = 'PERCENT' | 'ABS_PPB';

export type VerificationKind = 'VERIFICATION_3_CYCLES' | 'REVERIFICATION_1_CYCLE';

export type OverallResult = 'CONFORME' | 'NO_CONFORME';

export type RuleId =
  | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8'
  | 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
  | 'Q1' | 'D1' | 'D2' | 'C1';

export type RuleScope =
  | 'POINT'
  | 'CYCLE'
  | 'VERIFICATION'
  | 'REVERIFICATION'
  | 'QUALIFICATION'
  | 'APP_D'
  | 'ANALYZER';

/** Internal photometer factors (e.g. span, zero) as keyed numeric values. */
export type InternalFactors = Record<string, number>;

export interface RuleResult {
  id: RuleId;
  /** User-facing rule text in Spanish (es-CO). */
  textEs: string;
  /** Normative reference, e.g. "TAD 2023 Tabla 4-1". */
  reference: string;
  /** Computed value that was compared, or null when not numeric. */
  value: number | null;
  /** Numeric limit (tolerance) the value was compared against, or null. */
  limit: number | null;
  /** Human-readable limit in es-CO, e.g. "< 3,1 %". */
  limitText: string;
  pass: boolean;
  appliesTo: RuleScope;
  /** Informative rules (Q1) never affect the overall result. */
  informative: boolean;
  /** Set for per-cycle and per-point rules. */
  cycleIndex?: number;
  /** Set for per-point rules. */
  pointOrder?: number;
}
