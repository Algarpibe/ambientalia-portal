/**
 * Domain types and input parsing of the Calibraciones API.
 * Parsing is strict and happens before any database access: every function
 * here throws a 400 CalError with a Spanish (es-CO) message and the offending
 * field, never a raw database error.
 */

import {
  DEFAULT_CONFIG,
  DEFAULT_LIMITS,
  type Application,
  type EngineConfig,
  type EquipmentType,
  type EvaluationResult,
  type InternalFactors,
  type Issue,
  type Level,
  type Limits,
  type OverallResult,
  type Route,
  type VerificationInput,
  type VerificationStatus,
} from './o3-engine/index.js';
import type { CalRole } from './roles.js';

export type { CalRole } from './roles.js';

// ── Errors ─────────────────────────────────────────────────────────────────

/** A caller error: travels to HTTP as-is (status, code, Spanish message, field, detail). */
export class CalError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly messageEs: string,
    public readonly field?: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'CalError';
  }
}

const invalid = (field: string, messageEs: string): CalError => new CalError('invalid_input', 400, messageEs, field);

// ── Enumerations ───────────────────────────────────────────────────────────

export const EQUIPMENT_TYPES: readonly EquipmentType[] = ['SRP', 'PHOTOMETRIC_CALIBRATOR', 'GENERATOR_ONLY', 'ANALYZER'];
export const APPLICATIONS: readonly Application[] = ['BENCH', 'FIELD'];
export const ROUTES: readonly Route[] = ['SAMPLE_IN', 'INTERNAL', 'OTHER'];
/** CROSS_CHECK is storable but the engine cannot evaluate it yet (calculate → 422). */
export type StoredVerificationKind = 'VERIFICATION_3_CYCLES' | 'REVERIFICATION_1_CYCLE' | 'CROSS_CHECK';
export const VERIFICATION_KINDS: readonly StoredVerificationKind[] = ['VERIFICATION_3_CYCLES', 'REVERIFICATION_1_CYCLE', 'CROSS_CHECK'];

// ── Actor ──────────────────────────────────────────────────────────────────

export interface Actor {
  userId: string;
  email: string;
  role: CalRole;
  /** Portal admin: manages roles only; it does NOT imply DIRECTOR_TECNICO. */
  isPortalAdmin: boolean;
}

// ── Equipment ──────────────────────────────────────────────────────────────

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
  /** Level 1 (SRP) external certificate: it replaces an in-app verification. */
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

// ── Verification drafts ────────────────────────────────────────────────────

