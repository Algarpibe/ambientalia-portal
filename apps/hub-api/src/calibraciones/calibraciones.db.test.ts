import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import { aplicarMigraciones } from '../db.js';
import { DEFAULT_CONFIG, DEFAULT_LIMITS, LIMITS_VERSION } from './o3-engine/index.js';
import { T3_MEAN_INTERCEPT, T3_MEAN_SLOPE, T3_X, T3_Y } from './o3-engine/fixtures.test-data.js';
import * as service from './service.js';
import { CalError, type Actor, type CycleDraft, type Equipment } from './types.js';

// Calibraciones against a real Postgres: migration 040, the ISO/IEC 17025
// locks that live in SQL (append-only audit log, immutable APPROVED records)
// and the full calculate → approve → new version flow with the TAD T3 data.

const MIGRATION_040 = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'users', 'migrations', '040_calibraciones.sql'),
  'utf8',
);

let db: Pool;

const tech: Actor = {
  userId: 'aaaaaaaa-0000-4000-8000-000000000001',
  email: 'tecnico@cal.test',
  role: 'TECNICO',
  isPortalAdmin: false,
};
const director: Actor = {
  userId: 'aaaaaaaa-0000-4000-8000-000000000002',
  email: 'director@cal.test',
  role: 'DIRECTOR_TECNICO',
  isPortalAdmin: false,
};
const reader: Actor = { ...tech, userId: 'aaaaaaaa-0000-4000-8000-000000000003', role: 'LECTOR' };
const admin: Actor = { ...tech, userId: 'aaaaaaaa-0000-4000-8000-000000000004', role: 'LECTOR', isPortalAdmin: true };

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query(
    `TRUNCATE portal.cal_points, portal.cal_cycles, portal.cal_verifications, portal.cal_equipment,
              portal.cal_audit_log, portal.cal_user_roles, portal.cal_limit_sets, portal.cal_config
     RESTART IDENTITY CASCADE`,
  );
  await db.query(`DELETE FROM portal.users WHERE email LIKE '%@cal.test'`);
  // Re-running the migration re-seeds limits and config (and proves, once
  // more, that it is idempotent).
  await db.query(MIGRATION_040);
});

async function expectCalError(p: Promise<unknown>, status: number, code?: string): Promise<CalError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CalError);
    expect((e as CalError).status).toBe(status);
    if (code) expect((e as CalError).code).toBe(code);
    return e as CalError;
  }
  throw new Error('expected a CalError');
}

const t3Cycles = (): CycleDraft[] =>
  T3_Y.map((ys, i) => ({
    index: i + 1,
    points: T3_X.map((x, j) => ({ order: j + 1, setpointPpb: x, xPpb: x, yPpb: ys[j] })),
  }));

async function equipment(internalCode: string, extra: Record<string, unknown> = {}, actor = director): Promise<Equipment> {
  return service.createEquipment(db, actor, {
    brand: 'Thermo',
    model: '49i-PS',
    serial: `SN-${internalCode}`,
    internalCode,
    type: 'PHOTOMETRIC_CALIBRATOR',
    hasPhotometer: true,
    application: 'BENCH',
    ...extra,
  });
}

const srp = () =>
  equipment('SRP-CALAIRE', {
    type: 'SRP',
    currentLevel: 1,
    certificateNumber: 'NIST-2026-01',
    certificateValidUntil: '2027-06-30',
    certificateMaxPpb: 500,
    certificateRoute: 'SAMPLE_IN',
  });

function draftBody(referenceId: string, candidateId: string, extra: Record<string, unknown> = {}) {
  return {
    kind: 'VERIFICATION_3_CYCLES',
    verificationDate: '2026-09-01',
    location: 'Laboratorio Bogotá',
    referenceEquipmentId: referenceId,
    candidateEquipmentId: candidateId,
    referenceRoute: 'SAMPLE_IN',
    candidateRoute: 'SAMPLE_IN',
    internalFactorsBefore: { span: 1.0, zero: 0.0 },
    labTempStartC: 22,
    labTempEndC: 23,
    cycles: t3Cycles(),
    ...extra,
  };
}

/** SRP → 6103-S (Level 2 BENCH) calculated and approved. */
async function approvedLevel2(code = '6103-S', application = 'BENCH') {
  const ref = await srp();
  const cand = await equipment(code, { application });
  const draft = await service.createVerification(db, tech, draftBody(ref.id, cand.id));
  await service.calculate(db, tech, draft.id);
  const approved = await service.approve(db, director, draft.id);
  return { ref, cand, approved };
}

