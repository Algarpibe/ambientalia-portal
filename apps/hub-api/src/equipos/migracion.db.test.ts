import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';

// La 071 y la 072 contra Postgres de verdad: re-ejecutarlas (como hace initDb() en cada
// arranque) no falla, no siembra nada y deja las tablas y vistas esperadas.
const leer = (n: string) => readFileSync(fileURLToPath(new URL('../users/migrations/' + n, import.meta.url)), 'utf8');
const SQL = leer('071_equipos_taller.sql');
const SQL_072 = leer('072_equipos_drive_n8n.sql');

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

  it('deja sus cinco tablas y sus dos vistas (equipos_drive_archivos y equipos_sincronizacion son de la 072)', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'portal' AND table_name LIKE 'equipos\\_%' ORDER BY 1`,
    );
    expect(rows.map((r: { table_name: string }) => r.table_name)).toEqual([
      'equipos_ajuste', 'equipos_drive_archivos', 'equipos_ejecucion', 'equipos_estado', 'equipos_incidente', 'equipos_llaves',
      'equipos_sincronizacion', 'equipos_v_equipos', 'equipos_v_remisiones_ilegibles',
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
    // Otras pruebas dejan filas: se vacía ANTES de re-aplicar y se comprueba que la 071 no siembra.
    await db.query('TRUNCATE portal.equipos_estado, portal.equipos_ajuste, portal.equipos_ejecucion, portal.equipos_incidente, portal.equipos_llaves RESTART IDENTITY CASCADE');
    await db.query(SQL);
    for (const t of ['equipos_estado', 'equipos_ajuste', 'equipos_ejecucion', 'equipos_incidente', 'equipos_llaves']) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM portal.${t}`);
      expect(rows[0].n, t).toBe(0);
    }
  });
});

describe('migración 072 contra Postgres', () => {
  const vaciar = () => db.query('TRUNCATE portal.equipos_drive_archivos, portal.equipos_sincronizacion RESTART IDENTITY');
  const columnas = async () =>
    (await db.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name IN ('equipos_drive_archivos', 'equipos_sincronizacion') ORDER BY 1, 2`,
    )).rows;

  it('se puede aplicar dos veces más sin cambiar columnas ni borrar filas', async () => {
    await vaciar();
    await db.query(`INSERT INTO portal.equipos_drive_archivos (id, carpeta, titulo) VALUES ('ARCHIVO000001', 'entradas', 'X')`);
    const antes = await columnas();
    await db.query(SQL_072);
    await db.query(SQL_072);
    expect(await columnas()).toEqual(antes);
    expect((await db.query('SELECT count(*)::int AS n FROM portal.equipos_drive_archivos')).rows[0].n).toBe(1);
    await vaciar();
  });

  it('no siembra ninguna fila', async () => {
    await vaciar();
    await db.query(SQL_072);
    for (const t of ['equipos_drive_archivos', 'equipos_sincronizacion']) {
      expect((await db.query(`SELECT count(*)::int AS n FROM portal.${t}`)).rows[0].n, t).toBe(0);
    }
  });

  it('la base también comprueba el id, la carpeta, el fallo, que las salidas de n8n no lleven texto y el estado de la pasada', async () => {
    await vaciar();
    const malas = [
      `INSERT INTO portal.equipos_drive_archivos (id, carpeta, titulo) VALUES ('x'' OR 1=1', 'entradas', 'X')`,
      `INSERT INTO portal.equipos_drive_archivos (id, carpeta, titulo) VALUES ('ARCHIVO000002', 'temporal', 'X')`,
      `INSERT INTO portal.equipos_drive_archivos (id, carpeta, titulo, texto) VALUES ('ARCHIVO000003', 'salidas_n8n', 'X', 'texto')`,
      `INSERT INTO portal.equipos_drive_archivos (id, carpeta, titulo, error_status) VALUES ('ARCHIVO000004', 'entradas', 'X', 429)`,
      `INSERT INTO portal.equipos_drive_archivos (id, carpeta, titulo) VALUES ('ARCHIVO000005', 'entradas', '')`,
      `INSERT INTO portal.equipos_sincronizacion (pasada, fin) VALUES ('4711', now())`,
      `INSERT INTO portal.equipos_sincronizacion (pasada) VALUES ('4711; DROP')`,
    ];
    for (const sql of malas) await expect(db.query(sql), sql).rejects.toMatchObject({ code: '23514' });
  });
});
