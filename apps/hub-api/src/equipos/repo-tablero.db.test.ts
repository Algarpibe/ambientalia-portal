import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import { crearRepoTablero, type RepoTablero } from './repo-tablero.js';
import { AJUSTES_TABLERO_POR_DEFECTO } from './nucleo/index.js';

// Las migraciones 074 (ajustes del tablero y llaves de kiosco) y 075 (tema de la TV) contra Postgres real. Todo ficticio.
const leer = (n: string) => readFileSync(fileURLToPath(new URL('../users/migrations/' + n, import.meta.url)), 'utf8');
const SQL = leer('074_equipos_tablero.sql');
const SQL_075 = leer('075_equipos_tablero_tema_tv.sql');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const CONFIG = { ambar: 30, rojo: 90, desde: 18, hasta: 6, kpis: ['en_taller', 'revisar', 'ticket_abierto', 'externo', 'entregado'] };

let db: Pool;
let repo: RepoTablero;
const vaciar = () => db.query('TRUNCATE portal.equipos_tablero_config, portal.equipos_kiosco');
const poner = (c: Partial<typeof CONFIG> = {}) => {
  const x = { ...CONFIG, ...c };
  return db.query(
    'INSERT INTO portal.equipos_tablero_config (umbral_ambar, umbral_rojo, noche_desde, noche_hasta, kpis) VALUES ($1, $2, $3, $4, $5)',
    [x.ambar, x.rojo, x.desde, x.hasta, x.kpis],
  );
};
const kiosco = (nombre: string, hash: string) =>
  db.query(`INSERT INTO portal.equipos_kiosco (nombre, hash, creado_por) VALUES ($1, $2, 'admin@equipos.test')`, [nombre, hash]);

beforeAll(async () => {
  db = poolDePrueba();
  repo = crearRepoTablero(db);
  await db.query(SQL);
  await db.query(SQL_075);
});
afterAll(async () => {
  await vaciar();
  await db.end();
});
beforeEach(vaciar);

describe('migración 074 contra Postgres', () => {
  it('se puede aplicar dos veces más sin error y sin cambiar los datos', async () => {
    await poner();
    await kiosco('TV uno', HASH_A);
    await db.query(SQL);
    await db.query(SQL);
    expect((await db.query('SELECT count(*)::int AS n FROM portal.equipos_tablero_config')).rows[0].n).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM portal.equipos_kiosco')).rows[0].n).toBe(1);
  });

  it('no siembra ninguna fila (sin fila rigen los valores por defecto del código)', async () => {
    await db.query(SQL);
    expect((await db.query('SELECT count(*)::int AS n FROM portal.equipos_tablero_config')).rows[0].n).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM portal.equipos_kiosco')).rows[0].n).toBe(0);
  });

  it('la tabla de ajustes admite una sola fila', async () => {
    await poner();
    await expect(poner({ ambar: 31 })).rejects.toThrow(/duplicate key|unique/i);
  });

  it.each([
    ['ámbar 0', { ambar: 0 }],
    ['rojo igual al ámbar', { rojo: 30 }],
    ['hora 24', { desde: 24 }],
    ['hora negativa', { hasta: -1 }],
    ['4 KPIs', { kpis: ['en_taller', 'revisar', 'ticket_abierto', 'externo'] }],
    ['un KPI desconocido', { kpis: ['en_taller', 'revisar', 'ticket_abierto', 'externo', 'inventado'] }],
  ])('los CHECK rechazan %s', async (_n, mala) => {
    await expect(poner(mala)).rejects.toThrow(/check constraint/i);
  });

  it('el nombre de una llave ACTIVA es único; el de una revocada se puede reusar', async () => {
    await kiosco('TV taller', HASH_A);
    await expect(kiosco('tv TALLER', HASH_B)).rejects.toThrow(/duplicate key|unique/i);
    await db.query(`UPDATE portal.equipos_kiosco SET revocado_en = now() WHERE hash = $1`, [HASH_A]);
    await kiosco('TV taller', HASH_B);
  });

  it('solo guarda el resumen: ninguna columna de texto plano y el hash debe ser SHA-256 hex', async () => {
    const { rows } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'portal' AND table_name = 'equipos_kiosco' ORDER BY 1`);
    expect(rows.map((r: { column_name: string }) => r.column_name)).toEqual(['creado_en', 'creado_por', 'hash', 'id', 'nombre', 'revocado_en', 'revocado_por', 'ultimo_uso_en']);
    await expect(kiosco('TV dos', 'tvk_no-es-un-resumen')).rejects.toThrow(/check constraint/i);
  });
});

describe('migración 075 (tema de la TV) contra Postgres', () => {
  const temas = async () => (await db.query('SELECT tema_tv FROM portal.equipos_tablero_config')).rows.map((r: { tema_tv: string }) => r.tema_tv);
  const checksDelTema = async () =>
    (await db.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'portal.equipos_tablero_config'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%tema_tv%'`,
    )).rows.map((r: { conname: string }) => r.conname);
  const ponerTema = (t: string | null) => db.query('UPDATE portal.equipos_tablero_config SET tema_tv = $1', [t]);

  it('se puede aplicar dos veces más sin error, sin tocar el tema guardado y con un solo CHECK', async () => {
    await poner();
    await ponerTema('noche');
    await db.query(SQL_075);
    await db.query(SQL_075);
    expect(await temas()).toEqual(['noche']);
    expect(await checksDelTema()).toEqual(['equipos_tablero_tema_tv_check']);
  });

  it('sobre una base de antes de la 075, la fila que ya había queda en «dia»', async () => {
    await db.query('ALTER TABLE portal.equipos_tablero_config DROP COLUMN tema_tv');
    await poner();
    await db.query(SQL_075);
    expect(await temas()).toEqual(['dia']);
    expect(await checksDelTema()).toEqual(['equipos_tablero_tema_tv_check']);
  });

  it('el CHECK admite dia, noche y auto, y rechaza cualquier otro valor o ninguno', async () => {
    await poner();
    for (const t of ['dia', 'noche', 'auto']) await ponerTema(t);
    await expect(ponerTema('claro')).rejects.toMatchObject({ code: '23514' });
    await expect(ponerTema('NOCHE')).rejects.toMatchObject({ code: '23514' });
    await expect(ponerTema(null)).rejects.toMatchObject({ code: '23502' });
    expect(await temas()).toEqual(['auto']);
  });
});

