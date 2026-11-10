import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';

// La 071 contra Postgres de verdad: re-ejecutarla (como hace initDb() en cada arranque)
// no falla, no siembra nada y deja las tablas y vistas esperadas.
const SQL = readFileSync(fileURLToPath(new URL('../users/migrations/071_equipos_taller.sql', import.meta.url)), 'utf8');

let db: Pool;
beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});

describe('migración 071 contra Postgres', () => {
  it('se puede aplicar dos veces más sobre la ya aplicada (idempotente)', async () => {
    await db.query(SQL);
    await db.query(SQL);
  });

  it('deja las cinco tablas y las dos vistas', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'portal' AND table_name LIKE 'equipos\\_%' ORDER BY 1`,
    );
    expect(rows.map((r: { table_name: string }) => r.table_name)).toEqual([
      'equipos_ajuste', 'equipos_ejecucion', 'equipos_estado', 'equipos_incidente', 'equipos_llaves',
      'equipos_v_equipos', 'equipos_v_remisiones_ilegibles',
    ]);
  });

  it('equipos_ejecucion lleva avisos y equipos_ajuste no lleva hasta (A1, A2)', async () => {
    const { rows } = await db.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name IN ('equipos_ejecucion', 'equipos_ajuste')`,
    );
    const cols = rows.map((r: { table_name: string; column_name: string }) => `${r.table_name}.${r.column_name}`);
    expect(cols).toContain('equipos_ejecucion.avisos');
    expect(cols).not.toContain('equipos_ajuste.hasta');
  });

  it('no siembra ninguna fila', async () => {
    for (const t of ['equipos_estado', 'equipos_ajuste', 'equipos_ejecucion', 'equipos_incidente', 'equipos_llaves']) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM portal.${t}`);
      expect(rows[0].n, t).toBe(0);
    }
  });
});