export interface PointDraft {
  order: number;
  /** Nominal setpoint; 0 identifies the zero point (DECISIONS D-014). */
  setpointPpb: number | null;
  /** Reference (x) reading as indicated by the instrument, ppb. */
  xPpb: number;
  /** Candidate (y) reading, ppb. */
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
  /** Explicit reference verification; null → the reference's current one is resolved at calculate. */
  referenceVerificationId: string | null;
  referenceRoute: Route | null;
  candidateRoute: Route | null;
  traceabilityOption: 1 | 2;
  internalFactorsBefore: InternalFactors | null;
  internalFactorsAfter: InternalFactors | null;
  /** Reference internal factors observed on the test date (§7.3 check). */
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

// ── Stored verification ────────────────────────────────────────────────────

export interface Point extends Required<Omit<PointDraft, 'setpointPpb'>> {
  setpointPpb: number | null;
  /** x in standard units used in the calculation (after Eq. 10 when applied). */
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

export interface AuditEntry {
  /** BIGSERIAL, sent as text (int8 does not fit a JS number safely). */
  id: string;
  actorId: string | null;
  actorEmail: string;
  entity: string;
  entityId: string;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  at: string;
}

// ── Primitive parsers ──────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = ISO_DATE_RE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function parseUuid(v: unknown, field: string): string {
  if (!isUuid(v)) throw invalid(field, `El identificador «${field}» no es válido.`);
  return v.toLowerCase();
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requiredText(o: Record<string, unknown>, field: string, max = 120): string {
  const v = o[field];
  if (typeof v !== 'string' || v.trim() === '') throw invalid(field, `El campo «${field}» es obligatorio.`);
  if (v.trim().length > max) throw invalid(field, `El campo «${field}» supera ${max} caracteres.`);
  return v.trim();
}

function optionalText(o: Record<string, unknown>, field: string, max = 2000): string | null {
  const v = o[field];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw invalid(field, `El campo «${field}» debe ser texto.`);
  if (v.length > max) throw invalid(field, `El campo «${field}» supera ${max} caracteres.`);
  return v.trim() === '' ? null : v.trim();
}

function optionalNumber(o: Record<string, unknown>, field: string): number | null {
  const v = o[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalid(field, `El campo «${field}» debe ser un número.`);
  return v;
}

function requiredNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalid(field, `El campo «${field}» debe ser un número.`);
  return v;
}

function optionalDate(o: Record<string, unknown>, field: string): string | null {
  const v = o[field];
  if (v === undefined || v === null || v === '') return null;
  if (!isIsoDate(v)) throw invalid(field, `La fecha «${field}» no es válida (AAAA-MM-DD).`);
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw invalid(field, `El valor de «${field}» no es válido. Opciones: ${allowed.join(', ')}.`);
  }
  return v as T;
}

function optionalOneOf<T extends string>(o: Record<string, unknown>, field: string, allowed: readonly T[]): T | null {
  const v = o[field];
  if (v === undefined || v === null) return null;
  return oneOf(v, allowed, field);
}

function optionalBoolean(o: Record<string, unknown>, field: string, dflt: boolean): boolean {
  const v = o[field];
  if (v === undefined || v === null) return dflt;
  if (typeof v !== 'boolean') throw invalid(field, `El campo «${field}» debe ser verdadero o falso.`);
  return v;
}

function optionalFactors(o: Record<string, unknown>, field: string): InternalFactors | null {
  const v = o[field];
  if (v === undefined || v === null) return null;
  if (!isObject(v) || Object.keys(v).length > 20 || !Object.values(v).every((x) => typeof x === 'number' && Number.isFinite(x))) {
    throw invalid(field, `Los factores internos «${field}» deben ser pares nombre → número (p. ej. span, zero).`);
  }
  return v as InternalFactors;
}

// ── Equipment ──────────────────────────────────────────────────────────────

export function parseEquipmentInput(body: unknown): EquipmentInput {
  if (!isObject(body)) throw invalid('body', 'El cuerpo de la petición no es válido.');
  // Fields are validated in form order so the reported field is the first one wrong.
  const brand = requiredText(body, 'brand');
  const model = requiredText(body, 'model');
  const serial = requiredText(body, 'serial');
  const internalCode = requiredText(body, 'internalCode', 60);
  const type = oneOf(body.type, EQUIPMENT_TYPES, 'type');
  const hasPhotometer = body.hasPhotometer;
  if (typeof hasPhotometer !== 'boolean') throw invalid('hasPhotometer', 'Indique si el equipo tiene fotómetro.');
  const level = body.currentLevel;
  if (level !== undefined && level !== null && !(level === 1 || level === 2 || level === 3 || level === 4)) {
    throw invalid('currentLevel', 'El nivel debe ser 1, 2, 3 o 4.');
  }
  return {
    brand,
    model,
    serial,
    internalCode,
    type,
    hasPhotometer,
    application: oneOf(body.application, APPLICATIONS, 'application'),
    currentLevel: (level ?? null) as Level | null,
    notes: optionalText(body, 'notes'),
    certificateNumber: optionalText(body, 'certificateNumber', 120),
    certificateValidUntil: optionalDate(body, 'certificateValidUntil'),
    certificateMaxPpb: optionalNumber(body, 'certificateMaxPpb'),
    certificateRoute: optionalOneOf(body, 'certificateRoute', ROUTES),
    active: optionalBoolean(body, 'active', true),
  };
}

// ── Verification drafts ────────────────────────────────────────────────────

const MAX_POINTS_PER_CYCLE = 50;
const MAX_CYCLES = 3;

function parsePoint(v: unknown, where: string): PointDraft {
  if (!isObject(v)) throw invalid('cycles', `${where}: el punto no es válido.`);
  const order = v.order;
  if (typeof order !== 'number' || !Number.isInteger(order) || order < 1) {
    throw invalid('cycles', `${where}: el orden del punto debe ser un entero ≥ 1.`);
  }
  const at = `${where}, punto ${order}`;
  const num = (field: string) => {
    try {
      return optionalNumber(v, field);
    } catch {
      throw invalid('cycles', `${at}: «${field}» debe ser un número.`);
    }
  };
  let x: number;
  let y: number;
  try {
    x = requiredNumber(v.xPpb, 'xPpb');
    y = requiredNumber(v.yPpb, 'yPpb');
  } catch {
    throw invalid('cycles', `${at}: las lecturas x e y son obligatorias y numéricas.`);
  }
  const readingsCount = num('readingsCount');
  if (readingsCount !== null && (!Number.isInteger(readingsCount) || readingsCount < 0)) {
    throw invalid('cycles', `${at}: el número de lecturas debe ser un entero ≥ 0.`);
  }
  const ts = v.timestampStable;
  if (ts !== undefined && ts !== null && (typeof ts !== 'string' || Number.isNaN(Date.parse(ts)))) {
    throw invalid('cycles', `${at}: la marca de tiempo de estabilidad no es válida.`);
  }
  return {
    order,
    setpointPpb: num('setpointPpb'),
    xPpb: x,
    yPpb: y,
    cellTempXC: num('cellTempXC'),
    cellTempYC: num('cellTempYC'),
    cellPressXTorr: num('cellPressXTorr'),
    cellPressYTorr: num('cellPressYTorr'),
    readingsCount,
    timestampStable: (ts as string | null | undefined) ?? null,
  };
}

function parseCycles(v: unknown): CycleDraft[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_CYCLES) throw invalid('cycles', `Se admiten como máximo ${MAX_CYCLES} ciclos.`);
  const seen = new Set<number>();
  return v.map((c) => {
    if (!isObject(c)) throw invalid('cycles', 'El ciclo no es válido.');
    const index = c.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1 || index > MAX_CYCLES) {
      throw invalid('cycles', `El índice del ciclo debe ser un entero entre 1 y ${MAX_CYCLES}.`);
    }
    if (seen.has(index)) throw invalid('cycles', `El ciclo ${index} está repetido.`);
    seen.add(index);
    if (!Array.isArray(c.points) || c.points.length > MAX_POINTS_PER_CYCLE) {
      throw invalid('cycles', `Ciclo ${index}: se admiten como máximo ${MAX_POINTS_PER_CYCLE} puntos.`);
    }
    const points = c.points.map((p) => parsePoint(p, `Ciclo ${index}`));
    const orders = new Set(points.map((p) => p.order));
    if (orders.size !== points.length) throw invalid('cycles', `Ciclo ${index}: hay puntos con el mismo orden.`);
    return { index, points };
  });
}