describe('repo-tablero', () => {
  const NUEVOS = { umbralAmbar: 45, umbralRojo: 120, nocheDesde: 19, nocheHasta: 5, kpis: ['externo', 'en_taller', 'parciales', 'retirado', 'revisar'] as const, temaTv: 'auto' as const };

  it('sin fila, los ajustes son los de por defecto', async () => {
    expect(await repo.leerAjustesTablero()).toEqual(AJUSTES_TABLERO_POR_DEFECTO);
  });

  it('guardar y volver a guardar sustituye la única fila y conserva el orden de los KPIs', async () => {
    await repo.guardarAjustesTablero({ ...NUEVOS, kpis: [...NUEVOS.kpis] }, 'admin@equipos.test');
    expect(await repo.leerAjustesTablero()).toEqual(NUEVOS);
    await repo.guardarAjustesTablero(AJUSTES_TABLERO_POR_DEFECTO, 'admin@equipos.test');
    expect(await repo.leerAjustesTablero()).toEqual(AJUSTES_TABLERO_POR_DEFECTO);
    expect((await db.query('SELECT count(*)::int AS n FROM portal.equipos_tablero_config')).rows[0].n).toBe(1);
  });

  it('crearKiosco devuelve solo metadatos; el nombre activo repetido da null', async () => {
    const k = await repo.crearKiosco('TV taller', HASH_A, 'admin@equipos.test');
    expect(k).toMatchObject({ nombre: 'TV taller', creadoPor: 'admin@equipos.test', revocadoEn: null, ultimoUsoEn: null });
    expect(Object.keys(k!).sort()).toEqual(['creadoEn', 'creadoPor', 'id', 'nombre', 'revocadoEn', 'ultimoUsoEn']);
    expect(await repo.crearKiosco('tv Taller', HASH_B, 'admin@equipos.test')).toBeNull();
  });

  it('kioscoPorHash encuentra la activa y no la revocada; revocar es una sola vez', async () => {
    const k = (await repo.crearKiosco('TV uno', HASH_A, 'admin@equipos.test'))!;
    expect(await repo.kioscoPorHash(HASH_A)).toEqual({ id: k.id, nombre: 'TV uno', hash: HASH_A, ultimoUsoEn: null });
    expect(await repo.kioscoPorHash(HASH_B)).toBeNull();
    expect(await repo.revocarKiosco(k.id, 'admin@equipos.test')).toBe(true);
    expect(await repo.kioscoPorHash(HASH_A)).toBeNull();
    expect(await repo.revocarKiosco(k.id, 'admin@equipos.test')).toBe(false);
    expect((await repo.listarKioscos())[0]).toMatchObject({ id: k.id, revocadoEn: expect.any(String) });
  });

  it('marcarUso fija el último uso; listarKioscos no trae el hash', async () => {
    const k = (await repo.crearKiosco('TV uno', HASH_A, 'admin@equipos.test'))!;
    await repo.marcarUso(k.id);
    const [lista] = await repo.listarKioscos();
    expect(lista.ultimoUsoEn).toEqual(expect.any(String));
    expect(JSON.stringify(lista)).not.toContain(HASH_A);
  });
});
