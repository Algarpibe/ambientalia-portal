/**
 * CLI of the on-demand Calibraciones seed (see seed.ts, DECISIONS D-040).
 *
 *   npm run seed:calibraciones                     # dev (tsx), needs HUB_DB_URL
 *   npm run seed:calibraciones -- --with-sample    # + sample verification (T3)
 *   node dist/calibraciones/seed.cli.js [--with-sample]   # inside the hub-api container
 *
 * It does not run migrations: the tables must already exist (hub-api applies
 * 040_calibraciones.sql on boot).
 */
import { createPoolFromUrl } from '@algarpibe/zoho-sync';
import { seedCalibraciones } from './seed.js';

const BOGOTA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' });

async function main(): Promise<void> {
  const url = process.env.HUB_DB_URL;
  if (!url) {
    console.error('HUB_DB_URL no está definida.');
    process.exit(1);
  }
  const db = createPoolFromUrl(url);
  try {
    const { rows } = await db.query(`SELECT to_regclass('portal.cal_equipment') IS NOT NULL AS ok`);
    if (!(rows[0] as { ok: boolean }).ok) {
      throw new Error('No existe portal.cal_equipment: arranque hub-api una vez (aplica la migración 040) antes de sembrar.');
    }
    const report = await seedCalibraciones(db, {
      today: BOGOTA.format(new Date()),
      withSampleVerification: process.argv.includes('--with-sample'),
    });
    console.log(`Equipos creados: ${report.created.join(', ') || 'ninguno'}`);
    console.log(`Equipos ya existentes (sin tocar): ${report.skipped.join(', ') || 'ninguno'}`);
    if (report.sampleVerificationId) console.log(`Verificación de ejemplo aprobada: ${report.sampleVerificationId}`);
  } finally {
    await db.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