describe('migration 040', () => {
  it('LOCK: the tables exist (i.e. 040 is in the MIGRATIONS array)', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'portal' AND table_name LIKE 'cal\\_%' ORDER BY table_name`,
    );
    expect((rows as { table_name: string }[]).map((r) => r.table_name)).toEqual([
      'cal_audit_log',
      'cal_config',
      'cal_cycles',
      'cal_equipment',
      'cal_limit_sets',
      'cal_points',
      'cal_user_roles',
      'cal_verifications',
    ]);
  });

  it('is idempotent: running every migration twice does not fail nor duplicate the seeds', async () => {
    await aplicarMigraciones(db);
    await aplicarMigraciones(db);
    const { rows } = await db.query('SELECT version, active FROM portal.cal_limit_sets');
    expect(rows).toEqual([{ version: LIMITS_VERSION, active: true }]);
  });

  it('seeds the engine defaults as the active limit set and config', async () => {
    expect(await service.getLimits(db)).toMatchObject({ version: LIMITS_VERSION, limits: DEFAULT_LIMITS });
    expect(await service.getConfig(db)).toEqual(DEFAULT_CONFIG);
  });
});

describe('audit log is append-only', () => {
  it('UPDATE and DELETE raise; INSERT works', async () => {
    await equipment('6103-S');
    const { rows } = await db.query('SELECT id FROM portal.cal_audit_log');
    expect(rows.length).toBeGreaterThan(0);
    await expect(db.query(`UPDATE portal.cal_audit_log SET reason = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.query('DELETE FROM portal.cal_audit_log')).rejects.toThrow(/append-only/);
  });

  it('every mutation is audited with old and new values', async () => {
    const e = await equipment('6103-S');
    await service.updateEquipment(db, tech, e.id, { notes: 'Revisado' });
    const log = await service.auditLog(db, 'equipment', e.id);
    expect(log.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
    expect(log[1].oldValue).toMatchObject({ notes: null });
    expect(log[1].newValue).toMatchObject({ notes: 'Revisado' });
    expect(log[1].actorEmail).toBe(tech.email);
  });
});

describe('equipment', () => {
  it('a unique internal code is a 409', async () => {
    await equipment('6103-S');
    await expectCalError(equipment('6103-S'), 409, 'internal_code_taken');
  });

  it('only the director sets the level', async () => {
    await expectCalError(equipment('6103-S', { currentLevel: 2 }, tech), 403, 'forbidden_role');
  });

  it('LECTOR cannot create', async () => {
    await expectCalError(equipment('6103-S', {}, reader), 403);
  });
});