function parsePhotometry(v: unknown): Photometry | null {
  if (v === undefined || v === null) return null;
  if (!isObject(v)) throw invalid('photometry', 'Los datos de fotometría no son válidos.');
  const out: Photometry = {};
  const loss = optionalNumber(v, 'lossFraction');
  const lin = optionalNumber(v, 'linearityErrorPercent');
  if (loss !== null) {
    if (loss < 0 || loss > 1) throw invalid('photometry', 'La fracción de pérdida de O₃ debe estar entre 0 y 1.');
    out.lossFraction = loss;
  }
  if (lin !== null) out.linearityErrorPercent = lin;
  return out;
}

export function parseVerificationDraft(body: unknown): VerificationDraftInput {
  if (!isObject(body)) throw invalid('body', 'El cuerpo de la petición no es válido.');
  const kind = oneOf(body.kind, VERIFICATION_KINDS, 'kind');
  if (!isIsoDate(body.verificationDate)) throw invalid('verificationDate', 'La fecha de la verificación no es válida (AAAA-MM-DD).');
  const referenceEquipmentId = parseUuid(body.referenceEquipmentId, 'referenceEquipmentId');
  const candidateEquipmentId = parseUuid(body.candidateEquipmentId, 'candidateEquipmentId');
  if (referenceEquipmentId === candidateEquipmentId) {
    throw invalid('candidateEquipmentId', 'El patrón y el candidato deben ser equipos distintos.');
  }
  const refVer = body.referenceVerificationId;
  const option = body.traceabilityOption ?? 1;
  if (option !== 1 && option !== 2) throw invalid('traceabilityOption', 'La opción de trazabilidad debe ser 1 (ajuste de factores) o 2 (Ecuación 10).');
  const checklist = body.acceptanceChecklist;
  if (checklist !== undefined && checklist !== null && !isObject(checklist)) {
    throw invalid('acceptanceChecklist', 'La lista de pruebas de aceptación no es válida.');
  }
  return {
    kind,
    verificationDate: body.verificationDate,
    location: optionalText(body, 'location', 200),
    referenceEquipmentId,
    candidateEquipmentId,
    referenceVerificationId: refVer === undefined || refVer === null ? null : parseUuid(refVer, 'referenceVerificationId'),
    referenceRoute: optionalOneOf(body, 'referenceRoute', ROUTES),
    candidateRoute: optionalOneOf(body, 'candidateRoute', ROUTES),
    traceabilityOption: option,
    internalFactorsBefore: optionalFactors(body, 'internalFactorsBefore'),
    internalFactorsAfter: optionalFactors(body, 'internalFactorsAfter'),
    referenceInternalFactors: optionalFactors(body, 'referenceInternalFactors'),
    labTempStartC: optionalNumber(body, 'labTempStartC'),
    labTempEndC: optionalNumber(body, 'labTempEndC'),
    labRhPct: optionalNumber(body, 'labRhPct'),
    baroPressureTorr: optionalNumber(body, 'baroPressureTorr'),
    totalFlowSlpm: optionalNumber(body, 'totalFlowSlpm'),
    calibrationScalePpb: optionalNumber(body, 'calibrationScalePpb'),
    acceptanceChecklist: (checklist ?? null) as Record<string, unknown> | null,
    photometry: parsePhotometry(body.photometry),
    directorOverrideLevel4: optionalBoolean(body, 'directorOverrideLevel4', false),
    cycles: parseCycles(body.cycles),
  };
}

