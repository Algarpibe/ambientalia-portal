/**
 * On-demand demo data for Calibraciones (master prompt §10 seeds).
 *
 * NOT part of the boot migrations (DECISIONS D-040): production only gets
 * these rows when someone runs `npm run seed:calibraciones` on purpose.
 *
 * Idempotent: equipment is matched by `internal_code`; an existing row is
 * left untouched (never overwritten, a user may have replaced the placeholder
 * serial with the real one). The optional sample verification is created only
 * while the candidate has no verification at all.
 *
 * Everything goes through the service layer, so the audit log records who
 * seeded what (actor `seed:calibraciones`).
 */
import type { Pool } from '@algarpibe/zoho-sync';
import * as repo from './repo.js';
import * as service from './service.js';
import type { Actor, EquipmentInput } from './types.js';

export const SEED_ACTOR: Actor = {
  userId: '00000000-0000-4000-8000-00000000cafe',
  email: 'seed:calibraciones',
  role: 'DIRECTOR_TECNICO',
  isPortalAdmin: false,
};

const DEMO_NOTE = 'Dato de ejemplo (semilla). Reemplace la serie y el certificado por los reales o desactive el equipo.';

type SeedEquipment = Omit<EquipmentInput, 'certificateValidUntil'> & { certificateValidDays?: number };

/** The five §10 equipment. Serials and certificate numbers are obvious placeholders ("DEMO-…"). */
export const SEED_EQUIPMENT: readonly SeedEquipment[] = [
  {
    brand: 'NIST',
    model: 'SRP (Standard Reference Photometer)',
    serial: 'DEMO-SRP-001',
    internalCode: 'SRP-CALAIRE',
    type: 'SRP',
    hasPhotometer: true,
    application: 'BENCH',
    currentLevel: 1,
    notes: `SRP de Calaire (Nivel 1). ${DEMO_NOTE}`,
    certificateNumber: 'DEMO-CERT-SRP-001',
    certificateValidDays: 365,
    certificateMaxPpb: 500,
    certificateRoute: 'SAMPLE_IN',
    active: true,
  },
  {
    brand: 'Environics',
    model: '6103',
    serial: 'DEMO-6103-S',
    internalCode: '6103-S',
    type: 'PHOTOMETRIC_CALIBRATOR',
    hasPhotometer: true,
    application: 'BENCH',
    currentLevel: 2,
    notes: `Patrón de banco Nivel 2. ${DEMO_NOTE}`,
    certificateNumber: null,
    certificateMaxPpb: null,
    certificateRoute: null,
    active: true,
  },
  {
    brand: 'Environics',
    model: '6103',
    serial: 'DEMO-6103-T',
    internalCode: '6103-T',
    type: 'PHOTOMETRIC_CALIBRATOR',
    hasPhotometer: true,
    application: 'FIELD',
    currentLevel: 3,
    notes: `Patrón de transferencia Nivel 3. ${DEMO_NOTE}`,
    certificateNumber: null,
    certificateMaxPpb: null,
    certificateRoute: null,
    active: true,
  },
  {
    brand: 'Sabio',
    model: '2010D',
    serial: 'DEMO-2010D-F',
    internalCode: 'SABIO-2010D-F',
    type: 'PHOTOMETRIC_CALIBRATOR',
    hasPhotometer: true,
    application: 'FIELD',
    currentLevel: null,
    notes: `Sabio 2010D con fotómetro. ${DEMO_NOTE}`,
    certificateNumber: null,
    certificateMaxPpb: null,
    certificateRoute: null,
    active: true,
  },
  {
    brand: 'Sabio',
    model: '2010D',
    serial: 'DEMO-2010D-G',
    internalCode: 'SABIO-2010D-G',
    type: 'GENERATOR_ONLY',
    hasPhotometer: false,
    application: 'FIELD',
    currentLevel: null,
    notes: `Sabio 2010D solo generador (no puede ser patrón de transferencia). ${DEMO_NOTE}`,
    certificateNumber: null,
    certificateMaxPpb: null,
    certificateRoute: null,
    active: true,
  },
];

/** TAD 2023 synthetic example T3 (master prompt §9): 3 cycles, zero included. */
const T3_X = [0, 15, 52, 89, 126, 163, 200];
const T3_Y = [
  [0.3, 15.2, 52.6, 89.9, 127.1, 164.4, 201.6],
  [0.1, 15.0, 52.9, 90.2, 127.4, 164.3, 201.9],
  [0.4, 15.4, 52.5, 89.7, 126.9, 164.6, 201.5],
];

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface SeedOptions {
  /** YYYY-MM-DD: base of the SRP certificate validity and the sample verification date. */
  today: string;
  /** Also create SRP-CALAIRE → 6103-S with the T3 data, calculated and approved. */
  withSampleVerification?: boolean;
}

export interface SeedReport {
  created: string[];
  skipped: string[];
  sampleVerificationId: string | null;
}

export async function seedCalibraciones(db: Pool, opts: SeedOptions): Promise<SeedReport> {
  const existing = new Map((await repo.listEquipment(db)).map((e) => [e.internalCode, e]));
  const report: SeedReport = { created: [], skipped: [], sampleVerificationId: null };

  for (const seed of SEED_EQUIPMENT) {
    if (existing.has(seed.internalCode)) {
      report.skipped.push(seed.internalCode);
      continue;
    }
    const { certificateValidDays, ...rest } = seed;
    const input: EquipmentInput = {
      ...rest,
      certificateValidUntil: certificateValidDays !== undefined ? addDays(opts.today, certificateValidDays) : null,
    };
    const e = await service.createEquipment(db, SEED_ACTOR, input);
    existing.set(e.internalCode, e);
    report.created.push(e.internalCode);
  }

  if (opts.withSampleVerification) {
    const ref = existing.get('SRP-CALAIRE');
    const cand = existing.get('6103-S');
    if (ref && cand && (await repo.historyOf(db, cand.id)).length === 0) {
      const draft = await service.createVerification(db, SEED_ACTOR, {
        kind: 'VERIFICATION_3_CYCLES',
        verificationDate: opts.today,
        location: 'Laboratorio (dato de ejemplo)',
        referenceEquipmentId: ref.id,
        candidateEquipmentId: cand.id,
        referenceRoute: 'SAMPLE_IN',
        candidateRoute: 'SAMPLE_IN',
        traceabilityOption: 1,
        internalFactorsBefore: { span: 1.0, zero: 0.0 },
        internalFactorsAfter: { span: 1.0, zero: 0.0 },
        labTempStartC: 22,
        labTempEndC: 23,
        labRhPct: 45,
        baroPressureTorr: 560,
        totalFlowSlpm: 5,
        calibrationScalePpb: 200,
        acceptanceChecklist: {
          warmup: true,
          leakTest: true,
          diagnostics: true,
          tpContrast: true,
          averaging: true,
          noiseFilt: true,
          warmupMinutes: 30,
          notes: 'Verificación de ejemplo con los datos T3 del prompt maestro.',
        },
        cycles: T3_Y.map((ys, i) => ({
          index: i + 1,
          points: T3_X.map((x, j) => ({ order: j + 1, setpointPpb: x, xPpb: x, yPpb: ys[j] })),
        })),
      });
      await service.calculate(db, SEED_ACTOR, draft.id);
      const approved = await service.approve(db, SEED_ACTOR, draft.id);
      report.sampleVerificationId = approved.id;
    }
  }
  return report;
}