describe('calculate → approve (TAD T3)', () => {
  it('calculates server-side, stores results, snapshots and versions', async () => {
    const ref = await srp();
    const cand = await equipment('6103-S');
    const draft = await service.createVerification(db, tech, draftBody(ref.id, cand.id));
    expect(draft.status).toBe('DRAFT');
    expect(draft.cycles).toHaveLength(3);

    const v = await service.calculate(db, tech, draft.id);
    expect(v.status).toBe('CALCULATED');
    expect(v.overallResult).toBe('CONFORME');
    expect(v.failReasons).toEqual([]);
    expect(v.meanSlope!).toBeCloseTo(T3_MEAN_SLOPE, 6);
    expect(v.meanIntercept!).toBeCloseTo(T3_MEAN_INTERCEPT, 6);
    expect(v.maxVerifiedPointPpb).toBe(200);
    expect(v.candidateLevel).toBe(2);
    expect(v.engineVersion).toBe('1.0.0');
    expect(v.limitsVersion).toBe(LIMITS_VERSION);
    expect(v.limitsSnapshot).toEqual(DEFAULT_LIMITS);
    expect(v.configSnapshot).toEqual(DEFAULT_CONFIG);
    expect(v.cycles[0].slope).not.toBeNull();
    expect(v.cycles[0].points[1]).toMatchObject({ xStdPpb: 15, diffType: 'ABS_PPB', pass: true });
    expect(v.validUntil).toBeNull();
  });

  it('approval locks the record, sets validity and the candidate level', async () => {
    const { cand, approved } = await approvedLevel2();
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedById).toBe(director.userId);
    expect(approved.validUntil).toBe('2027-09-01');
    const detail = await service.getEquipmentDetail(db, cand.id, '2026-09-29');
    expect(detail.equipment.currentLevel).toBe(2);
    expect(detail.currentVerification?.id).toBe(approved.id);
    expect(detail.validity).toMatchObject({ dueDate: '2027-09-01', bucket: 'OK' });
    expect(detail.ancestors.map((a) => a.internalCode)).toEqual(['SRP-CALAIRE']);
    expect(detail.history.map((h) => h.id)).toEqual([approved.id]);
    const log = await service.auditLog(db, 'verification', approved.id);
    expect(log.map((r) => r.action)).toEqual(['CREATE', 'CALCULATE', 'APPROVE']);
  });

  it('TECNICO cannot approve; only CALCULATED can be approved', async () => {
    const ref = await srp();
    const cand = await equipment('6103-S');
    const draft = await service.createVerification(db, tech, draftBody(ref.id, cand.id));
    await expectCalError(service.approve(db, tech, draft.id), 403);
    await expectCalError(service.approve(db, director, draft.id), 409, 'invalid_status');
  });

  it('editing a CALCULATED record sends it back to DRAFT and clears results', async () => {
    const ref = await srp();
    const cand = await equipment('6103-S');
    const draft = await service.createVerification(db, tech, draftBody(ref.id, cand.id));
    await service.calculate(db, tech, draft.id);
    const edited = await service.updateVerification(db, tech, draft.id, draftBody(ref.id, cand.id, { location: 'Campo' }));
    expect(edited.status).toBe('DRAFT');
    expect(edited.overallResult).toBeNull();
    expect(edited.location).toBe('Campo');
  });

  it('reject needs a reason and is terminal', async () => {
    const ref = await srp();
    const cand = await equipment('6103-S');
    const draft = await service.createVerification(db, tech, draftBody(ref.id, cand.id));
    await service.calculate(db, tech, draft.id);
    await expectCalError(service.reject(db, director, draft.id, ''), 400);
    const r = await service.reject(db, director, draft.id, 'Datos de campo incompletos');
    expect(r.status).toBe('REJECTED');
    expect(r.rejectionReason).toBe('Datos de campo incompletos');
    await expectCalError(service.updateVerification(db, tech, draft.id, draftBody(ref.id, cand.id)), 409);
  });
});

describe('APPROVED is immutable', () => {
  it('service updates, deletes and recalculations are 409', async () => {
    const { ref, cand, approved } = await approvedLevel2();
    await expectCalError(service.updateVerification(db, tech, approved.id, draftBody(ref.id, cand.id)), 409, 'verification_locked');
    await expectCalError(service.deleteVerification(db, tech, approved.id), 409, 'verification_locked');
    await expectCalError(service.calculate(db, tech, approved.id), 409, 'verification_locked');
  });

  it('the database itself rejects UPDATE/DELETE of the record, its cycles and points', async () => {
    const { approved } = await approvedLevel2();
    await expect(db.query(`UPDATE portal.cal_verifications SET location = 'x' WHERE id = $1`, [approved.id])).rejects.toThrow(/locked/);
    await expect(db.query('DELETE FROM portal.cal_verifications WHERE id = $1', [approved.id])).rejects.toThrow(/locked/);
    await expect(
      db.query('UPDATE portal.cal_points SET y_ppb = 0 WHERE cycle_id IN (SELECT id FROM portal.cal_cycles WHERE verification_id = $1)', [
        approved.id,
      ]),
    ).rejects.toThrow(/locked/);
    await expect(db.query('DELETE FROM portal.cal_cycles WHERE verification_id = $1', [approved.id])).rejects.toThrow(/locked/);
  });
});

describe('new version of an APPROVED record', () => {
  it('copies into a new DRAFT with supersedes_id and version + 1; needs a reason', async () => {
    const { approved } = await approvedLevel2();
    await expectCalError(service.newVersion(db, tech, approved.id, ' '), 400);
    const nv = await service.newVersion(db, tech, approved.id, 'Corrección de la ubicación');
    expect(nv).toMatchObject({ status: 'DRAFT', version: 2, supersedesId: approved.id, changeReason: 'Corrección de la ubicación' });
    expect(nv.cycles).toHaveLength(3);
    expect(nv.cycles[0].points).toHaveLength(7);
    expect(nv.overallResult).toBeNull();
    // Only one open version at a time.
    await expectCalError(service.newVersion(db, tech, approved.id, 'Otra'), 409, 'version_already_open');
  });

  it('once the new version is approved it becomes the current verification', async () => {
    const { cand, approved } = await approvedLevel2();
    const nv = await service.newVersion(db, tech, approved.id, 'Corrección');
    await service.calculate(db, tech, nv.id);
    await service.approve(db, director, nv.id);
    const detail = await service.getEquipmentDetail(db, cand.id, '2026-09-29');
    expect(detail.currentVerification?.id).toBe(nv.id);
    expect((await service.getVerification(db, approved.id)).status).toBe('APPROVED');
  });

  it('only APPROVED records get new versions', async () => {
    const ref = await srp();
    const cand = await equipment('6103-S');
    const draft = await service.createVerification(db, tech, draftBody(ref.id, cand.id));
    await expectCalError(service.newVersion(db, tech, draft.id, 'x'), 409, 'invalid_status');
  });
});