export function parseReason(v: unknown, field = 'reason'): string {
  if (typeof v !== 'string' || v.trim() === '') throw invalid(field, 'Debe indicar el motivo.');
  if (v.length > 2000) throw invalid(field, 'El motivo supera 2000 caracteres.');
  return v.trim();
}

// ── Limits and config ──────────────────────────────────────────────────────

/** Same keys and value types as the template, recursively; no extra keys. */
function sameShape(value: unknown, template: unknown): boolean {
  if (isObject(template)) {
    if (!isObject(value)) return false;
    const tk = Object.keys(template).sort();
    const vk = Object.keys(value).sort();
    return tk.length === vk.length && tk.every((k, i) => k === vk[i] && sameShape(value[k], template[k]));
  }
  if (typeof template === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === typeof template;
}

export interface LimitsInput {
  version: string;
  limits: Limits;
  reason: string;
}

export function parseLimitsInput(body: unknown): LimitsInput {
  if (!isObject(body)) throw invalid('body', 'El cuerpo de la petición no es válido.');
  const version = requiredText(body, 'version', 40);
  if (!sameShape(body.limits, DEFAULT_LIMITS)) {
    throw invalid('limits', 'La tabla de límites no tiene la estructura esperada (mismas reglas y campos que la tabla por defecto).');
  }
  const limits = body.limits as unknown as Limits;
  if (limits.version !== version) throw invalid('version', 'La versión de la tabla debe coincidir con «limits.version».');
  const reason = parseReason(body.reason);
  return { version, limits, reason };
}

export interface ConfigInput {
  config: EngineConfig;
  reason: string;
}

export function parseConfig(body: unknown): ConfigInput {
  if (!isObject(body)) throw invalid('body', 'El cuerpo de la petición no es válido.');
  const c = body.config;
  if (!sameShape(c, DEFAULT_CONFIG)) throw invalid('config', 'La configuración no tiene la estructura esperada.');
  const config = c as unknown as EngineConfig;
  if (config.absDiffThresholdPpb < 0) throw invalid('config', 'El umbral de AbsDiff no puede ser negativo.');
  if (!Object.values(config.validityDays).every((d) => Number.isInteger(d) && d > 0)) {
    throw invalid('config', 'Los días de vigencia deben ser enteros positivos.');
  }
  return { config, reason: parseReason(body.reason) };
}
