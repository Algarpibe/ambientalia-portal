import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';

// La 071, la 072 y la 073 contra Postgres de verdad: re-ejecutarlas (como hace initDb() en
// cada arranque) no falla, no siembra nada y deja las tablas, vistas y CHECK esperados.
const leer = (n: string) => readFileSync(fileURLToPath(new URL('../users/migrations/' + n, import.meta.url)), 'utf8');
const SQL = leer('071_equipos_taller.sql');
const SQL_072 = leer('072_equipos_drive_n8n.sql');
const SQL_073 = leer('073_equipos_origen_sincronizacion.sql');

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
      // motivo: solo, y siempre, en una pasada fallida; y uno de los conocidos.
      `INSERT INTO portal.equipos_sincronizacion (pasada, motivo) VALUES ('4712', 'textos_fallidos')`,
      `INSERT INTO portal.equipos_sincronizacion (pasada, fin, ok) VALUES ('4713', now(), false)`,
      `INSERT INTO portal.equipos_sincronizacion (pasada, fin, ok, motivo) VALUES ('4714', now(), true, 'tardia')`,
      `INSERT INTO portal.equipos_sincronizacion (pasada, fin, ok, motivo) VALUES ('4715', now(), false, 'otro')`,
    ];
    for (const sql of malas) await expect(db.query(sql), sql).rejects.toMatchObject({ code: '23514' });
  });
});

describe('migración 073 contra Postgres', () => {
  const vaciar = () => db.query('TRUNCATE portal.equipos_ejecucion RESTART IDENTITY CASCADE');
  /** Los CHECK de la columna `origen` (solo de ella), con su nombre y su definición. */
  const checksDelOrigen = async (): Promise<{ conname: string; def: string }[]> =>
    (await db.query(
      `SELECT con.conname, pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con
        WHERE con.conrelid = 'portal.equipos_ejecucion'::regclass AND con.contype = 'c'
          AND con.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attname = 'origen')]::int2[]
        ORDER BY 1`,
    )).rows;
  const insertar = (origen: string) =>
    db.query(`INSERT INTO portal.equipos_ejecucion (origen, en_curso, fin, ok) VALUES ($1, NULL, now(), true)`, [origen]);
  /** Una base de antes de la 073: el CHECK de la 071, con el nombre que se le dé. */
  const comoAntes = async (nombre: string) => {
    for (const c of await checksDelOrigen()) await db.query(`ALTER TABLE portal.equipos_ejecucion DROP CONSTRAINT ${c.conname}`);
    await db.query(`ALTER TABLE portal.equipos_ejecucion ADD CONSTRAINT ${nombre} CHECK (origen IN ('programada', 'boton'))`);
  };

  it('se puede aplicar dos veces más y deja un solo CHECK del origen, con su nombre', async () => {
    await db.query(SQL_073);
    await db.query(SQL_073);
    const cs = await checksDelOrigen();
    expect(cs.map((c) => c.conname)).toEqual(['equipos_ejecucion_origen_check']);
    expect(cs[0].def).toMatch(/'programada'.*'boton'.*'sincronizacion'/);
  });

  it('admite programada, boton (filas viejas) y sincronizacion, y rechaza cualquier otro', async () => {
    await vaciar();
    for (const o of ['programada', 'boton', 'sincronizacion']) await insertar(o);
    await expect(insertar('otro')).rejects.toMatchObject({ code: '23514' });
    await vaciar();
  });

  it('sobre una base de antes de la 073 sustituye el CHECK viejo (se llame como se llame) y conserva las corridas', async () => {
    for (const nombre of ['equipos_ejecucion_origen_check', 'un_nombre_inesperado']) {
      await vaciar();
      await comoAntes(nombre);
      await insertar('boton');
      await expect(insertar('sincronizacion')).rejects.toMatchObject({ code: '23514' });
      await db.query(SQL_073);
      await insertar('sincronizacion');
      expect((await checksDelOrigen()).map((c) => c.conname), nombre).toEqual(['equipos_ejecucion_origen_check']);
      const { rows } = await db.query('SELECT origen FROM portal.equipos_ejecucion ORDER BY id');
      expect(rows.map((r: { origen: string }) => r.origen)).toEqual(['boton', 'sincronizacion']);
    }
    await vaciar();
  });
});