describe('reproducibility', () => {
  it('recalculating an approved verification with its snapshots is identical', async () => {
    const { approved } = await approvedLevel2();
    // Changing the active limits must not affect an old verification.
    const newLimits = { ...JSON.parse(JSON.stringify(DEFAULT_LIMITS)), version: '1.1.0' };
    newLimits.V1.maxPercent = 0.0001;
    await service.putLimits(db, director, { version: '1.1.0', limits: newLimits, reason: 'Prueba' });
    const r = await service.recalculateCheck(db, approved.id);
    expect(r).toMatchObject({ identical: true, differences: [], storedEngineVersion: '1.0.0', limitsVersion: LIMITS_VERSION });
  });

  it('detects a stored evaluation that no longer matches', async () => {
    const ref = await srp();
    const cand = await equipment('6103-S');
    const draft = await service.createVerification(db, tech, draftBody(ref.id, cand.id));
    await service.calculate(db, tech, draft.id);
    await db.query(
      `UPDATE portal.cal_verifications SET evaluation = jsonb_set(evaluation, '{aggregates,meanSlope}', '1.5') WHERE id = $1`,
      [draft.id],
    );
    const r = await service.recalculateCheck(db, draft.id);
    expect(r.identical).toBe(false);
    expect(r.differences).toContain('aggregates.meanSlope');
  });

  it('a draft has nothing to reproduce', async () => {
    const ref = await srp();
    const cand = await equipment('6103-S');
    const draft = await service.createVerification(db, tech, draftBody(ref.id, cand.id));
    await expectCalError(service.recalculateCheck(db, draft.id), 409, 'not_calculated');
  });
});

describe('traceability rules (422)', () => {
  it('a Level 3 against a FIELD Level 2 is blocked', async () => {
    const { cand: fieldL2 } = await approvedLevel2('6103-F', 'FIELD');
    const t = await equipment('6103-T');
    const draft = await service.createVerification(db, tech, draftBody(fieldL2.id, t.id, { verificationDate: '2026-09-10' }));
    const err = await expectCalError(service.calculate(db, tech, draft.id), 422, 'traceability_blocked');
    const codes = (err.detail!.issues as { code: string }[]).map((i) => i.code);
    expect(codes).toContain('LEVEL3_REQUIRES_BENCH_LEVEL2');
    expect((await service.getVerification(db, draft.id)).status).toBe('DRAFT');
  });

  it('a Level 3 against a BENCH Level 2 passes and resolves the reference verification', async () => {
    const { cand: benchL2, approved } = await approvedLevel2();
    const t = await equipment('6103-T');
    const draft = await service.createVerification(db, tech, draftBody(benchL2.id, t.id, { verificationDate: '2026-09-10' }));
    const v = await service.calculate(db, tech, draft.id);
    expect(v.overallResult).toBe('CONFORME');
    expect(v.candidateLevel).toBe(3);
    expect(v.referenceVerificationId).toBe(approved.id);
    const a = await service.approve(db, director, draft.id);
    expect(a.validUntil).toBe('2027-09-10');

    const impact = await service.downstreamImpact(db, benchL2.id);
    expect(impact.since).toBe('2026-09-01');
    expect(impact.items.map((i) => i.candidateInternalCode)).toEqual(['6103-T']);

    const s = await service.getEquipmentDetail(db, benchL2.id, '2026-09-29');
    expect(s.descendants.map((d) => d.internalCode)).toEqual(['6103-T']);
  });

  it('a reference verified with option 2 makes the engine apply Eq. 10 to every x', async () => {
    const ref = await srp();
    const s = await equipment('6103-S');
    const d1 = await service.createVerification(db, tech, draftBody(ref.id, s.id, { traceabilityOption: 2 }));
    await service.calculate(db, tech, d1.id);
    const refVer = await service.approve(db, director, d1.id);
    const t = await equipment('6103-T');
    const d2 = await service.createVerification(db, tech, draftBody(s.id, t.id, { verificationDate: '2026-09-10' }));
    const v = await service.calculate(db, tech, d2.id);
    expect(v.evaluation!.eq10Applied).toBe(true);
    const p = v.cycles[0].points[1];
    expect(p.xPpb).toBe(15);
    expect(p.xStdPpb!).toBeCloseTo((15 - refVer.meanIntercept!) / refVer.meanSlope!, 9);
  });

  it('a generator-only candidate is blocked', async () => {
    const ref = await srp();
    const gen = await equipment('SABIO-GEN', { type: 'GENERATOR_ONLY', hasPhotometer: false });
    const draft = await service.createVerification(db, tech, draftBody(ref.id, gen.id));
    const err = await expectCalError(service.calculate(db, tech, draft.id), 422);
    expect((err.detail!.issues as { code: string }[]).map((i) => i.code)).toContain('CANDIDATE_NOT_PHOTOMETRIC');
  });

  it('only the director may enable the Level 4 override', async () => {
    const ref = await srp();
    const cand = await equipment('6103-S');
    await expectCalError(
      service.createVerification(db, tech, draftBody(ref.id, cand.id, { directorOverrideLevel4: true })),
      403,
    );
  });
});

