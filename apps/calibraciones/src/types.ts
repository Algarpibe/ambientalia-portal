/**
 * Mirror of the Calibraciones API shapes (apps/hub-api/src/calibraciones/types.ts,
 * repo.ts and service.ts). If they change there, change them here.
 *
 * Why a mirror and not an import: hub-api's types.ts declares a class with
 * parameter properties (CalError), which the portal's `erasableSyntaxOnly`
 * type-check gate rejects as soon as the file enters the program. The pure
 * engine types, on the other hand, are imported from the engine itself.
 */

import type {
  Application,
  EngineConfig,
  EquipmentType,
  EvaluationResult,
  InternalFactors,
  Issue,
  Level,
  Limits,
  OverallResult,
  Route,
  VerificationInput,
  VerificationStatus,
} from './engine';

export type CalRole = 'TECNICO' | 'DIRECTOR_TECNICO' | 'LECTOR';

export type CalAction =
  | 'read'
  | 'equipment.write'
  | 'equipment.level'
  | 'verification.write'
  | 'verification.calculate'
  | 'verification.newVersion'
  | 'verification.approve'
  | 'limits.write'
  | 'config.write'
  | 'level4.override';

export interface Me {
  userId: string;
  email: string;
  role: CalRole;
  permissions: CalAction[];
  canManageRoles: boolean;
}

export type StoredVerificationKind = 'VERIFICATION_3_CYCLES' | 'REVERIFICATION_1_CYCLE' | 'CROSS_CHECK';

export interface EquipmentInput {
  brand: string;
  model: string;
  serial: string;
  internalCode: string;
  type: EquipmentType;
  hasPhotometer: boolean;
  application: Application;
  currentLevel: Level | null;
  notes: string | null;
  certificateNumber: string | null;
  certificateValidUntil: string | null;
  certificateMaxPpb: number | null;
  certificateRoute: Route | null;
  active: boolean;
}

export interface Equipment extends EquipmentInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export type ValidityBucket = 'EXPIRED' | 'DUE_TODAY' | 'DUE_15' | 'DUE_30' | 'OK' | 'NO_VALIDITY';

export interface ValidityStatus {
  dueDate: string | null;
  daysLeft: number | null;
  bucket: ValidityBucket;
}

export interface EquipmentWithValidity extends Equipment {
  validity: ValidityStatus;
}

export interface PointDraft {
  order: number;
  setpointPpb: number | null;
  xPpb: number;
  yPpb: number;
  cellTempXC?: number | null;
  cellTempYC?: number | null;
  cellPressXTorr?: number | null;
  cellPressYTorr?: number | null;
  readingsCount?: number | null;
  timestampStable?: string | null;
}

export interface CycleDraft {
  index: number;
  points: PointDraft[];
}

export interface Photometry {
  lossFraction?: number;
  linearityErrorPercent?: number;
}

export interface VerificationDraftInput {
  kind: StoredVerificationKind;
  verificationDate: string;
  location: string | null;
  referenceEquipmentId: string;
  candidateEquipmentId: string;
  referenceVerificationId: string | null;
  referenceRoute: Route | null;
  candidateRoute: Route | null;
  traceabilityOption: 1 | 2;
  internalFactorsBefore: InternalFactors | null;
  internalFactorsAfter: InternalFactors | null;
  referenceInternalFactors: InternalFactors | null;
  labTempStartC: number | null;
  labTempEndC: number | null;
  labRhPct: number | null;
  baroPressureTorr: number | null;
  totalFlowSlpm: number | null;
  calibrationScalePpb: number | null;
  acceptanceChecklist: Record<string, unknown> | null;
  photometry: Photometry | null;
  directorOverrideLevel4: boolean;
  cycles: CycleDraft[];
}

export interface Point extends PointDraft {
  xStdPpb: number | null;
  diffValue: number | null;
  diffType: 'PERCENT' | 'ABS_PPB' | null;
  pass: boolean | null;
}

export interface Cycle {
  index: number;
  slope: number | null;
  intercept: number | null;
  r2: number | null;
  pass: boolean | null;
  regressionError: string | null;
  points: Point[];
}

export interface Verification extends Omit<VerificationDraftInput, 'cycles'> {
  id: string;
  status: VerificationStatus;
  technicianId: string;
  technicianEmail: string;
  approvedById: string | null;
  approvedByEmail: string | null;
  candidateLastVerificationId: string | null;
  meanSlope: number | null;
  meanIntercept: number | null;
  sdSlope: number | null;
  sdIntercept: number | null;
  maxVerifiedPointPpb: number | null;
  overallResult: OverallResult | null;
  failReasons: string[];
  candidateLevel: number | null;
  validUntil: string | null;
  reverificationDue: string | null;
  engineVersion: string | null;
  limitsVersion: string | null;
  limitsSnapshot: Limits | null;
  configSnapshot: EngineConfig | null;
  engineInput: VerificationInput | null;
  evaluation: EvaluationResult | null;
  traceabilityWarnings: Issue[];
  version: number;
  supersedesId: string | null;
  changeReason: string | null;
  rejectionReason: string | null;
  calculatedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationDetail extends Verification {
  cycles: Cycle[];
}

export interface VerificationListItem extends Verification {
  referenceInternalCode: string;
  candidateInternalCode: string;
}

export interface TreeNode {
  equipmentId: string;
  internalCode: string;
  brand: string;
  model: string;
  currentLevel: number | null;
  application: string;
  verificationId: string | null;
  /** Negative for ancestors (−1 = direct reference), positive for descendants. */
  depth: number;
}

export interface EquipmentDetail {
  equipment: Equipment;
  validity: ValidityStatus;
  currentVerification: Verification | null;
  ancestors: TreeNode[];
  descendants: TreeNode[];
  history: Verification[];
}

export interface ExpirationItem extends ValidityStatus {
  equipmentId: string;
  internalCode: string;
  brand: string;
  model: string;
  currentLevel: number | null;
  application: Application;
  verificationId: string | null;
  validUntil: string | null;
  reverificationDue: string | null;
}

export interface DownstreamImpact {
  equipmentId: string;
  internalCode: string;
  since: string | null;
  items: {
    verificationId: string;
    candidateEquipmentId: string;
    candidateInternalCode: string;
    verificationDate: string;
    status: VerificationStatus;
    overallResult: OverallResult | null;
    validUntil: string | null;
  }[];
}

export interface LimitSet {
  id: number;
  version: string;
  limits: Limits;
  active: boolean;
  createdByEmail: string;
  reason: string;
  createdAt: string;
}

export interface LimitsResponse {
  active: LimitSet;
  history: LimitSet[];
}

export interface RoleUser {
  userId: string;
  fullName: string;
  email: string;
  status: string;
  role: CalRole;
}

export interface ReproducibilityReport {
  identical: boolean;
  differences: string[];
  verificationId: string;
  storedEngineVersion: string | null;
  currentEngineVersion: string;
  limitsVersion: string | null;
  storedOverallResult: string | null;
  recomputedOverallResult: string;
}

/** 422 `traceability_blocked` detail. */
export interface TraceabilityBlockedDetail {
  issues: Issue[];
  warnings: Issue[];
}
