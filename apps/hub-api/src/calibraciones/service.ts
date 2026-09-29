/**
 * Business logic of the Calibraciones app (O3 transfer standards).
 *
 * The server is authoritative: every calculation is re-run here with the pure
 * o3-engine, against the reference and limits stored in the database, and the
 * exact inputs, limits, config and output are stored with the record so it can
 * be recomputed identically later (ISO/IEC 17025 reproducibility).
 *
 * Every mutation writes portal.cal_audit_log in the SAME transaction.
 * Permission checks and input parsing happen before any query.
 */

import { isDeepStrictEqual } from 'node:util';
import type { Pool } from '@algarpibe/zoho-sync';
import {
  computeValidUntil,
  DEFAULT_CONFIG,
  ENGINE_VERSION,
  evaluateVerification,
  validateTraceability,
  type EngineConfig,
  type EquipmentInfo,
  type EvaluationResult,
  type InternalFactors,
  type Issue,
  type Level,
  type ReferenceVerificationInfo,
  type Route,
  type VerificationInput,
  type VerificationKind,
} from './o3-engine/index.js';
import * as repo from './repo.js';
import { assertCan, CAL_ROLES, resolveRole, type CalRole } from './roles.js';
import {
  CalError,
  parseConfig,
  parseEquipmentInput,
  parseLimitsInput,
  parseReason,
  parseUuid,
  parseVerificationDraft,
  type Actor,
  type AuditEntry,
  type Cycle,
  type CycleDraft,
  type Equipment,
  type Photometry,
  type Verification,
  type VerificationDetail,
  type VerificationDraftInput,
} from './types.js';

// ── Pure helpers ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const isoToUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export type ValidityBucket = 'EXPIRED' | 'DUE_TODAY' | 'DUE_15' | 'DUE_30' | 'OK' | 'NO_VALIDITY';

export interface ValidityStatus {
  dueDate: string | null;
  daysLeft: number | null;
  bucket: ValidityBucket;
}

/**
 * §7.9 expiration board: the due date is the earliest of the validity and the
 * extra reverification date; alerts at 30, 15 and 0 days, then EXPIRED.
 */
export function validityStatus(validUntil: string | null, reverificationDue: string | null, today: string): ValidityStatus {
  const dates = [validUntil, reverificationDue].filter((d): d is string => !!d).sort();
  if (dates.length === 0) return { dueDate: null, daysLeft: null, bucket: 'NO_VALIDITY' };
  const dueDate = dates[0];
  const daysLeft = Math.round((isoToUtc(dueDate) - isoToUtc(today)) / DAY_MS);
  const bucket: ValidityBucket =
    daysLeft < 0 ? 'EXPIRED' : daysLeft === 0 ? 'DUE_TODAY' : daysLeft <= 15 ? 'DUE_15' : daysLeft <= 30 ? 'DUE_30' : 'OK';
  return { dueDate, daysLeft, bucket };
}

export interface EngineContext {
  referenceVerification?: { traceabilityOption: 1 | 2; meanSlope: number; meanIntercept: number };
  lastVerification?: { meanSlope: number; meanIntercept: number; internalFactors?: InternalFactors };
}

/** Stored draft → engine input. Only reverifications get the last verification (R1, R2, R5). */
export function buildEngineInput(
  v: { kind: VerificationKind; cycles: CycleDraft[]; internalFactorsBefore: InternalFactors | null; photometry: Photometry | null },
  ctx: EngineContext,
): VerificationInput {
  return {
    kind: v.kind,
    cycles: v.cycles.map((c) => ({
      index: c.index,
      points: c.points.map((p) => ({
        order: p.order,
        ...(p.setpointPpb !== null && p.setpointPpb !== undefined ? { setpointPpb: p.setpointPpb } : {}),
        xPpb: p.xPpb,
        yPpb: p.yPpb,
      })),
    })),
    ...(ctx.referenceVerification ? { referenceVerification: ctx.referenceVerification } : {}),
    ...(v.kind === 'REVERIFICATION_1_CYCLE' && ctx.lastVerification ? { lastVerification: ctx.lastVerification } : {}),
    ...(v.internalFactorsBefore ? { internalFactors: v.internalFactorsBefore } : {}),
    ...(v.photometry ? { photometry: v.photometry } : {}),
  };
}

/**
 * Level 1 (SRP): its external certificate plays the role of the reference
 * verification. Without a certificate date and range there is none.
 */
export function referenceInfoFromCertificate(
  eq: Pick<Equipment, 'certificateValidUntil' | 'certificateMaxPpb' | 'certificateRoute'>,
  testRoute: Route | null,
): ReferenceVerificationInfo | undefined {
  if (!eq.certificateValidUntil || eq.certificateMaxPpb === null) return undefined;
  return {
    status: 'APPROVED',
    validUntil: eq.certificateValidUntil,
    internalFactors: {},
    route: eq.certificateRoute ?? testRoute ?? 'SAMPLE_IN',
    maxVerifiedPointPpb: eq.certificateMaxPpb,
  };
}