describe('expirations', () => {
  it('lists validity with days left and alert buckets', async () => {
    await approvedLevel2();
    const r = await service.expirations(db, '2027-08-15');
    const byCode = Object.fromEntries(r.map((i) => [i.internalCode, i]));
    expect(byCode['6103-S']).toMatchObject({ dueDate: '2027-09-01', daysLeft: 17, bucket: 'DUE_30' });
    expect(byCode['SRP-CALAIRE']).toMatchObject({ dueDate: '2027-06-30', bucket: 'EXPIRED' });
  });
});

describe('limits and config', () => {
  it('a director publishes a new limit version; the old one is deactivated; audited', async () => {
    const l = { ...JSON.parse(JSON.stringify(DEFAULT_LIMITS)), version: '1.1.0' };
    await expectCalError(service.putLimits(db, tech, { version: '1.1.0', limits: l, reason: 'x' }), 403);
    await service.putLimits(db, director, { version: '1.1.0', limits: l, reason: 'Nueva tabla' });
    expect((await service.getLimits(db)).version).toBe('1.1.0');
    const { rows } = await db.query('SELECT version, active FROM portal.cal_limit_sets ORDER BY id');
    expect(rows).toEqual([
      { version: '1.0.0', active: false },
      { version: '1.1.0', active: true },
    ]);
    await expectCalError(service.putLimits(db, director, { version: '1.1.0', limits: l, reason: 'x' }), 409);
    const log = await service.auditLog(db, 'limits', '1.1.0');
    expect(log[0]).toMatchObject({ action: 'CREATE', reason: 'Nueva tabla' });
  });

  it('config changes are audited with old and new values', async () => {
    const c = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    c.absDiffThresholdPpb = 49;
    await service.putConfig(db, director, { config: c, reason: 'Umbral estricto' });
    expect((await service.getConfig(db)).absDiffThresholdPpb).toBe(49);
    const log = await service.auditLog(db, 'config', 'engine');
    expect(log[0].oldValue).toMatchObject({ absDiffThresholdPpb: 50 });
    expect(log[0].newValue).toMatchObject({ absDiffThresholdPpb: 49 });
  });
});

describe('roles', () => {
  it('portal admins assign roles; unknown users default to LECTOR', async () => {
    const { rows } = await db.query(
      `INSERT INTO portal.users (full_name, email, password_hash, status) VALUES ('Téc', 'nuevo@cal.test', 'x', 'active') RETURNING id`,
    );
    const userId = (rows[0] as { id: string }).id;
    expect(await service.roleOf(db, userId)).toBe('LECTOR');
    await expectCalError(service.setRole(db, director, userId, 'TECNICO'), 403);
    await service.setRole(db, admin, userId, 'TECNICO');
    expect(await service.roleOf(db, userId)).toBe('TECNICO');
    const log = await service.auditLog(db, 'role', userId);
    expect(log[0]).toMatchObject({ action: 'SET_ROLE', newValue: { role: 'TECNICO' } });
  });
});
