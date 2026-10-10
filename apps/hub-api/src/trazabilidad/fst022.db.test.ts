import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import type { Celda } from './fst022.js';

// La congelación de la F-ST-022 contra Postgres, ya SÓLO en lectura: la subida
// de la Excel se retiró el 10/10/2026 y nada del módulo escribe en sus tablas.
// La congelación se siembra aquí por SQL, con la forma de la que quedó firmada
// (una hoja «Trazabilidad», título en las filas 1 a 3, cabecera en la fila 5 y
// seis columnas). Clientes y seriales inventados (el repo es público). Las
// rutas son las de verdad sobre la base de pruebas; sólo la sesión es un doble.

const SECRET = 'test-secret-fst022';
process.env.JWT_SECRET = SECRET;
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async (_sql: string, params: unknown[] = []) => ({
      rows: [{ role: params[0] === '00000000-0000-4000-8000-0000000000a1' ? 'admin' : 'reader', status: 'active', apps: ['trazabilidad-mantenimientos'], token_version: 0 }],
      rowCount: 1,
    }),
    on: () => {},
  }),
}));
const { createTrazabilidadRouter } = await import('./router.js');
const repo = await import('./repo.js');

let db: Pool;
let api: express.Express;
const SQL_055 = readFileSync(fileURLToPath(new URL('../users/migrations/055_trazabilidad_fst022_congelacion.sql', import.meta.url)), 'utf8');
const cabecera = (userId: string, correo: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: correo, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' })}` });
const admin = cabecera(ADMIN, 'admin@example.com');
const lector = cabecera('00000000-0000-4000-8000-0000000000b2', 'lector@example.com');

const fecha = (v: string): Celda => ({ v, t: 'fecha' });
const CABECERA: Celda[][] = [['Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Vigencia de Calibración (Dias)']];
/** Las filas que traen algo, por su número de fila de Excel. */
const FILAS: [number, Celda[], boolean, string | null, string | null][] = [
  [1, ['TRAZABILIDAD MANTENIMIENTOS CLIENTES'], false, null, null],
  [5, CABECERA[0], false, null, null],
  [6, ['Cliente Ficticio A', 'Grimm', 'EDM 180C', '18a00001', fecha('2025-10-17'), 357], true, '18A00001', '18a00001'],
  [7, ['Cliente Ficticio B', 'HORIBA', 'APNA-370', 18000000000001, fecha('2024-03-01'), { v: '#VALUE!', t: 'error' }], true, '18000000000001', null],
  [8, ['Cliente Ficticio C', 'Thermo', '49i', 'TH-0007', null, null], true, 'TH-0007', null],
];
const PROBLEMAS = { sin_serial: 0, sin_cliente: 0, serial_repetido: 0, serial_cientifico: 1, error_excel: 1, texto_en_fecha: 0, fecha_imposible: 0 };

/** Siembra una congelación como la dejó la subida (retirada): su fila de cabecera y sus filas. Devuelve su id. */
async function sembrar(vigente = true, archivo = 'F-ST-022 ficticia V3.xlsx'): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO portal.tmc_fst022_congelaciones
       (archivo, sha256, hoja, fila_cabecera, cabeceras, total_filas, total_columnas, filas_guardadas, filas_equipo, filas_con_serial, filas_edm180, problemas,
        vigente, por_id, por, en, reemplazada_por, reemplazada_en, reemplazada_motivo)
     VALUES ($1, $2, 'Trazabilidad', 5, $3::jsonb, 8, 6, 5, 3, 3, 1, $4::jsonb, $5, $6, 'director@example.com', '2026-10-10T15:00:00Z',
             $7, $8, $9)
     RETURNING id`,
    [archivo, 'ab'.repeat(32), JSON.stringify(CABECERA), JSON.stringify(PROBLEMAS), vigente, ADMIN, vigente ? null : 'admin@example.com', vigente ? null : '2026-10-10T16:00:00Z', vigente ? null : 'Hoja limpia'],
  );
  const id = Number(rows[0].id);
  for (const [fila, celdas, esEquipo, serial, clave] of FILAS) {
    await db.query(`INSERT INTO portal.tmc_fst022_congelada (congelacion_id, fila, celdas, es_equipo, serial_norm, clave_equipo) VALUES ($1, $2, $3::jsonb, $4, $5, $6)`, [id, fila, JSON.stringify(celdas), esEquipo, serial, clave]);
  }
  return id;
}
const cuenta = async (tabla: string) => Number((await db.query(`SELECT count(*)::int AS n FROM portal.${tabla}`)).rows[0].n);
const huella = async () => (await db.query(`SELECT md5(coalesce(string_agg(congelacion_id || ':' || fila || celdas::text || es_equipo || coalesce(serial_norm, '') || coalesce(clave_equipo, ''), '|' ORDER BY congelacion_id, fila), '')) AS h FROM portal.tmc_fst022_congelada`)).rows[0].h as string;

beforeAll(() => {
  db = poolDePrueba();
  api = express();
  api.use(express.json());
  api.use('/api', createTrazabilidadRouter(db));
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query('TRUNCATE portal.tmc_fst022_congelada, portal.tmc_fst022_congelaciones, portal.tmc_equipos, portal.tmc_importaciones RESTART IDENTITY');
});

describe('migración 055', () => {
  it('no siembra nada, y ejecutarla dos veces más no falla ni toca lo congelado', async () => {
    expect(await cuenta('tmc_fst022_congelaciones')).toBe(0);
    await sembrar();
    const antes = [await repo.listarCongelaciones(db), await huella()];
    await db.query(SQL_055);
    await db.query(SQL_055);
    expect([await repo.listarCongelaciones(db), await huella()]).toEqual(antes);
  });

  it('la tabla no admite dos vigentes, ni una reemplazada sin firma, ni una fila sin su congelación', async () => {
    await sembrar();
    await expect(sembrar()).rejects.toThrow(/tmc_fst022_congelaciones_vigente_uq/);
    await expect(db.query(`UPDATE portal.tmc_fst022_congelaciones SET vigente = FALSE`)).rejects.toThrow(/tmc_fst022_vigente_o_reemplazada/);
    await expect(db.query(`INSERT INTO portal.tmc_fst022_congelada (congelacion_id, fila, celdas, es_equipo) VALUES (999, 1, '[]', false)`)).rejects.toThrow(/foreign key/i);
  });
});

describe('leer la congelación', () => {
  it('sin ninguna (entorno nuevo), la vigente es null y la lista está vacía', async () => {
    expect(await repo.listarCongelaciones(db)).toEqual([]);
    expect(await repo.congelacionVigente(db, { desde: 0, limite: 500 })).toEqual({ congelacion: null, cabeceras: [], filas: [], siguiente: null });
  });

  it('la lista trae la vigente y las anteriores, la más reciente primero, con recuentos y firmas y sin filas', async () => {
    await sembrar(false, 'F-ST-022 ficticia V2.xlsx');
    await sembrar();
    const lista = await repo.listarCongelaciones(db);
    expect(lista.map((c) => [c.id, c.vigente, c.archivo, c.reemplazadaPor])).toEqual([[2, true, 'F-ST-022 ficticia V3.xlsx', null], [1, false, 'F-ST-022 ficticia V2.xlsx', 'admin@example.com']]);
    expect(lista[0]).toMatchObject({ sha256: 'ab'.repeat(32), hoja: 'Trazabilidad', por: 'director@example.com', motivo: null, totalFilas: 8, totalColumnas: 6, filasGuardadas: 5, filaCabecera: 5, filasEquipo: 3, filasConSerial: 3, filasEdm180: 1, filasOtras: 2, problemas: PROBLEMAS });
    expect(lista[0].en).toMatch(/^2026-10-10 15:00:00/);
    expect(lista[1].reemplazadaEn).toMatch(/^2026-10-10 16:00:00/);
    expect(JSON.stringify(lista)).not.toMatch(/Ficticio A|18A0/);
  });

  it('la vigente trae sus metadatos, su cabecera y sus filas por páginas, en el orden de la hoja y tal cual', async () => {
    await sembrar(false, 'F-ST-022 ficticia V2.xlsx');
    await sembrar();
    const p1 = await repo.congelacionVigente(db, { desde: 0, limite: 3 });
    expect(p1.congelacion).toMatchObject({ id: 2, vigente: true });
    expect(p1.cabeceras).toEqual(CABECERA);
    expect(p1.filas.map((f) => f.fila)).toEqual([1, 5, 6]);
    expect(p1.filas[2]).toEqual({ fila: 6, celdas: FILAS[2][1], esEquipo: true, serialNorm: '18A00001', claveEquipo: '18a00001' });
    expect(p1.siguiente).toBe(6);
    const p2 = await repo.congelacionVigente(db, { desde: p1.siguiente!, limite: 3 });
    expect(p2.filas.map((f) => [f.fila, f.celdas[3]])).toEqual([[7, 18000000000001], [8, 'TH-0007']]);
    expect(p2.siguiente).toBeNull();
  });

  it('por la API: la lista y la vigente, también para un Lector', async () => {
    await sembrar();
    const lista = await request(api).get('/api/trazabilidad/fst022/congelaciones').set(lector);
    expect([lista.status, lista.body.congelaciones.length, lista.body.congelaciones[0].filasEdm180]).toEqual([200, 1, 1]);
    const vigente = await request(api).get('/api/trazabilidad/fst022/congelaciones/vigente?limite=2').set(lector);
    expect([vigente.status, vigente.body.filas.length, vigente.body.siguiente]).toEqual([200, 2, 5]);
  });
});

describe('subir la Excel ya no se puede: nada escribe', () => {
  const CUERPO = { archivo: 'otra.xlsx', sha256: 'cd'.repeat(32), hoja: 'Trazabilidad', motivo: 'Quiero otra', filas: [{ serial: 'S-1', cliente: 'Cliente Ficticio Z', marca: 'Grimm', modelo: 'EDM 180C' }], matriz: [['Cliente', 'Marca', 'Modelo', 'Serial'], ['Cliente Ficticio Z', 'Grimm', 'EDM 180C', 'S-1']] };

  it.each([['con una congelación vigente', true], ['sin ninguna congelación', false]])('%s, las dos rutas contestan 410 a un administrador y a un Lector y la base queda como estaba', async (_caso, conVigente) => {
    if (conVigente) await sembrar();
    const antes = [await repo.listarCongelaciones(db), await huella()];
    for (const ruta of ['/importaciones', '/importaciones?simular=1', '/fst022/congelaciones', '/fst022/congelaciones?simular=1']) {
      for (const quien of [admin, lector]) {
        const res = await request(api).post(`/api/trazabilidad${ruta}`).set(quien).send(CUERPO);
        expect([res.status, res.body.error]).toEqual([410, 'subida_retirada']);
      }
    }
    expect([await repo.listarCongelaciones(db), await huella()]).toEqual(antes);
    expect(await cuenta('tmc_importaciones')).toBe(0);
    expect(await cuenta('tmc_equipos')).toBe(0);
  });
});