/** A reference's own verification → the facts the §7 checks need. */
export function referenceInfoFromVerification(v: Verification): ReferenceVerificationInfo {
  return {
    status: v.status,
    // A record without validity (not approved / not conforming) is blocked by
    // its status or by the NOT_CONFORME check; the test date keeps the engine
    // from reporting a misleading expiry date on top.
    validUntil: v.validUntil ?? v.verificationDate,
    internalFactors: v.internalFactorsAfter ?? v.internalFactorsBefore ?? {},
    route: v.candidateRoute ?? 'SAMPLE_IN',
    maxVerifiedPointPpb: v.maxVerifiedPointPpb ?? 0,
  };
}

export interface ReproducibilityDiff {
  identical: boolean;
  differences: string[];
}

const MAX_DIFFS = 50;

/**
 * Deep comparison after a JSON round trip (the storage format): key order is
 * irrelevant and NaN/undefined compare as JSON does. Reports difference paths.
 */
export function compareReproducibility(stored: unknown, recomputed: unknown): ReproducibilityDiff {
  const a = JSON.parse(JSON.stringify(stored ?? null));
  const b = JSON.parse(JSON.stringify(recomputed ?? null));
  const differences: string[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    if (differences.length >= MAX_DIFFS) return;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) differences.push(`${path}.length`);
      for (let i = 0; i < Math.min(x.length, y.length); i++) walk(x[i], y[i], `${path}[${i}]`);
      return;
    }
    if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of [...keys].sort()) {
        walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
      }
      return;
    }
    if (!isDeepStrictEqual(x, y)) differences.push(path || '(root)');
  };
  walk(a, b, '');
  return { identical: differences.length === 0, differences };
}

// ── Internal helpers ───────────────────────────────────────────────────────

const LOCKED = new Set(['APPROVED', 'REJECTED']);

const notFound = (what: string) => new CalError('not_found', 404, `${what} no existe.`);

const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === '23505';

function assertEditable(v: Verification): void {
  if (LOCKED.has(v.status)) {
    throw new CalError(
      'verification_locked',
      409,
      v.status === 'APPROVED'
        ? 'La verificación está aprobada y bloqueada: cualquier cambio exige una nueva versión con su motivo.'
        : 'La verificación fue rechazada y no admite cambios.',
    );
  }
}

const toEquipmentInfo = (e: Equipment): EquipmentInfo => ({
  id: e.id,
  type: e.type,
  hasPhotometer: e.hasPhotometer,
  application: e.application,
  currentLevel: e.currentLevel,
});

const cyclesToDrafts = (cycles: Cycle[]): CycleDraft[] =>
  cycles.map((c) => ({
    index: c.index,
    points: c.points.map((p) => ({
      order: p.order,
      setpointPpb: p.setpointPpb,
      xPpb: p.xPpb,
      yPpb: p.yPpb,
      cellTempXC: p.cellTempXC,
      cellTempYC: p.cellTempYC,
      cellPressXTorr: p.cellPressXTorr,
      cellPressYTorr: p.cellPressYTorr,
      readingsCount: p.readingsCount,
      timestampStable: p.timestampStable,
    })),
  }));

/** Audit view of a verification: the record without the large snapshot blobs. */
function auditView(v: Verification, cycles?: Cycle[]): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { limitsSnapshot, configSnapshot, engineInput, evaluation, ...rest } = v;
  return cycles ? { ...rest, cycles } : rest;
}

function draftHeader(v: VerificationDraftInput | Verification): Omit<VerificationDraftInput, 'cycles'> {
  return {
    kind: v.kind,
    verificationDate: v.verificationDate,
    location: v.location,
    referenceEquipmentId: v.referenceEquipmentId,
    candidateEquipmentId: v.candidateEquipmentId,
    referenceVerificationId: v.referenceVerificationId,
    referenceRoute: v.referenceRoute,
    candidateRoute: v.candidateRoute,
    traceabilityOption: v.traceabilityOption,
    internalFactorsBefore: v.internalFactorsBefore,
    internalFactorsAfter: v.internalFactorsAfter,
    referenceInternalFactors: v.referenceInternalFactors,
    labTempStartC: v.labTempStartC,
    labTempEndC: v.labTempEndC,
    labRhPct: v.labRhPct,
    baroPressureTorr: v.baroPressureTorr,
    totalFlowSlpm: v.totalFlowSlpm,
    calibrationScalePpb: v.calibrationScalePpb,
    acceptanceChecklist: v.acceptanceChecklist,
    photometry: v.photometry,
    directorOverrideLevel4: v.directorOverrideLevel4,
  };
}

async function detail(db: repo.Db, id: string): Promise<VerificationDetail> {
  const v = await repo.getVerification(db, id);
  if (!v) throw notFound('La verificación');
  return { ...v, cycles: await repo.getCycles(db, id) };
}

