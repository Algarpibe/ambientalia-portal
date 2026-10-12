import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Pool } from '@algarpibe/zoho-sync';
import { asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import type { Celda } from './fst022.js';
import { leerHoja } from './hoja-repo.js';

// La pestaña «Trazabilidad F-ST-022» (lote 9d-1) contra Postgres: la ruta de
// verdad sobre una congelación sembrada por SQL con la forma de la V3 (cabecera
// en la fila 5 y seis columnas), un inventario y unas calibraciones. Sólo lee:
// la base queda como estaba. Sólo la sesión es un doble. Todo ficticio.

const SECRET = 'test-secret-hoja';
process.env.JWT_SECRET = SECRET;
vi.mock('../db.js', () => ({
  getHubPool: () => ({ query: async () => ({ rows: [{ role: 'reader', status: 'active', apps: ['trazabilidad-mantenimientos'], token_version: 0 }], rowCount: 1 }), on: () => {} }),
}));
const { createTrazabilidadRouter } = await import('./router.js');

let db: Pool;
let api: express.Express;
const HOY = '2026-10-12';
const lector = { Authorization: `Bearer ${jwt.sign({ sub: 'lector@example.com', user_id: '00000000-0000-4000-8000-0000000000b2', token_version: 0 }, SECRET, { algorithm: 'HS256' })}` };
/** Desk 2.0 «caído»: la fuente de la agenda, el maestro y las calibraciones revientan si alguien los toca. */
const caido = (): never => {
  throw new Error('Desk 2.0 no contesta');
};

const CABECERA: Celda[] = ['Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Vigencia de Calibración (Dias)'];
type FilaHoja = [cliente: string, marca: string, modelo: Celda, serial: Celda, fecha: string | null, clave?: string | null];
const HOJA: FilaHoja[] = [
  ['Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', '2025-06-01', '18A00001'],
  ['Cliente Ficticio B', 'Grimm', 'EDM 180D', '18a00002', '2025-11-20', '18a00002'],
  ['Cliente Ficticio C', 'Grimm', 'EDM 180C', '18A00003', null],
  ['Cliente Ficticio D', 'HORIBA', 370, 18000000000001, '2024-03-01'],
  ['Cliente Ficticio D', 'Horiba', 'APNA-370', 'HB-0002', '2025-12-01'],
  ['Cliente Ficticio E', 'Horiba', 'APNA-370', 'HB-0003', '2025-01-10'],
  ['Cliente Ficticio F', 'Horiba', 'APNA-370', 'HB-0003', '2025-02-10'],
  ['Cliente Ficticio G', 'Thermo', '49i', 'TH-0007', null],
];

/** Una congelación vigente con la forma de la V3: título en la fila 1, cabecera en la 5 y las filas de equipo desde la 6. */
async function congelar(filas: FilaHoja[] = HOJA): Promise<void> {
  const { rows } = await db.query(
    `INSERT INTO portal.tmc_fst022_congelaciones (archivo, sha256, hoja, fila_cabecera, cabeceras, total_filas, total_columnas, filas_guardadas, filas_equipo, filas_con_serial, filas_edm180, problemas, por, en)
     VALUES ('F-ST-022 ficticia V3.xlsx', $1, 'Trazabilidad', 5, $2::jsonb, $3, 6, $4, $5, $5, 3, '{}'::jsonb, 'director@example.com', '2026-10-10T15:00:00Z') RETURNING id`,
    ['ab'.repeat(32), JSON.stringify([CABECERA]), filas.length + 5, filas.length + 2, filas.length],
  );
  const otras: [number, Celda[]][] = [[1, ['TRAZABILIDAD MANTENIMIENTOS CLIENTES']], [5, CABECERA]];
  const datos = [
    ...otras.map(([fila, celdas]) => ({ fila, celdas, es_equipo: false, serial_norm: null, clave_equipo: null })),
    ...filas.map(([cliente, marca, modelo, serial, fecha, clave], i) => ({ fila: 6 + i, celdas: [cliente, marca, modelo, serial, fecha ? { v: fecha, t: 'fecha' } : null, 357], es_equipo: true, serial_norm: String(serial).trim().toUpperCase(), clave_equipo: clave ?? null })),
  ];
  await db.query(
    `INSERT INTO portal.tmc_fst022_congelada (congelacion_id, fila, celdas, es_equipo, serial_norm, clave_equipo)
     SELECT $1, x.fila, x.celdas, x.es_equipo, x.serial_norm, x.clave_equipo FROM jsonb_to_recordset($2::jsonb) AS x(fila int, celdas jsonb, es_equipo boolean, serial_norm text, clave_equipo text)`,
    [rows[0].id, JSON.stringify(datos)],
  );
}
const enPortal = (clave: string, serial: string, cliente: string, calibracion: string | null, activo = true) =>
  db.query(`INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, ultima_calibracion, activo) VALUES ($1, $2, $3, 'GRIMM', 'EDM 180C', $4, $5)`, [clave, serial, cliente, calibracion, activo]);
const guardada = (clave: string | null, serial: string, fecha: string, origen: 'fst022' | 'desk', ticket: number | null, estado = 'vigente') =>
  db.query(
    `INSERT INTO portal.tmc_calibraciones (clave, serial, serial_norm, fecha, origen, ticket, estado, por, anulada_por, anulada_en) VALUES ($1, $2, upper($2), $3, $4, $5, $6, 'tecnico@example.com', $7, $8)`,
    [clave, serial, fecha, origen, ticket, estado, estado === 'anulada' ? 'tecnico@example.com' : null, estado === 'anulada' ? '2026-10-01T00:00:00Z' : null],
  );

/** La hoja, cuatro equipos en el inventario (uno inactivo y uno que no está en la hoja) y sus calibraciones. */
async function sembrar(): Promise<void> {
  await congelar();
  await enPortal('18A00001', '18A00001', 'Cliente Ficticio A S.A.S.', '2025-06-01');
  await enPortal('18a00002', '18A00002', 'Cliente Ficticio B', '2025-12-01', false);
  await enPortal('18A00003', '18A00003', 'Cliente Ficticio C', '2026-03-01'); // sin clave en la congelada: casa por serial; sin ninguna calibración guardada
  await enPortal('18A00099', '18A00099', 'Cliente Ficticio Z', null); // un alta del maestro posterior a la hoja
  await guardada('18A00001', '18A00001', '2025-06-01', 'fst022', null);
  await guardada('18A00001', '18A00001', '2026-09-20', 'desk', 1001);
  await guardada('18a00002', '18A00002', '2025-11-20', 'fst022', null);
  await guardada('18a00002', '18A00002', '2027-01-10', 'desk', 1003, 'en_revision');
  await guardada(null, 'hb-0002', '2026-06-30', 'desk', 1005); // otra marca: sin equipo del inventario
  await guardada(null, 'HB-0002', '2026-08-01', 'desk', 1006, 'anulada');
  await guardada(null, 'HB-0003', '2026-07-07', 'desk', 1007); // serial repetido en la hoja: no es de ninguna fila
  await guardada(null, 'NO-ESTA', '2026-07-07', 'desk', 1008); // su serial no está en la hoja
}

const pedir = (ruta = `/api/trazabilidad/hoja?hoy=${HOY}`) => request(api).get(ruta).set(lector);
const foto = async () =>
  (
    await db.query(`SELECT (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY fila), '')) FROM portal.tmc_fst022_congelada t) AS hoja, (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY id), '')) FROM portal.tmc_fst022_congelaciones t) AS congelaciones,
                     (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY clave), '')) FROM portal.tmc_equipos t) AS equipos, (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY id), '')) FROM portal.tmc_calibraciones t) AS calibraciones`)
  ).rows[0];

beforeAll(async () => {
  db = poolDePrueba();
  await asegurarDeskTickets(db);
  api = express();
  api.use(express.json());
  api.use('/api', createTrazabilidadRouter(db, { ticketsAbiertos: caido, estadoFuente: caido } as never, caido, caido));
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query('TRUNCATE portal.tmc_fst022_congelada, portal.tmc_fst022_congelaciones, portal.tmc_equipos, portal.tmc_calibraciones, portal.tmc_calibraciones_pasadas, portal.tmc_seguimiento, portal.tmc_contactos, desk.tickets RESTART IDENTITY');
});

describe('GET /trazabilidad/hoja', () => {
  it('un Lector recibe la hoja entera en su orden, con los valores de hoy, de dónde sale cada fecha, la situación, los avisos y el resumen', async () => {
    await sembrar();
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(res.body.hoy).toBe(HOY);
    expect(res.body.motivo).toBeNull();
    expect(res.body.congelacion).toMatchObject({ archivo: 'F-ST-022 ficticia V3.xlsx', hoja: 'Trazabilidad', por: 'director@example.com' });
    expect(res.body.congelacion.en).toMatch(/^2026-10-10 15:00:00/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filas = res.body.filas as any[];
    expect(filas.map((f) => [f.fila, f.situacion, f.cliente, f.marca, f.modelo, f.serial, f.ultimaCalibracion, f.estado, f.vigenciaDias])).toEqual([
      [6, 'inventario', 'Cliente Ficticio A S.A.S.', 'GRIMM', 'EDM 180C', '18A00001', '2026-09-20', 'AL_DIA', 343],
      [7, 'inactivo', 'Cliente Ficticio B', 'GRIMM', 'EDM 180C', '18A00002', '2025-11-20', 'VENCE_60', 39],
      [8, 'inventario', 'Cliente Ficticio C', 'GRIMM', 'EDM 180C', '18A00003', '2026-03-01', 'AL_DIA', 140],
      [9, 'hoja', 'Cliente Ficticio D', 'HORIBA', '370', '18000000000001', '2024-03-01', 'FUERA_CICLO', -590],
      [10, 'hoja', 'Cliente Ficticio D', 'Horiba', 'APNA-370', 'HB-0002', '2026-06-30', 'AL_DIA', 261],
      [11, 'hoja', 'Cliente Ficticio E', 'Horiba', 'APNA-370', 'HB-0003', '2025-01-10', 'VENCIDA', -275],
      [12, 'hoja', 'Cliente Ficticio F', 'Horiba', 'APNA-370', 'HB-0003', '2025-02-10', 'VENCIDA', -244],
      [13, 'hoja', 'Cliente Ficticio G', 'Thermo', '49i', 'TH-0007', null, 'SIN_FECHA', null],
    ]);
    expect(filas.map((f) => f.enHoja)).toEqual([
      { cliente: 'Cliente Ficticio A', marca: 'Grimm', ultimaCalibracion: '2025-06-01' },
      { marca: 'Grimm', modelo: 'EDM 180D', serial: '18a00002' },
      { marca: 'Grimm', ultimaCalibracion: null },
      {},
      { ultimaCalibracion: '2025-12-01' },
      {},
      {},
      {},
    ]);
    expect(filas.map((f) => f.avisos)).toEqual([[], ['en_revision'], [], ['serial_numerico', 'marca_distinta'], [], ['serial_repetido', 'calibraciones_sin_atribuir'], ['serial_repetido', 'calibraciones_sin_atribuir'], ['sin_fecha']]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(filas.map((f) => f.calibraciones.find((c: any) => c.cuenta)).map((c) => (c ? [c.origen, c.ticket] : null))).toEqual([['desk', 1001], ['fst022', null], null, ['fst022', null], ['desk', 1005], ['fst022', null], ['fst022', null], null]);
    expect(res.body.fueraDeHoja).toMatchObject([{ fila: null, clave: '18A00099', situacion: 'inventario', cliente: 'Cliente Ficticio Z', estado: 'SIN_FECHA' }]);
    expect(res.body.resumen).toEqual({
      total: 8, enInventario: 3, inactivos: 1, soloHoja: 5, conAvisos: 5, fueraDeHoja: 1, calibracionesSueltas: 2,
      porMarca: [{ clave: 'horiba', marca: 'Horiba', total: 4 }, { clave: 'grimm', marca: 'GRIMM', total: 3 }, { clave: 'thermo', marca: 'Thermo', total: 1 }],
      porEstado: { FUERA_CICLO: 1, VENCIDA: 2, VENCE_30: 0, VENCE_60: 1, VENCE_90: 0, AL_DIA: 3, SIN_FECHA: 1 },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/357/); // la «Vigencia» congelada no sale
  });

  it('la fecha de cada equipo activo del inventario es la misma que da GET /equipos (y su vencimiento y su estado)', async () => {
    await sembrar();
    const [hoja, equipos] = await Promise.all([pedir(), pedir(`/api/trazabilidad/equipos?hoy=${HOY}`)]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deHoja = new Map<string, any>([...hoja.body.filas, ...hoja.body.fueraDeHoja].filter((f) => f.clave).map((f) => [f.clave, f]));
    expect(equipos.body.equipos).toHaveLength(3);
    for (const e of equipos.body.equipos) {
      const f = deHoja.get(e.clave);
      expect([e.clave, f.ultimaCalibracion, f.vence, f.vigenciaDias, f.estado]).toEqual([e.clave, e.ultimaCalibracion, e.vence, e.vigenciaDias, e.estado]);
      expect([f.cliente, f.marca, f.modelo, f.serial]).toEqual([e.cliente, e.marca, e.modelo, e.serial]);
    }
  });

  it('sin congelación vigente: 200 con la tabla vacía y un motivo claro', async () => {
    await enPortal('18A00001', '18A00001', 'Cliente Ficticio A', '2025-06-01');
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hoy: HOY, congelacion: null, filas: [], resumen: { total: 0, enInventario: 0, soloHoja: 0, fueraDeHoja: 1 } });
    expect(res.body.motivo).toMatch(/^En este entorno no hay ninguna F-ST-022 congelada/);
  });

  it('sólo lee: la base queda exactamente como estaba, y funciona con Desk 2.0 caído (no toca la fuente, el maestro ni las calibraciones de Desk)', async () => {
    await sembrar();
    const antes = await foto();
    expect((await pedir()).status).toBe(200);
    expect((await pedir('/api/trazabilidad/hoja')).status).toBe(200);
    expect(await foto()).toEqual(antes);
  });

  it('el número de consultas no depende del número de filas: cuatro con 8 filas y cuatro con 68', async () => {
    const contar = async (): Promise<number> => {
      let n = 0;
      const espia = { query: (sql: string, params?: unknown[]) => (n++, db.query(sql, params)) };
      const hoja = await leerHoja(espia as never, HOY);
      expect(hoja.filas.length).toBeGreaterThan(0);
      return n;
    };
    await sembrar();
    expect(await contar()).toBe(4);
    await db.query('TRUNCATE portal.tmc_fst022_congelada, portal.tmc_fst022_congelaciones RESTART IDENTITY');
    await congelar([...HOJA, ...Array.from({ length: 60 }, (_, i): FilaHoja => ['Cliente Ficticio H', 'Kunak', 'AIR Pro', `KN-${String(i).padStart(4, '0')}`, '2026-01-15'])]);
    for (let i = 0; i < 60; i++) await guardada(null, `KN-${String(i).padStart(4, '0')}`, '2026-05-05', 'desk', 2000 + i);
    expect(await contar()).toBe(4);
    expect((await pedir()).body.resumen).toMatchObject({ total: 68, soloHoja: 65 });
  });

  it('400 con un «hoy» que no es una fecha, sin un cliente ni un serial en el mensaje', async () => {
    await sembrar();
    const res = await pedir('/api/trazabilidad/hoja?hoy=ayer');
    expect([res.status, res.body.field]).toEqual([400, 'hoy']);
    expect(JSON.stringify(res.body)).not.toMatch(/Ficticio|18A0|HB-/);
  });
});
