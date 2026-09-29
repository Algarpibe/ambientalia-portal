/**
 * Data access of the Calibraciones app. Raw SQL with positional parameters,
 * like the rest of hub-api (no ORM). Every table is qualified with `portal.`.
 * DATE / TIMESTAMPTZ columns are read as ::text so node-pg never turns them
 * into local-time Date objects.
 */

import type { Pool } from '@algarpibe/zoho-sync';
import type { EngineConfig, EvaluationResult, Issue, Limits, VerificationInput } from './o3-engine/index.js';
import type { CalRole } from './roles.js';
import type {
  Actor,
  AuditEntry,
  Cycle,
  CycleDraft,
  Equipment,
  EquipmentInput,
  Point,
  Verification,
  VerificationDraftInput,
} from './types.js';

export type PoolClient = Awaited<ReturnType<Pool['connect']>>;
/** A pool or a transaction client: anything that can run a query. */
export type Db = Pick<PoolClient, 'query'>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Runs `fn` inside BEGIN/COMMIT; ROLLBACK on any error. */
export async function withTransaction<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const json = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));

// ── Equipment ──────────────────────────────────────────────────────────────

const EQUIPMENT_COLS = `
  id, brand, model, serial, internal_code, type, has_photometer, application, current_level, notes,
  certificate_number, certificate_valid_until::text AS certificate_valid_until, certificate_max_ppb,
  certificate_route, active, created_at::text AS created_at, updated_at::text AS updated_at`;