async function assertEquipmentExists(db: repo.Db, ids: { id: string; field: string }[]): Promise<void> {
  for (const { id, field } of ids) {
    if (!(await repo.getEquipment(db, id))) {
      throw new CalError('equipment_not_found', 404, 'El equipo indicado no existe.', field);
    }
  }
}

// ── Limits and config ──────────────────────────────────────────────────────

export async function getLimits(db: repo.Db): Promise<repo.LimitSet> {
  const set = await repo.activeLimitSet(db);
  // The migration always seeds an active set; its absence is a server fault,
  // never something to paper over with in-code defaults.
  if (!set) throw new Error('calibraciones: no active limit set');
  return set;
}

export const listLimitSets = (db: repo.Db) => repo.listLimitSets(db);

/** Stored config; a missing key falls back to the engine default for that key. */
export async function getConfig(db: repo.Db): Promise<EngineConfig> {
  const rows = await repo.getConfigRows(db);
  return {
    absDiffThresholdPpb: (rows.absDiffThresholdPpb as number | undefined) ?? DEFAULT_CONFIG.absDiffThresholdPpb,
    includeZeroInRegression: (rows.includeZeroInRegression as boolean | undefined) ?? DEFAULT_CONFIG.includeZeroInRegression,
    validityDays: { ...DEFAULT_CONFIG.validityDays, ...((rows.validityDays as object | undefined) ?? {}) },
  };
}

