import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import { SEED_EQUIPMENT, seedCalibraciones } from './seed.js';

// On-demand demo data (master prompt §10): never part of the boot migrations,
// so it only reaches a database when someone runs `npm run seed:calibraciones`.

const MIGRATION_040 = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'users', 'migrations', '040_calibraciones.sql'),
  'utf8',
);

let db: Pool;

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
  await db.query(MIGRATION_040);
});

const TODAY = '2026-09-29';

async function equipmentRows() {
  const { rows } = await db.query(
    `SELECT internal_code, type, has_photometer, application, current_level, serial, certificate_number,
            certificate_valid_until::text AS certificate_valid_until, certificate_max_ppb
       FROM portal.cal_equipment ORDER BY internal_code`,
  );
  return rows as Record<string, unknown>[];
}

const count = async (table: string) =>
  Number(((await db.query(`SELECT count(*)::int AS n FROM portal.${table}`)).rows[0] as { n: number }).n);

describe('seedCalibraciones', () => {
  it('creates the five §10 demo equipment with placeholder serials', async () => {
    const report = await seedCalibraciones(db, { today: TODAY });
    expect(report.created.sort()).toEqual(SEED_EQUIPMENT.map((e) => e.internalCode).sort());
    expect(report.skipped).toEqual([]);

    const rows = await equipmentRows();
    expect(rows.map((r) => r.internal_code)).toEqual(['6103-S', '6103-T', 'SABIO-2010D-F', 'SABIO-2010D-G', 'SRP-CALAIRE']);
    for (const r of rows) expect(String(r.serial)).toMatch(/^DEMO-/);

    const byCode = Object.fromEntries(rows.map((r) => [r.internal_code, r]));
    expect(byCode['SRP-CALAIRE']).toMatchObject({ type: 'SRP', current_level: 1, certificate_valid_until: '2027-09-29' });
    expect(String(byCode['SRP-CALAIRE'].certificate_number)).toMatch(/^DEMO-/);
    expect(Number(byCode['SRP-CALAIRE'].certificate_max_ppb)).toBeGreaterThanOrEqual(200);
    expect(byCode['6103-S']).toMatchObject({ current_level: 2, application: 'BENCH', has_photometer: true });
    expect(byCode['6103-T']).toMatchObject({ current_level: 3 });
    expect(byCode['SABIO-2010D-F']).toMatchObject({ type: 'PHOTOMETRIC_CALIBRATOR', has_photometer: true });
    expect(byCode['SABIO-2010D-G']).toMatchObject({ type: 'GENERATOR_ONLY', has_photometer: false });
  });

  it('is idempotent: a second run creates nothing and changes nothing', async () => {
    await seedCalibraciones(db, { today: TODAY, withSampleVerification: true });
    const before = await equipmentRows();
    const audit = await count('cal_audit_log');
    const verifications = await count('cal_verifications');

    const again = await seedCalibraciones(db, { today: TODAY, withSampleVerification: true });
    expect(again.created).toEqual([]);
    expect(again.skipped).toHaveLength(SEED_EQUIPMENT.length);
    expect(again.sampleVerificationId).toBeNull();
    expect(await equipmentRows()).toEqual(before);
    expect(await count('cal_audit_log')).toBe(audit);
    expect(await count('cal_verifications')).toBe(verifications);
  });

  it('never overwrites equipment that already exists (edited by a user)', async () => {
    await seedCalibraciones(db, { today: TODAY });
    await db.query(`UPDATE portal.cal_equipment SET serial = 'REAL-123' WHERE internal_code = '6103-S'`);
    await seedCalibraciones(db, { today: TODAY });
    const { rows } = await db.query(`SELECT serial FROM portal.cal_equipment WHERE internal_code = '6103-S'`);
    expect((rows[0] as { serial: string }).serial).toBe('REAL-123');
  });

  it('optional sample: SRP → 6103-S with the TAD T3 data, calculated and approved CONFORME', async () => {
    const report = await seedCalibraciones(db, { today: TODAY, withSampleVerification: true });
    expect(report.sampleVerificationId).not.toBeNull();
    const { rows } = await db.query(
      `SELECT status, overall_result, mean_slope, mean_intercept, change_reason
         FROM portal.cal_verifications WHERE id = $1`,
      [report.sampleVerificationId],
    );
    const v = rows[0] as { status: string; overall_result: string; mean_slope: number; mean_intercept: number };
    expect(v.status).toBe('APPROVED');
    expect(v.overall_result).toBe('CONFORME');
    expect(Number(v.mean_slope)).toBeCloseTo(1.0073827, 6);
    expect(Number(v.mean_intercept)).toBeCloseTo(0.2197351, 6);
  });

  it('without the flag no verification is created', async () => {
    const report = await seedCalibraciones(db, { today: TODAY });
    expect(report.sampleVerificationId).toBeNull();
    expect(await count('cal_verifications')).toBe(0);
  });
});