function toEquipment(r: Row): Equipment {
  return {
    id: r.id,
    brand: r.brand,
    model: r.model,
    serial: r.serial,
    internalCode: r.internal_code,
    type: r.type,
    hasPhotometer: r.has_photometer,
    application: r.application,
    currentLevel: r.current_level,
    notes: r.notes,
    certificateNumber: r.certificate_number,
    certificateValidUntil: r.certificate_valid_until,
    certificateMaxPpb: r.certificate_max_ppb,
    certificateRoute: r.certificate_route,
    active: r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const equipmentParams = (e: EquipmentInput) => [
  e.brand,
  e.model,
  e.serial,
  e.internalCode,
  e.type,
  e.hasPhotometer,
  e.application,
  e.currentLevel,
  e.notes,
  e.certificateNumber,
  e.certificateValidUntil,
  e.certificateMaxPpb,
  e.certificateRoute,
  e.active,
];

export async function insertEquipment(db: Db, e: EquipmentInput): Promise<Equipment> {
  const { rows } = await db.query(
    `INSERT INTO portal.cal_equipment
       (brand, model, serial, internal_code, type, has_photometer, application, current_level, notes,
        certificate_number, certificate_valid_until, certificate_max_ppb, certificate_route, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING ${EQUIPMENT_COLS}`,
    equipmentParams(e),
  );
  return toEquipment(rows[0]);
}

export async function updateEquipment(db: Db, id: string, e: EquipmentInput): Promise<Equipment> {
  const { rows } = await db.query(
    `UPDATE portal.cal_equipment
        SET brand = $1, model = $2, serial = $3, internal_code = $4, type = $5, has_photometer = $6,
            application = $7, current_level = $8, notes = $9, certificate_number = $10,
            certificate_valid_until = $11, certificate_max_ppb = $12, certificate_route = $13, active = $14,
            updated_at = NOW()
      WHERE id = $15
      RETURNING ${EQUIPMENT_COLS}`,
    [...equipmentParams(e), id],
  );
  return toEquipment(rows[0]);
}

export async function setEquipmentLevel(db: Db, id: string, level: number): Promise<void> {
  await db.query('UPDATE portal.cal_equipment SET current_level = $1, updated_at = NOW() WHERE id = $2', [level, id]);
}

export async function getEquipment(db: Db, id: string, forUpdate = false): Promise<Equipment | null> {
  const { rows } = await db.query(
    `SELECT ${EQUIPMENT_COLS} FROM portal.cal_equipment WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ? toEquipment(rows[0]) : null;
}

export async function listEquipment(db: Db): Promise<Equipment[]> {
  const { rows } = await db.query(`SELECT ${EQUIPMENT_COLS} FROM portal.cal_equipment ORDER BY internal_code`);
  return rows.map(toEquipment);
}

// ── Verifications ──────────────────────────────────────────────────────────

const VERIFICATION_COLS = `
  v.id, v.kind, v.verification_date::text AS verification_date, v.location, v.technician_id, v.technician_email,
  v.approved_by_id, v.approved_by_email, v.status, v.reference_equipment_id, v.candidate_equipment_id,
  v.reference_verification_id, v.candidate_last_verification_id, v.reference_route, v.candidate_route,
  v.traceability_option, v.internal_factors_before, v.internal_factors_after, v.reference_internal_factors,
  v.lab_temp_start_c, v.lab_temp_end_c, v.lab_rh_pct, v.baro_pressure_torr, v.total_flow_slpm,
  v.calibration_scale_ppb, v.acceptance_checklist, v.photometry, v.director_override_level4,
  v.mean_slope, v.mean_intercept, v.sd_slope, v.sd_intercept, v.max_verified_point_ppb, v.overall_result,
  v.fail_reasons, v.candidate_level, v.valid_until::text AS valid_until,
  v.reverification_due::text AS reverification_due, v.engine_version, v.limits_version, v.limits_snapshot,
  v.config_snapshot, v.engine_input, v.evaluation, v.traceability_warnings, v.version, v.supersedes_id,
  v.change_reason, v.rejection_reason, v.calculated_at::text AS calculated_at, v.approved_at::text AS approved_at,
  v.rejected_at::text AS rejected_at, v.created_at::text AS created_at, v.updated_at::text AS updated_at`;

function toVerification(r: Row): Verification {
  return {
    id: r.id,
    kind: r.kind,
    verificationDate: r.verification_date,
    location: r.location,
    technicianId: r.technician_id,
    technicianEmail: r.technician_email,
    approvedById: r.approved_by_id,
    approvedByEmail: r.approved_by_email,
    status: r.status,
    referenceEquipmentId: r.reference_equipment_id,
    candidateEquipmentId: r.candidate_equipment_id,
    referenceVerificationId: r.reference_verification_id,
    candidateLastVerificationId: r.candidate_last_verification_id,
    referenceRoute: r.reference_route,
    candidateRoute: r.candidate_route,
    traceabilityOption: r.traceability_option,
    internalFactorsBefore: r.internal_factors_before,
    internalFactorsAfter: r.internal_factors_after,
    referenceInternalFactors: r.reference_internal_factors,
    labTempStartC: r.lab_temp_start_c,
    labTempEndC: r.lab_temp_end_c,
    labRhPct: r.lab_rh_pct,
    baroPressureTorr: r.baro_pressure_torr,
    totalFlowSlpm: r.total_flow_slpm,
    calibrationScalePpb: r.calibration_scale_ppb,
    acceptanceChecklist: r.acceptance_checklist,
    photometry: r.photometry,
    directorOverrideLevel4: r.director_override_level4,
    meanSlope: r.mean_slope,
    meanIntercept: r.mean_intercept,
    sdSlope: r.sd_slope,
    sdIntercept: r.sd_intercept,
    maxVerifiedPointPpb: r.max_verified_point_ppb,
    overallResult: r.overall_result,
    failReasons: r.fail_reasons ?? [],
    candidateLevel: r.candidate_level,
    validUntil: r.valid_until,
    reverificationDue: r.reverification_due,
    engineVersion: r.engine_version,
    limitsVersion: r.limits_version,
    limitsSnapshot: r.limits_snapshot,
    configSnapshot: r.config_snapshot,
    engineInput: r.engine_input,
    evaluation: r.evaluation,
    traceabilityWarnings: r.traceability_warnings ?? [],
    version: r.version,
    supersedesId: r.supersedes_id,
    changeReason: r.change_reason,
    rejectionReason: r.rejection_reason,
    calculatedAt: r.calculated_at,
    approvedAt: r.approved_at,
    rejectedAt: r.rejected_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const headerParams = (v: Omit<VerificationDraftInput, 'cycles'>) => [
  v.kind,
  v.verificationDate,
  v.location,
  v.referenceEquipmentId,
  v.candidateEquipmentId,
  v.referenceVerificationId,
  v.referenceRoute,
  v.candidateRoute,
  v.traceabilityOption,
  json(v.internalFactorsBefore),
  json(v.internalFactorsAfter),
  json(v.referenceInternalFactors),
  v.labTempStartC,
  v.labTempEndC,
  v.labRhPct,
  v.baroPressureTorr,
  v.totalFlowSlpm,
  v.calibrationScalePpb,
  json(v.acceptanceChecklist),
  json(v.photometry),
  v.directorOverrideLevel4,
];

export async function insertVerification(
  db: Db,
  v: Omit<VerificationDraftInput, 'cycles'>,
  technician: Pick<Actor, 'userId' | 'email'>,
  versioning: { version: number; supersedesId: string | null; changeReason: string | null } = {
    version: 1,
    supersedesId: null,
    changeReason: null,
  },
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO portal.cal_verifications
       (kind, verification_date, location, reference_equipment_id, candidate_equipment_id,
        reference_verification_id, reference_route, candidate_route, traceability_option,
        internal_factors_before, internal_factors_after, reference_internal_factors,
        lab_temp_start_c, lab_temp_end_c, lab_rh_pct, baro_pressure_torr, total_flow_slpm,
        calibration_scale_ppb, acceptance_checklist, photometry, director_override_level4,
        technician_id, technician_email, version, supersedes_id, change_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
             $22, $23, $24, $25, $26)
     RETURNING id`,
    [
      ...headerParams(v),
      technician.userId,
      technician.email,
      versioning.version,
      versioning.supersedesId,
      versioning.changeReason,
    ],
  );
  return rows[0].id;
}

/** Rewrites the header of a DRAFT/CALCULATED record and clears every computed result (back to DRAFT). */
export async function updateVerificationHeader(db: Db, id: string, v: Omit<VerificationDraftInput, 'cycles'>): Promise<void> {
  await db.query(
    `UPDATE portal.cal_verifications
        SET kind = $1, verification_date = $2, location = $3, reference_equipment_id = $4,
            candidate_equipment_id = $5, reference_verification_id = $6, reference_route = $7,
            candidate_route = $8, traceability_option = $9, internal_factors_before = $10,
            internal_factors_after = $11, reference_internal_factors = $12, lab_temp_start_c = $13,
            lab_temp_end_c = $14, lab_rh_pct = $15, baro_pressure_torr = $16, total_flow_slpm = $17,
            calibration_scale_ppb = $18, acceptance_checklist = $19, photometry = $20,
            director_override_level4 = $21,
            ${CLEAR_RESULTS},
            updated_at = NOW()
      WHERE id = $22`,
    [...headerParams(v), id],
  );
}

const CLEAR_RESULTS = `
  status = 'DRAFT', candidate_last_verification_id = NULL, mean_slope = NULL, mean_intercept = NULL,
  sd_slope = NULL, sd_intercept = NULL, max_verified_point_ppb = NULL, overall_result = NULL,
  fail_reasons = '[]'::jsonb, candidate_level = NULL, valid_until = NULL, reverification_due = NULL,
  engine_version = NULL, limits_version = NULL, limits_snapshot = NULL, config_snapshot = NULL,
  engine_input = NULL, evaluation = NULL, traceability_warnings = '[]'::jsonb, calculated_at = NULL`;

/** Deletes the cycles (points cascade) and inserts the given ones. */
export async function replaceCycles(db: Db, verificationId: string, cycles: CycleDraft[]): Promise<void> {
  await db.query('DELETE FROM portal.cal_cycles WHERE verification_id = $1', [verificationId]);
  for (const c of cycles) {
    const { rows } = await db.query(
      'INSERT INTO portal.cal_cycles (verification_id, cycle_index) VALUES ($1, $2) RETURNING id',
      [verificationId, c.index],
    );
    const cycleId = rows[0].id;
    for (const p of c.points) {
      await db.query(
        `INSERT INTO portal.cal_points
           (cycle_id, point_order, setpoint_ppb, x_ppb, y_ppb, cell_temp_x_c, cell_temp_y_c,
            cell_press_x_torr, cell_press_y_torr, readings_count, timestamp_stable)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          cycleId,
          p.order,
          p.setpointPpb,
          p.xPpb,
          p.yPpb,
          p.cellTempXC ?? null,
          p.cellTempYC ?? null,
          p.cellPressXTorr ?? null,
          p.cellPressYTorr ?? null,
          p.readingsCount ?? null,
          p.timestampStable ?? null,
        ],
      );
    }
  }
}

export async function getVerification(db: Db, id: string, forUpdate = false): Promise<Verification | null> {
  const { rows } = await db.query(
    `SELECT ${VERIFICATION_COLS} FROM portal.cal_verifications v WHERE v.id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ? toVerification(rows[0]) : null;
}

export async function getCycles(db: Db, verificationId: string): Promise<Cycle[]> {
  const { rows } = await db.query(
    `SELECT c.cycle_index, c.slope, c.intercept, c.r2, c.pass AS cycle_pass, c.regression_error,
            p.point_order, p.setpoint_ppb, p.x_ppb, p.y_ppb, p.x_std_ppb, p.cell_temp_x_c, p.cell_temp_y_c,
            p.cell_press_x_torr, p.cell_press_y_torr, p.readings_count, p.timestamp_stable::text AS timestamp_stable,
            p.diff_value, p.diff_type, p.pass AS point_pass
       FROM portal.cal_cycles c
       LEFT JOIN portal.cal_points p ON p.cycle_id = c.id
      WHERE c.verification_id = $1
      ORDER BY c.cycle_index, p.point_order`,
    [verificationId],
  );
  const cycles = new Map<number, Cycle>();
  for (const r of rows) {
    let c = cycles.get(r.cycle_index);
    if (!c) {
      c = {
        index: r.cycle_index,
        slope: r.slope,
        intercept: r.intercept,
        r2: r.r2,
        pass: r.cycle_pass,
        regressionError: r.regression_error,
        points: [],
      };
      cycles.set(r.cycle_index, c);
    }
    if (r.point_order !== null) {
      const p: Point = {
        order: r.point_order,
        setpointPpb: r.setpoint_ppb,
        xPpb: r.x_ppb,
        yPpb: r.y_ppb,
        xStdPpb: r.x_std_ppb,
        cellTempXC: r.cell_temp_x_c,
        cellTempYC: r.cell_temp_y_c,
        cellPressXTorr: r.cell_press_x_torr,
        cellPressYTorr: r.cell_press_y_torr,
        readingsCount: r.readings_count,
        timestampStable: r.timestamp_stable,
        diffValue: r.diff_value,
        diffType: r.diff_type,
        pass: r.point_pass,
      };
      c.points.push(p);
    }
  }
  return [...cycles.values()];
}

export interface VerificationListItem extends Verification {
  referenceInternalCode: string;
  candidateInternalCode: string;
}

export async function listVerifications(
  db: Db,
  f: { equipmentId?: string; status?: string; referenceEquipmentId?: string; since?: string } = {},
): Promise<VerificationListItem[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.equipmentId) {
    params.push(f.equipmentId);
    where.push(`(v.candidate_equipment_id = $${params.length} OR v.reference_equipment_id = $${params.length})`);
  }
  if (f.referenceEquipmentId) {
    params.push(f.referenceEquipmentId);
    where.push(`v.reference_equipment_id = $${params.length}`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`v.status = $${params.length}`);
  }
  if (f.since) {
    params.push(f.since);
    where.push(`v.verification_date >= $${params.length}::date`);
  }
  const { rows } = await db.query(
    `SELECT ${VERIFICATION_COLS}, re.internal_code AS reference_internal_code, ce.internal_code AS candidate_internal_code
       FROM portal.cal_verifications v
       JOIN portal.cal_equipment re ON re.id = v.reference_equipment_id
       JOIN portal.cal_equipment ce ON ce.id = v.candidate_equipment_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY v.verification_date DESC, v.created_at DESC
      LIMIT 500`,
    params,
  );
  return rows.map((r: Row) => ({
    ...toVerification(r),
    referenceInternalCode: r.reference_internal_code,
    candidateInternalCode: r.candidate_internal_code,
  }));
}

export async function historyOf(db: Db, candidateId: string): Promise<Verification[]> {
  const { rows } = await db.query(
    `SELECT ${VERIFICATION_COLS} FROM portal.cal_verifications v
      WHERE v.candidate_equipment_id = $1
      ORDER BY v.verification_date DESC, v.version DESC, v.created_at DESC`,
    [candidateId],
  );
  return rows.map(toVerification);
}

export async function deleteVerification(db: Db, id: string): Promise<void> {
  await db.query('DELETE FROM portal.cal_verifications WHERE id = $1', [id]);
}

/**
 * The current valid verifications: APPROVED, CONFORME and not superseded by an
 * APPROVED newer version; the latest by date per candidate. Optionally only
 * those dated on/before `asOf` and of one kind.
 */
export async function currentVerifications(
  db: Db,
  opts: { candidateId?: string; asOf?: string; kind?: string } = {},
): Promise<Verification[]> {
  const where = [
    `v.status = 'APPROVED'`,
    `v.overall_result = 'CONFORME'`,
    `NOT EXISTS (SELECT 1 FROM portal.cal_verifications n WHERE n.supersedes_id = v.id AND n.status = 'APPROVED')`,
  ];
  const params: unknown[] = [];
  if (opts.candidateId) {
    params.push(opts.candidateId);
    where.push(`v.candidate_equipment_id = $${params.length}`);
  }
  if (opts.asOf) {
    params.push(opts.asOf);
    where.push(`v.verification_date <= $${params.length}::date`);
  }
  if (opts.kind) {
    params.push(opts.kind);
    where.push(`v.kind = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT DISTINCT ON (v.candidate_equipment_id) ${VERIFICATION_COLS}
       FROM portal.cal_verifications v
      WHERE ${where.join(' AND ')}
      ORDER BY v.candidate_equipment_id, v.verification_date DESC, v.version DESC, v.approved_at DESC`,
    params,
  );
  return rows.map(toVerification);
}

export async function hasLiveNewVersion(db: Db, id: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM portal.cal_verifications WHERE supersedes_id = $1 AND status IN ('DRAFT', 'CALCULATED', 'APPROVED')`,
    [id],
  );
  return rows.length > 0;
}

export interface CalculationToSave {
  referenceVerificationId: string | null;
  candidateLastVerificationId: string | null;
  candidateLevel: number | null;
  limits: Limits;
  config: EngineConfig;
  input: VerificationInput;
  evaluation: EvaluationResult;
  warnings: Issue[];
}

/** Stores the engine output on the header, cycles and points; status → CALCULATED. */
export async function saveCalculation(db: Db, id: string, c: CalculationToSave): Promise<void> {
  const e = c.evaluation;
  const a = e.aggregates;
  await db.query(
    `UPDATE portal.cal_verifications
        SET status = 'CALCULATED', reference_verification_id = $2, candidate_last_verification_id = $3,
            candidate_level = $4, mean_slope = $5, mean_intercept = $6, sd_slope = $7, sd_intercept = $8,
            max_verified_point_ppb = $9, overall_result = $10, fail_reasons = $11, engine_version = $12,
            limits_version = $13, limits_snapshot = $14, config_snapshot = $15, engine_input = $16,
            evaluation = $17, traceability_warnings = $18, calculated_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [
      id,
      c.referenceVerificationId,
      c.candidateLastVerificationId,
      c.candidateLevel,
      a?.meanSlope ?? null,
      a?.meanIntercept ?? null,
      finiteOrNull(a?.sdSlope),
      finiteOrNull(a?.sdIntercept),
      a?.maxVerifiedPointPpb ?? null,
      e.overallResult,
      json(e.failReasons),
      e.engineVersion,
      e.limitsVersion,
      json(c.limits),
      json(c.config),
      json(c.input),
      json(e),
      json(c.warnings),
    ],
  );
  for (const cy of e.cycles) {
    const { rows } = await db.query(
      `UPDATE portal.cal_cycles SET slope = $3, intercept = $4, r2 = $5, pass = $6, regression_error = $7
        WHERE verification_id = $1 AND cycle_index = $2 RETURNING id`,
      [
        id,
        cy.index,
        cy.regression?.slope ?? null,
        cy.regression?.intercept ?? null,
        finiteOrNull(cy.regression?.r2),
        cy.pass,
        cy.regressionError,
      ],
    );
    const cycleId = rows[0]?.id;
    if (!cycleId) continue;
    for (const p of cy.points) {
      await db.query(
        `UPDATE portal.cal_points SET x_std_ppb = $3, diff_value = $4, diff_type = $5, pass = $6
          WHERE cycle_id = $1 AND point_order = $2`,
        [cycleId, p.order, p.xPpb, finiteOrNull(p.diffValue), p.diffType, p.pass],
      );
    }
  }
}

const finiteOrNull = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export async function setApproved(
  db: Db,
  id: string,
  approver: Pick<Actor, 'userId' | 'email'>,
  validUntil: string | null,
  reverificationDue: string | null,
): Promise<void> {
  await db.query(
    `UPDATE portal.cal_verifications
        SET status = 'APPROVED', approved_by_id = $2, approved_by_email = $3, approved_at = NOW(),
            valid_until = $4, reverification_due = $5, updated_at = NOW()
      WHERE id = $1`,
    [id, approver.userId, approver.email, validUntil, reverificationDue],
  );
}

export async function setRejected(db: Db, id: string, approver: Pick<Actor, 'userId' | 'email'>, reason: string): Promise<void> {
  await db.query(
    `UPDATE portal.cal_verifications
        SET status = 'REJECTED', approved_by_id = $2, approved_by_email = $3, rejected_at = NOW(),
            rejection_reason = $4, updated_at = NOW()
      WHERE id = $1`,
    [id, approver.userId, approver.email, reason],
  );
}

// ── Limits and config ──────────────────────────────────────────────────────

export interface LimitSet {
  id: number;
  version: string;
  limits: Limits;
  active: boolean;
  createdByEmail: string;
  reason: string;
  createdAt: string;
}

const toLimitSet = (r: Row): LimitSet => ({
  id: r.id,
  version: r.version,
  limits: r.limits,
  active: r.active,
  createdByEmail: r.created_by_email,
  reason: r.reason,
  createdAt: r.created_at,
});

const LIMIT_COLS = 'id, version, limits, active, created_by_email, reason, created_at::text AS created_at';

export async function activeLimitSet(db: Db): Promise<LimitSet | null> {
  const { rows } = await db.query(`SELECT ${LIMIT_COLS} FROM portal.cal_limit_sets WHERE active`);
  return rows[0] ? toLimitSet(rows[0]) : null;
}

export async function listLimitSets(db: Db): Promise<LimitSet[]> {
  const { rows } = await db.query(`SELECT ${LIMIT_COLS} FROM portal.cal_limit_sets ORDER BY id DESC`);
  return rows.map(toLimitSet);
}

export async function limitSetExists(db: Db, version: string): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM portal.cal_limit_sets WHERE version = $1', [version]);
  return rows.length > 0;
}

/** Deactivates the current set and inserts the new one as active. Call inside a transaction. */
export async function insertActiveLimitSet(
  db: Db,
  version: string,
  limits: Limits,
  actor: Pick<Actor, 'userId' | 'email'>,
  reason: string,
): Promise<LimitSet> {
  await db.query('UPDATE portal.cal_limit_sets SET active = FALSE WHERE active');
  const { rows } = await db.query(
    `INSERT INTO portal.cal_limit_sets (version, limits, active, created_by_id, created_by_email, reason)
     VALUES ($1, $2, TRUE, $3, $4, $5) RETURNING ${LIMIT_COLS}`,
    [version, json(limits), actor.userId, actor.email, reason],
  );
  return toLimitSet(rows[0]);
}

export async function getConfigRows(db: Db): Promise<Record<string, unknown>> {
  const { rows } = await db.query('SELECT key, value FROM portal.cal_config');
  return Object.fromEntries(rows.map((r: Row) => [r.key, r.value]));
}

export async function setConfigValue(db: Db, key: string, value: unknown, actor: Pick<Actor, 'userId' | 'email'>): Promise<void> {
  await db.query(
    `INSERT INTO portal.cal_config (key, value, updated_by_id, updated_by_email, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by_id = EXCLUDED.updated_by_id,
           updated_by_email = EXCLUDED.updated_by_email, updated_at = NOW()`,
    [key, json(value), actor.userId, actor.email],
  );
}

// ── Roles ──────────────────────────────────────────────────────────────────

export async function getRole(db: Db, userId: string): Promise<string | null> {
  const { rows } = await db.query('SELECT role FROM portal.cal_user_roles WHERE user_id = $1', [userId]);
  return rows[0]?.role ?? null;
}

export async function upsertRole(db: Db, userId: string, role: CalRole, actorEmail: string): Promise<void> {
  await db.query(
    `INSERT INTO portal.cal_user_roles (user_id, role, updated_by_email, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET role = EXCLUDED.role, updated_by_email = EXCLUDED.updated_by_email, updated_at = NOW()`,
    [userId, role, actorEmail],
  );
}

export async function userExists(db: Db, userId: string): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM portal.users WHERE id = $1', [userId]);
  return rows.length > 0;
}

export interface RoleUser {
  userId: string;
  fullName: string;
  email: string;
  status: string;
  role: string | null;
}

/** Users who have the app assigned or a stored role. */
export async function listRoleUsers(db: Db, appId: string): Promise<RoleUser[]> {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.status, r.role
       FROM portal.users u
       LEFT JOIN portal.cal_user_roles r ON r.user_id = u.id
      WHERE r.user_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM portal.user_apps a WHERE a.user_id = u.id AND a.app_id = $1)
      ORDER BY u.full_name`,
    [appId],
  );
  return rows.map((r: Row) => ({ userId: r.id, fullName: r.full_name, email: r.email, status: r.status, role: r.role }));
}

// ── Audit log ──────────────────────────────────────────────────────────────

export interface AuditToWrite {
  actor: Pick<Actor, 'userId' | 'email'>;
  entity: string;
  entityId: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

export async function insertAudit(db: Db, a: AuditToWrite): Promise<void> {
  await db.query(
    `INSERT INTO portal.cal_audit_log (actor_id, actor_email, entity, entity_id, action, old_value, new_value, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [a.actor.userId, a.actor.email, a.entity, a.entityId, a.action, json(a.oldValue), json(a.newValue), a.reason ?? null],
  );
}

export async function listAudit(db: Db, f: { entity?: string; entityId?: string } = {}): Promise<AuditEntry[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.entity) {
    params.push(f.entity);
    where.push(`entity = $${params.length}`);
  }
  if (f.entityId) {
    params.push(f.entityId);
    where.push(`entity_id = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT id::text AS id, actor_id, actor_email, entity, entity_id, action, old_value, new_value, reason,
            at::text AS at
       FROM portal.cal_audit_log
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id
      LIMIT 1000`,
    params,
  );
  return rows.map((r: Row) => ({
    id: r.id,
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    entity: r.entity,
    entityId: r.entity_id,
    action: r.action,
    oldValue: r.old_value,
    newValue: r.new_value,
    reason: r.reason,
    at: r.at,
  }));
}