export async function putLimits(db: Pool, actor: Actor, body: unknown): Promise<repo.LimitSet> {
  assertCan(actor.role, 'limits.write');
  const input = parseLimitsInput(body);
  try {
    return await repo.withTransaction(db, async (tx) => {
      if (await repo.limitSetExists(tx, input.version)) {
        throw new CalError('limits_version_exists', 409, `Ya existe una tabla de límites con la versión ${input.version}.`, 'version');
      }
      const old = await repo.activeLimitSet(tx);
      const created = await repo.insertActiveLimitSet(tx, input.version, input.limits, actor, input.reason);
      await repo.insertAudit(tx, {
        actor,
        entity: 'limits',
        entityId: input.version,
        action: 'CREATE',
        oldValue: old ? { version: old.version, limits: old.limits } : null,
        newValue: { version: created.version, limits: created.limits },
        reason: input.reason,
      });
      return created;
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new CalError('limits_version_exists', 409, `Ya existe una tabla de límites con la versión ${input.version}.`, 'version');
    }
    throw e;
  }
}

export async function putConfig(db: Pool, actor: Actor, body: unknown): Promise<EngineConfig> {
  assertCan(actor.role, 'config.write');
  const input = parseConfig(body);
  return repo.withTransaction(db, async (tx) => {
    const old = await getConfig(tx);
    for (const [key, value] of Object.entries(input.config)) await repo.setConfigValue(tx, key, value, actor);
    await repo.insertAudit(tx, {
      actor,
      entity: 'config',
      entityId: 'engine',
      action: 'UPDATE',
      oldValue: old,
      newValue: input.config,
      reason: input.reason,
    });
    return input.config;
  });
}

// ── Roles ──────────────────────────────────────────────────────────────────

export async function roleOf(db: repo.Db, userId: string | null): Promise<CalRole> {
  if (!userId) return 'LECTOR';
  return resolveRole(await repo.getRole(db, userId));
}

function assertPortalAdmin(actor: Actor): void {
  if (!actor.isPortalAdmin) {
    throw new CalError('forbidden_admin', 403, 'Solo un administrador del portal puede gestionar los roles de Calibraciones.');
  }
}

export async function listRoles(db: repo.Db, actor: Actor, appId: string) {
  assertPortalAdmin(actor);
  const users = await repo.listRoleUsers(db, appId);
  return users.map((u) => ({ ...u, role: resolveRole(u.role) }));
}

export async function setRole(db: Pool, actor: Actor, userId: string, role: unknown): Promise<{ userId: string; role: CalRole }> {
  assertPortalAdmin(actor);
  const id = parseUuid(userId, 'userId');
  if (typeof role !== 'string' || !(CAL_ROLES as readonly string[]).includes(role)) {
    throw new CalError('invalid_input', 400, `El rol no es válido. Opciones: ${CAL_ROLES.join(', ')}.`, 'role');
  }
  return repo.withTransaction(db, async (tx) => {
    if (!(await repo.userExists(tx, id))) throw notFound('El usuario');
    const old = await repo.getRole(tx, id);
    await repo.upsertRole(tx, id, role as CalRole, actor.email);
    await repo.insertAudit(tx, {
      actor,
      entity: 'role',
      entityId: id,
      action: 'SET_ROLE',
      oldValue: { role: old },
      newValue: { role },
    });
    return { userId: id, role: role as CalRole };
  });
}

// ── Audit ──────────────────────────────────────────────────────────────────

export async function auditLog(db: repo.Db, entity?: string, entityId?: string): Promise<AuditEntry[]> {
  return repo.listAudit(db, { entity, entityId });
}

// ── Equipment ──────────────────────────────────────────────────────────────

export async function createEquipment(db: Pool, actor: Actor, body: unknown): Promise<Equipment> {
  assertCan(actor.role, 'equipment.write');
  const input = parseEquipmentInput(body);
  if (input.currentLevel !== null) assertCan(actor.role, 'equipment.level');
  try {
    return await repo.withTransaction(db, async (tx) => {
      const e = await repo.insertEquipment(tx, input);
      await repo.insertAudit(tx, { actor, entity: 'equipment', entityId: e.id, action: 'CREATE', newValue: e });
      return e;
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new CalError('internal_code_taken', 409, `Ya existe un equipo con el código interno ${input.internalCode}.`, 'internalCode');
    }
    throw e;
  }
}

export async function updateEquipment(db: Pool, actor: Actor, id: string, body: unknown): Promise<Equipment> {
  assertCan(actor.role, 'equipment.write');
  const eqId = parseUuid(id, 'id');
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new CalError('invalid_input', 400, 'El cuerpo de la petición no es válido.', 'body');
  }
  try {
    return await repo.withTransaction(db, async (tx) => {
      const old = await repo.getEquipment(tx, eqId, true);
      if (!old) throw notFound('El equipo');
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, createdAt, updatedAt, ...current } = old;
      const input = parseEquipmentInput({ ...current, ...body });
      if (input.currentLevel !== old.currentLevel) assertCan(actor.role, 'equipment.level');
      const updated = await repo.updateEquipment(tx, eqId, input);
      await repo.insertAudit(tx, { actor, entity: 'equipment', entityId: eqId, action: 'UPDATE', oldValue: old, newValue: updated });
      return updated;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new CalError('internal_code_taken', 409, 'Ya existe un equipo con ese código interno.', 'internalCode');
    throw e;
  }
}

interface TreeNode {
  equipmentId: string;
  internalCode: string;
  brand: string;
  model: string;
  currentLevel: number | null;
  application: string;
  verificationId: string | null;
  depth: number;
}

function validityOf(e: Equipment, current: Verification | undefined, today: string): ValidityStatus {
  if (e.type === 'SRP') return validityStatus(e.certificateValidUntil, null, today);
  return validityStatus(current?.validUntil ?? null, current?.reverificationDue ?? null, today);
}

export async function listEquipment(db: repo.Db, today: string) {
  const [all, current] = await Promise.all([repo.listEquipment(db), repo.currentVerifications(db)]);
  const byCandidate = new Map(current.map((v) => [v.candidateEquipmentId, v]));
  return all.map((e) => ({ ...e, validity: validityOf(e, byCandidate.get(e.id), today) }));
}

/** Equipment + traceability tree (via current approved verifications), validity and history. */
export async function getEquipmentDetail(db: repo.Db, id: string, today: string) {
  const eqId = parseUuid(id, 'id');
  const equipment = await repo.getEquipment(db, eqId);
  if (!equipment) throw notFound('El equipo');
  const [all, current, history] = await Promise.all([
    repo.listEquipment(db),
    repo.currentVerifications(db),
    repo.historyOf(db, eqId),
  ]);
  const byId = new Map(all.map((e) => [e.id, e]));
  const byCandidate = new Map(current.map((v) => [v.candidateEquipmentId, v]));
  const node = (e: Equipment, depth: number): TreeNode => ({
    equipmentId: e.id,
    internalCode: e.internalCode,
    brand: e.brand,
    model: e.model,
    currentLevel: e.currentLevel,
    application: e.application,
    verificationId: byCandidate.get(e.id)?.id ?? null,
    depth,
  });

  // Ancestors: reference of my current verification, then its reference... up to the SRP.
  const ancestors: TreeNode[] = [];
  const seen = new Set([eqId]);
  let refId = byCandidate.get(eqId)?.referenceEquipmentId;
  while (refId && !seen.has(refId) && ancestors.length < 4) {
    seen.add(refId);
    const ref = byId.get(refId);
    if (!ref) break;
    ancestors.push(node(ref, -(ancestors.length + 1)));
    refId = byCandidate.get(refId)?.referenceEquipmentId;
  }

  // Descendants: equipment whose current verification used me as the reference.
  const descendants: TreeNode[] = [];
  const visited = new Set([eqId]);
  let frontier = [eqId];
  for (let depth = 1; depth <= 4 && frontier.length; depth++) {
    const next: string[] = [];
    for (const v of current) {
      if (frontier.includes(v.referenceEquipmentId) && !visited.has(v.candidateEquipmentId)) {
        const e = byId.get(v.candidateEquipmentId);
        if (!e) continue;
        visited.add(e.id);
        descendants.push(node(e, depth));
        next.push(e.id);
      }
    }
    frontier = next;
  }

  const currentVerification = byCandidate.get(eqId) ?? null;
  return {
    equipment,
    validity: validityOf(equipment, currentVerification ?? undefined, today),
    currentVerification,
    ancestors,
    descendants,
    history,
  };
}

// ── Verifications: drafts ──────────────────────────────────────────────────

export async function listVerifications(db: repo.Db, query: Record<string, unknown>) {
  const equipmentId = query.equipmentId ? parseUuid(query.equipmentId, 'equipmentId') : undefined;
  const status = typeof query.status === 'string' ? query.status : undefined;
  if (status && !['DRAFT', 'CALCULATED', 'APPROVED', 'REJECTED'].includes(status)) {
    throw new CalError('invalid_input', 400, 'El estado del filtro no es válido.', 'status');
  }
  return repo.listVerifications(db, { equipmentId, status });
}

export async function getVerification(db: repo.Db, id: string): Promise<VerificationDetail> {
  return detail(db, parseUuid(id, 'id'));
}

function assertOverrideAllowed(actor: Actor, input: VerificationDraftInput): void {
  if (input.directorOverrideLevel4) assertCan(actor.role, 'level4.override');
}

export async function createVerification(db: Pool, actor: Actor, body: unknown): Promise<VerificationDetail> {
  assertCan(actor.role, 'verification.write');
  const input = parseVerificationDraft(body);
  assertOverrideAllowed(actor, input);
  return repo.withTransaction(db, async (tx) => {
    await assertEquipmentExists(tx, [
      { id: input.referenceEquipmentId, field: 'referenceEquipmentId' },
      { id: input.candidateEquipmentId, field: 'candidateEquipmentId' },
    ]);
    const id = await repo.insertVerification(tx, draftHeader(input), actor);
    await repo.replaceCycles(tx, id, input.cycles);
    await repo.insertAudit(tx, { actor, entity: 'verification', entityId: id, action: 'CREATE', newValue: input });
    return detail(tx, id);
  });
}

/** Rewrites header + cycles + points of a DRAFT/CALCULATED record; results are cleared (back to DRAFT). */
export async function updateVerification(db: Pool, actor: Actor, id: string, body: unknown): Promise<VerificationDetail> {
  assertCan(actor.role, 'verification.write');
  const vId = parseUuid(id, 'id');
  const input = parseVerificationDraft(body);
  assertOverrideAllowed(actor, input);
  return repo.withTransaction(db, async (tx) => {
    const old = await repo.getVerification(tx, vId, true);
    if (!old) throw notFound('La verificación');
    assertEditable(old);
    await assertEquipmentExists(tx, [
      { id: input.referenceEquipmentId, field: 'referenceEquipmentId' },
      { id: input.candidateEquipmentId, field: 'candidateEquipmentId' },
    ]);
    const oldCycles = await repo.getCycles(tx, vId);
    await repo.updateVerificationHeader(tx, vId, draftHeader(input));
    await repo.replaceCycles(tx, vId, input.cycles);
    await repo.insertAudit(tx, {
      actor,
      entity: 'verification',
      entityId: vId,
      action: 'UPDATE',
      oldValue: auditView(old, oldCycles),
      newValue: input,
    });
    return detail(tx, vId);
  });
}

export async function deleteVerification(db: Pool, actor: Actor, id: string): Promise<void> {
  assertCan(actor.role, 'verification.write');
  const vId = parseUuid(id, 'id');
  await repo.withTransaction(db, async (tx) => {
    const old = await repo.getVerification(tx, vId, true);
    if (!old) throw notFound('La verificación');
    assertEditable(old);
    const oldCycles = await repo.getCycles(tx, vId);
    await repo.deleteVerification(tx, vId);
    await repo.insertAudit(tx, { actor, entity: 'verification', entityId: vId, action: 'DELETE', oldValue: auditView(old, oldCycles) });
  });
}

// ── Verifications: calculate ───────────────────────────────────────────────

interface ServiceIssue {
  code: string;
  messageEs: string;
  reference: string;
}

/**
 * Server-authoritative calculation: resolves the reference's valid
 * verification, runs the §7 traceability rules (blocking issues → 422 and
 * nothing is stored), then the engine with the ACTIVE limits and config, and
 * stores results + inputs + snapshots + versions. Status → CALCULATED.
 */
export async function calculate(db: Pool, actor: Actor, id: string): Promise<VerificationDetail> {
  assertCan(actor.role, 'verification.calculate');
  const vId = parseUuid(id, 'id');
  return repo.withTransaction(db, async (tx) => {
    const v = await repo.getVerification(tx, vId, true);
    if (!v) throw notFound('La verificación');
    assertEditable(v);
    if (v.kind === 'CROSS_CHECK') {
      throw new CalError('kind_not_supported', 422, 'El motor todavía no evalúa verificaciones cruzadas (CROSS_CHECK).', 'kind');
    }
    const kind: VerificationKind = v.kind;
    const cycles = await repo.getCycles(tx, vId);
    const ref = await repo.getEquipment(tx, v.referenceEquipmentId);
    const cand = await repo.getEquipment(tx, v.candidateEquipmentId);
    if (!ref || !cand) throw notFound('El equipo');

    // §7.3 - the reference's verification at the test date.
    const extraBlocking: ServiceIssue[] = [];
    let refVer: Verification | null = null;
    let refInfo: ReferenceVerificationInfo | undefined;
    if (ref.type === 'SRP') {
      refInfo = referenceInfoFromCertificate(ref, v.referenceRoute);
    } else {
      if (v.referenceVerificationId) {
        refVer = await repo.getVerification(tx, v.referenceVerificationId);
        if (!refVer || refVer.candidateEquipmentId !== ref.id) {
          throw new CalError(
            'reference_verification_mismatch',
            422,
            'La verificación de referencia indicada no pertenece al patrón.',
            'referenceVerificationId',
          );
        }
      } else {
        refVer = (await repo.currentVerifications(tx, { candidateId: ref.id, asOf: v.verificationDate }))[0] ?? null;
      }
      if (refVer) {
        refInfo = referenceInfoFromVerification(refVer);
        if (refVer.status === 'APPROVED' && refVer.overallResult !== 'CONFORME') {
          extraBlocking.push({
            code: 'REFERENCE_NOT_CONFORME',
            messageEs: 'La verificación del patrón resultó NO CONFORME.',
            reference: 'IN.5.5.3 cap. 11 / TAD 2023',
          });
        }
      }
    }

    const allPoints = cycles.flatMap((c) => c.points);
    const setpoints = (cycles[0]?.points ?? []).map((p) => p.setpointPpb).filter((s): s is number => s !== null);
    const trace = validateTraceability({
      reference: toEquipmentInfo(ref),
      candidate: toEquipmentInfo(cand),
      testDate: v.verificationDate,
      referenceVerification: refInfo,
      ...(v.referenceInternalFactors ? { referenceCurrentInternalFactors: v.referenceInternalFactors } : {}),
      ...(v.referenceRoute ? { referenceRoute: v.referenceRoute } : {}),
      directorOverride: v.directorOverrideLevel4,
      ...(allPoints.length ? { candidateMaxPointPpb: Math.max(...allPoints.map((p) => p.xPpb)) } : {}),
      ...(v.labTempStartC !== null ? { labTempStartC: v.labTempStartC } : {}),
      ...(v.labTempEndC !== null ? { labTempEndC: v.labTempEndC } : {}),
      ...(setpoints.length ? { setpointsPpb: setpoints } : {}),
      ...(v.calibrationScalePpb !== null ? { scalePpb: v.calibrationScalePpb } : {}),
    });
    const blocking: ServiceIssue[] = [...trace.blocking, ...extraBlocking];
    if (blocking.length > 0) {
      throw new CalError('traceability_blocked', 422, 'La verificación no cumple las reglas de trazabilidad.', undefined, {
        issues: blocking,
        warnings: trace.warnings,
      });
    }

    // Candidate's last full verification (R1, R2, R5) for reverifications.
    let last: Verification | null = null;
    if (kind === 'REVERIFICATION_1_CYCLE') {
      last =
        (await repo.currentVerifications(tx, { candidateId: cand.id, asOf: v.verificationDate, kind: 'VERIFICATION_3_CYCLES' }))[0] ??
        null;
    }

    const limitSet = await getLimits(tx);
    const config = await getConfig(tx);
    const input = buildEngineInput(
      { kind, cycles: cyclesToDrafts(cycles), internalFactorsBefore: v.internalFactorsBefore, photometry: v.photometry },
      {
        ...(refVer && refVer.meanSlope !== null && refVer.meanIntercept !== null
          ? {
              referenceVerification: {
                traceabilityOption: refVer.traceabilityOption,
                meanSlope: refVer.meanSlope,
                meanIntercept: refVer.meanIntercept,
              },
            }
          : {}),
        ...(last && last.meanSlope !== null && last.meanIntercept !== null
          ? {
              lastVerification: {
                meanSlope: last.meanSlope,
                meanIntercept: last.meanIntercept,
                ...(last.internalFactorsAfter ?? last.internalFactorsBefore
                  ? { internalFactors: (last.internalFactorsAfter ?? last.internalFactorsBefore)! }
                  : {}),
              },
            }
          : {}),
      },
    );

    let evaluation: EvaluationResult;
    try {
      evaluation = evaluateVerification(input, config, limitSet.limits);
    } catch (e) {
      if (e instanceof RangeError) {
        throw new CalError(
          'invalid_structure',
          422,
          kind === 'REVERIFICATION_1_CYCLE'
            ? 'Una reverificación debe tener exactamente un ciclo.'
            : 'Los datos de la verificación no tienen una estructura calculable.',
          'cycles',
        );
      }
      throw e;
    }

    await repo.saveCalculation(tx, vId, {
      referenceVerificationId: refVer?.id ?? null,
      candidateLastVerificationId: last?.id ?? null,
      candidateLevel: trace.candidateLevel,
      limits: limitSet.limits,
      config,
      input,
      evaluation,
      warnings: trace.warnings as Issue[],
    });
    await repo.insertAudit(tx, {
      actor,
      entity: 'verification',
      entityId: vId,
      action: 'CALCULATE',
      oldValue: { status: v.status, overallResult: v.overallResult },
      newValue: {
        status: 'CALCULATED',
        overallResult: evaluation.overallResult,
        failReasons: evaluation.failReasons,
        aggregates: evaluation.aggregates,
        engineVersion: evaluation.engineVersion,
        limitsVersion: evaluation.limitsVersion,
        referenceVerificationId: refVer?.id ?? null,
        warnings: trace.warnings,
      },
    });
    return detail(tx, vId);
  });
}

// ── Verifications: approval workflow ───────────────────────────────────────

function assertCalculated(v: Verification): void {
  if (v.status !== 'CALCULATED') {
    throw new CalError('invalid_status', 409, `Solo se puede aprobar o rechazar una verificación CALCULADA (estado actual: ${v.status}).`);
  }
}

/**
 * DIRECTOR_TECNICO approves a CALCULATED record: it becomes immutable. A
 * CONFORME result sets the validity (§7.9, with the config snapshot the record
 * was calculated with) and the candidate's level. A reverification never
 * extends validity beyond its last full verification (DECISIONS D-020).
 */
export async function approve(db: Pool, actor: Actor, id: string): Promise<VerificationDetail> {
  assertCan(actor.role, 'verification.approve');
  const vId = parseUuid(id, 'id');
  return repo.withTransaction(db, async (tx) => {
    const v = await repo.getVerification(tx, vId, true);
    if (!v) throw notFound('La verificación');
    assertCalculated(v);
    const cand = await repo.getEquipment(tx, v.candidateEquipmentId, true);
    if (!cand) throw notFound('El equipo candidato');

    let validUntil: string | null = null;
    let reverificationDue: string | null = null;
    if (v.overallResult === 'CONFORME' && v.candidateLevel !== null && v.candidateLevel >= 2) {
      const level = v.candidateLevel as Level;
      const validity = computeValidUntil(v.verificationDate, level, cand.application, v.configSnapshot ?? DEFAULT_CONFIG);
      validUntil = validity.validUntil;
      reverificationDue = validity.reverificationDue;
      if (v.kind === 'REVERIFICATION_1_CYCLE' && v.candidateLastVerificationId) {
        const last = await repo.getVerification(tx, v.candidateLastVerificationId);
        if (last?.validUntil && last.validUntil < validUntil) validUntil = last.validUntil;
      }
      if (cand.currentLevel !== level) {
        await repo.setEquipmentLevel(tx, cand.id, level);
        await repo.insertAudit(tx, {
          actor,
          entity: 'equipment',
          entityId: cand.id,
          action: 'SET_LEVEL',
          oldValue: { currentLevel: cand.currentLevel },
          newValue: { currentLevel: level },
          reason: `Aprobación de la verificación ${vId}`,
        });
      }
    }
    await repo.setApproved(tx, vId, actor, validUntil, reverificationDue);
    await repo.insertAudit(tx, {
      actor,
      entity: 'verification',
      entityId: vId,
      action: 'APPROVE',
      oldValue: { status: v.status },
      newValue: { status: 'APPROVED', overallResult: v.overallResult, validUntil, reverificationDue },
    });
    return detail(tx, vId);
  });
}

export async function reject(db: Pool, actor: Actor, id: string, reason: unknown): Promise<VerificationDetail> {
  assertCan(actor.role, 'verification.approve');
  const vId = parseUuid(id, 'id');
  const why = parseReason(reason);
  return repo.withTransaction(db, async (tx) => {
    const v = await repo.getVerification(tx, vId, true);
    if (!v) throw notFound('La verificación');
    assertCalculated(v);
    await repo.setRejected(tx, vId, actor, why);
    await repo.insertAudit(tx, {
      actor,
      entity: 'verification',
      entityId: vId,
      action: 'REJECT',
      oldValue: { status: v.status },
      newValue: { status: 'REJECTED' },
      reason: why,
    });
    return detail(tx, vId);
  });
}

/**
 * An APPROVED record cannot change; a correction is a new DRAFT copy (header,
 * cycles, points; no results) with version + 1, supersedes_id and the reason.
 * The original technician is kept (the test data is theirs); the audit log
 * records who opened the new version.
 */
export async function newVersion(db: Pool, actor: Actor, id: string, reason: unknown): Promise<VerificationDetail> {
  assertCan(actor.role, 'verification.newVersion');
  const vId = parseUuid(id, 'id');
  const why = parseReason(reason);
  const alreadyOpen = () =>
    new CalError('version_already_open', 409, 'Ya hay una nueva versión abierta (o aprobada) de esta verificación.');
  try {
    return await repo.withTransaction(db, async (tx) => {
      const v = await repo.getVerification(tx, vId, true);
      if (!v) throw notFound('La verificación');
      if (v.status !== 'APPROVED') {
        throw new CalError('invalid_status', 409, 'Solo una verificación APROBADA admite una nueva versión.');
      }
      if (await repo.hasLiveNewVersion(tx, vId)) throw alreadyOpen();
      const cycles = await repo.getCycles(tx, vId);
      const newId = await repo.insertVerification(
        tx,
        draftHeader(v),
        { userId: v.technicianId, email: v.technicianEmail },
        { version: v.version + 1, supersedesId: vId, changeReason: why },
      );
      await repo.replaceCycles(tx, newId, cyclesToDrafts(cycles));
      await repo.insertAudit(tx, {
        actor,
        entity: 'verification',
        entityId: newId,
        action: 'NEW_VERSION',
        oldValue: { id: vId, version: v.version },
        newValue: { id: newId, version: v.version + 1, supersedesId: vId },
        reason: why,
      });
      return detail(tx, newId);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw alreadyOpen();
    throw e;
  }
}

// ── Reproducibility ────────────────────────────────────────────────────────

export interface ReproducibilityReport extends ReproducibilityDiff {
  verificationId: string;
  storedEngineVersion: string | null;
  currentEngineVersion: string;
  limitsVersion: string | null;
  storedOverallResult: string | null;
  recomputedOverallResult: string;
}

/**
 * Recomputes a calculated/approved verification with ITS stored input, limits
 * and config snapshots and reports whether the result is identical. It also
 * checks that the stored points still match the stored engine input.
 */
export async function recalculateCheck(db: repo.Db, id: string): Promise<ReproducibilityReport> {
  const vId = parseUuid(id, 'id');
  const v = await repo.getVerification(db, vId);
  if (!v) throw notFound('La verificación');
  if (!v.evaluation || !v.engineInput || !v.limitsSnapshot || !v.configSnapshot) {
    throw new CalError('not_calculated', 409, 'La verificación no ha sido calculada: no hay nada que reproducir.');
  }
  const recomputed = evaluateVerification(v.engineInput, v.configSnapshot, v.limitsSnapshot);
  const result = compareReproducibility(v.evaluation, recomputed);

  const cycles = await repo.getCycles(db, vId);
  const rebuilt = buildEngineInput(
    { kind: v.engineInput.kind, cycles: cyclesToDrafts(cycles), internalFactorsBefore: v.internalFactorsBefore, photometry: v.photometry },
    { referenceVerification: v.engineInput.referenceVerification, lastVerification: v.engineInput.lastVerification },
  );
  const inputDiff = compareReproducibility(v.engineInput, rebuilt);
  const differences = [...result.differences, ...inputDiff.differences.map((d) => `input.${d}`)];

  return {
    verificationId: vId,
    identical: differences.length === 0,
    differences,
    storedEngineVersion: v.engineVersion,
    currentEngineVersion: ENGINE_VERSION,
    limitsVersion: v.limitsVersion,
    storedOverallResult: v.overallResult,
    recomputedOverallResult: recomputed.overallResult,
  };
}

// ── Expirations and downstream impact ──────────────────────────────────────

export async function expirations(db: repo.Db, today: string) {
  const [all, current] = await Promise.all([repo.listEquipment(db), repo.currentVerifications(db)]);
  const byCandidate = new Map(current.map((v) => [v.candidateEquipmentId, v]));
  return all
    .filter((e) => e.active && e.type !== 'GENERATOR_ONLY' && e.hasPhotometer)
    .map((e) => {
      const cur = byCandidate.get(e.id);
      return {
        equipmentId: e.id,
        internalCode: e.internalCode,
        brand: e.brand,
        model: e.model,
        currentLevel: e.currentLevel,
        application: e.application,
        verificationId: cur?.id ?? null,
        validUntil: e.type === 'SRP' ? e.certificateValidUntil : (cur?.validUntil ?? null),
        reverificationDue: e.type === 'SRP' ? null : (cur?.reverificationDue ?? null),
        ...validityOf(e, cur, today),
      };
    })
    .sort((a, b) => (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY));
}

/**
 * §7.10: every verification that used this equipment as the reference since
 * its last valid verification (all of them when it has none, e.g. an SRP).
 */
export async function downstreamImpact(db: repo.Db, equipmentId: string) {
  const eqId = parseUuid(equipmentId, 'equipmentId');
  const equipment = await repo.getEquipment(db, eqId);
  if (!equipment) throw notFound('El equipo');
  const current = (await repo.currentVerifications(db, { candidateId: eqId }))[0] ?? null;
  const since = current?.verificationDate ?? null;
  const items = await repo.listVerifications(db, { referenceEquipmentId: eqId, ...(since ? { since } : {}) });
  return {
    equipmentId: eqId,
    internalCode: equipment.internalCode,
    since,
    items: items.map((i) => ({
      verificationId: i.id,
      candidateEquipmentId: i.candidateEquipmentId,
      candidateInternalCode: i.candidateInternalCode,
      verificationDate: i.verificationDate,
      status: i.status,
      overallResult: i.overallResult,
      validUntil: i.validUntil,
    })),
  };
}

