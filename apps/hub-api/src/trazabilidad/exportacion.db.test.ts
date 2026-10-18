import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import type { Pool } from '@algarpibe/zoho-sync';
import { hoyEnColombia } from '../ausencias/saldo.js';
import { asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import type { Celda } from './fst022.js';

// Exportar la F-ST-022 (lote 9e, migración 060) contra Postgres, de punta a
// punta y con las rutas de verdad (sólo la sesión es un doble): una congelación
// ficticia con la forma de la V3, un inventario en seguimiento, otras marcas
// enlazadas fuera de seguimiento, calibraciones de tickets y manuales (las
// manuales, registradas por su ruta) y retirados a mano (retirados por la suya).
// Lo exportado tiene que ser lo de la pestaña (GET /hoja) y cada exportación
// tiene que quedar apuntada. El .xlsx se genera y se lee en memoria. Todo ficticio.

const SECRET = 'test-secret-exportar';
process.env.JWT_SECRET = SECRET;
const ADMIN = '00000000-0000-4000-8000-0000000000e1';
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async (_sql: string, params: unknown[] = []) => ({ rows: [{ role: params[0] === '00000000-0000-4000-8000-0000000000e1' ? 'admin' : 'reader', status: 'active', apps: ['trazabilidad-mantenimientos'], token_version: 0 }], rowCount: 1 }),
    on: () => {},
  }),
}));
const { createTrazabilidadRouter } = await import('./router.js');

let db: Pool;
let api: express.Express;
const HOY = hoyEnColombia();
const dia = (delta: number): string => new Date(Date.parse(`${HOY}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
const SQL_060 = readFileSync(fileURLToPath(new URL('../users/migrations/060_trazabilidad_exportaciones.sql', import.meta.url)), 'utf8');
const NOMBRE = `F-ST-022 Trazabilidad Mttos Clientes ${HOY}.xlsx`;

/** Quien tiene la app y un rol guardado en portal.tmc_user_roles (el Lector no tiene fila). */
const PERSONAS = { comercial: ['00000000-0000-4000-8000-0000000000e2', 'COMERCIAL'], tecnico: ['00000000-0000-4000-8000-0000000000e3', 'TECNICO'], director: ['00000000-0000-4000-8000-0000000000e4', 'DIRECTOR_TECNICO'] } as const;
const cabecera = (userId: string, correo: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: correo, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' })}` });
const comoAdmin = cabecera(ADMIN, 'admin.exportar@example.com');
const comoLector = cabecera('00000000-0000-4000-8000-0000000000e9', 'lector.exportar@example.com');
const como = (quien: keyof typeof PERSONAS) => cabecera(PERSONAS[quien][0], `${quien}.exportar@example.com`);
/** Desk 2.0 «caído»: exportar no lo toca. */
const caido = (): never => {
  throw new Error('Desk 2.0 no contesta');
};

const CABECERA: Celda[] = ['Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Vigencia de Calibración (Dias)'];
type FilaV3 = [cliente: string, marca: string, modelo: Celda, serial: Celda, fecha: string | null, clave?: string | null];
/** Una congelación vigente con la forma de la V3: título en la fila 1, cabecera en la 5 y los equipos desde la 6. */
async function congelar(filas: FilaV3[]): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO portal.tmc_fst022_congelaciones (archivo, sha256, hoja, fila_cabecera, cabeceras, total_filas, total_columnas, filas_guardadas, filas_equipo, filas_con_serial, filas_edm180, problemas, por, en)
     VALUES ('F-ST-022 ficticia V3.xlsx', $1, 'Trazabilidad', 5, $2::jsonb, $3, 6, $4, $5, $5, 2, '{}'::jsonb, 'director@example.com', '2026-10-10T15:00:00Z') RETURNING id`,
    ['ab'.repeat(32), JSON.stringify([CABECERA]), filas.length + 5, filas.length + 2, filas.length],
  );
  const datos = [
    { fila: 1, celdas: ['TRAZABILIDAD MANTENIMIENTOS CLIENTES'], es_equipo: false, serial_norm: null, clave_equipo: null },
    { fila: 5, celdas: CABECERA, es_equipo: false, serial_norm: null, clave_equipo: null },
    ...filas.map(([cliente, marca, modelo, serial, fecha, clave], i) => ({ fila: 6 + i, celdas: [cliente, marca, modelo, serial, fecha ? { v: fecha, t: 'fecha' } : null, 357], es_equipo: true, serial_norm: String(serial).trim().toUpperCase(), clave_equipo: clave ?? null })),
  ];
  await db.query(
    `INSERT INTO portal.tmc_fst022_congelada (congelacion_id, fila, celdas, es_equipo, serial_norm, clave_equipo)
     SELECT $1, x.fila, x.celdas, x.es_equipo, x.serial_norm, x.clave_equipo FROM jsonb_to_recordset($2::jsonb) AS x(fila int, celdas jsonb, es_equipo boolean, serial_norm text, clave_equipo text)`,
    [rows[0].id, JSON.stringify(datos)],
  );
  return Number(rows[0].id);
}
const enPortal = (clave: string, cliente: string, calibracion: string | null, extra: { marca?: string; modelo?: string; enSeguimiento?: boolean } = {}) =>
  db.query(`INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, ultima_calibracion, activo, en_seguimiento) VALUES ($1, $1, $2, $3, $4, $5, TRUE, $6)`, [clave, cliente, extra.marca ?? 'GRIMM', extra.modelo ?? 'EDM 180C', calibracion, extra.enSeguimiento ?? true]);
const guardada = (clave: string | null, serial: string, fecha: string, origen: 'fst022' | 'desk', ticket: number | null) =>
  db.query(`INSERT INTO portal.tmc_calibraciones (clave, serial, serial_norm, fecha, origen, ticket, estado, por) VALUES ($1, $2, upper($2), $3, $4, $5, 'vigente', 'tecnico@example.com')`, [clave, serial, fecha, origen, ticket]);

/**
 * La hoja (filas 6 a 12): dos GRIMM EDM 180 en seguimiento, un Horiba de serial numérico largo sólo en la hoja, un Horiba enlazado con
 * Desk 2.0 fuera de seguimiento, un Thermo sin fecha y un serial dos veces. Y, fuera de la hoja, un GRIMM en seguimiento y un Kunak enlazado.
 */
async function sembrar(): Promise<number> {
  const id = await congelar([
    ['Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', dia(-200), '18A00001'],
    ['Cliente Ficticio B', 'Grimm', 'EDM 180D', '18A00002', dia(-400), '18A00002'],
    ['Cliente Ficticio D & «Hijos»', 'HORIBA', 370, 18000000000001, dia(-590)],
    ['Cliente Ficticio H', 'Horiba', 'APNA 370', 'HB-0001', dia(-100)],
    ['=Cliente Ficticio E', 'Thermo', '49i', 'TH-0001', null],
    ['Cliente Ficticio F', 'Environics', '6100', 'EV-0001', dia(-50)],
    ['Cliente Ficticio F', 'Environics', '6100', 'ev-0001', dia(-60)],
  ]);
  await enPortal('18A00001', 'Cliente Ficticio A S.A.S.', dia(-200));
  await enPortal('18A00002', 'Cliente Ficticio B S.A.S.', dia(-400));
  await enPortal('HB-0001', 'Cliente Ficticio H S.A.S.', null, { marca: 'Horiba', modelo: 'APNA-370', enSeguimiento: false });
  await enPortal('18A00099', 'Cliente Ficticio Z', dia(-20));
  await enPortal('KN-0001', 'Cliente Ficticio K', null, { marca: 'Kunak', modelo: 'AIR Pro', enSeguimiento: false });
  await guardada('18A00001', '18A00001', dia(-200), 'fst022', null);
  await guardada('18A00001', '18A00001', dia(-30), 'desk', 1001);
  await guardada(null, 'HB-0001', dia(-45), 'desk', 1002); // otra marca: guardada por serial, sin clave
  return id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;
const hoja = async () => (await request(api).get(`/api/trazabilidad/hoja?hoy=${HOY}`).set(comoLector)).body as { filas: Fila[]; fueraDeHoja: Fila[]; resumen: Fila; congelacion: Fila | null };
/** La descarga, con el cuerpo en bruto. */
const exportar = (quien: { Authorization: string }) =>
  request(api)
    .get(`/api/trazabilidad/exportar?hoy=${HOY}`)
    .set(quien)
    .buffer(true)
    .parse((res, cb) => {
      const trozos: Buffer[] = [];
      res.on('data', (d: Buffer) => trozos.push(d));
      res.on('end', () => cb(null, Buffer.concat(trozos)));
    });
const ultima = async () => (await request(api).get('/api/trazabilidad/exportaciones').set(comoLector)).body as { ultima: Fila | null; total: number };
const apuntes = async () => (await db.query(`SELECT congelacion_id::int AS congelacion_id, hoy::text AS hoy, filas, retirados, archivo, sha256, por_id::text AS por_id, por FROM portal.tmc_exportaciones ORDER BY id`)).rows as Fila[];
const md5 = async (tabla: string, orden: string) => (await db.query(`SELECT md5(coalesce(string_agg(t::text, ';' ORDER BY ${orden}), '')) AS h FROM portal.${tabla} t`)).rows[0].h as string;
const foto = async () => [await md5('tmc_fst022_congelada', 'fila'), await md5('tmc_fst022_congelaciones', 'id'), await md5('tmc_equipos', 'clave'), await md5('tmc_calibraciones', 'id'), await md5('tmc_retiros', 'id'), await md5('tmc_seguimiento', 'clave')];

/** El libro descargado: la hoja principal (con sus celdas) y las demás como matrices. */
function abrir(cuerpo: Buffer) {
  const wb = XLSX.read(cuerpo, { type: 'buffer', cellNF: true });
  const matriz = (h: string) => XLSX.utils.sheet_to_json(wb.Sheets[h], { header: 1, raw: true, defval: null }) as unknown[][];
  const celda = (ref: string): XLSX.CellObject | undefined => wb.Sheets.Trazabilidad[ref];
  return { wb, matriz, celda, fecha: (ref: string): string | null => (celda(ref) ? XLSX.SSF.format('yyyy-mm-dd', celda(ref)!.v as number) : null) };
}
/** Lo exportado = lo de la pestaña: las filas vivas de GET /hoja, en su orden, con sus seis valores, sus tipos y su fórmula. */
function compararConLaPestana(cuerpo: Buffer, t: { filas: Fila[]; fueraDeHoja: Fila[] }): Fila[] {
  const vivas = [...t.filas, ...t.fueraDeHoja].filter((f) => f.retirado === null);
  const { matriz, celda, fecha } = abrir(cuerpo);
  const m = matriz('Trazabilidad');
  expect(m[4]).toEqual(CABECERA);
  expect(m).toHaveLength(5 + vivas.length);
  for (const [i, f] of vivas.entries()) {
    const n = 6 + i;
    expect(m[n - 1].slice(0, 4), `fila ${n}`).toEqual([f.cliente, f.marca, f.modelo, f.serial]);
    for (const col of ['A', 'B', 'C', 'D']) expect([celda(`${col}${n}`)!.t, celda(`${col}${n}`)!.f]).toEqual(['s', undefined]);
    expect(fecha(`E${n}`), `fecha de la fila ${n}`).toBe(f.ultimaCalibracion);
    if (f.ultimaCalibracion) expect([celda(`E${n}`)!.t, celda(`E${n}`)!.z]).toEqual(['n', 'dd/mm/yyyy']);
    expect(celda(`F${n}`)?.v ?? null, `vigencia de la fila ${n}`).toBe(f.vigenciaDias);
    // La fórmula lleva la vigencia de su marca (lote 11): 365 en GRIMM; sin vencimiento, ninguna.
    expect(celda(`F${n}`)?.f).toBe(f.vigenciaDias === null ? undefined : `E${n}-TODAY()+${f.vigenciaMarca}`);
  }
  return vivas;
}

beforeAll(async () => {
  db = poolDePrueba();
  await asegurarDeskTickets(db);
  api = express();
  api.use(express.json());
  api.use('/api', createTrazabilidadRouter(db, { ticketsAbiertos: caido, estadoFuente: caido } as never, caido, caido));
  for (const [quien, [id, rol]] of Object.entries(PERSONAS)) {
    await db.query(`INSERT INTO portal.users (id, full_name, email, password_hash, role, status) VALUES ($1, $2, $3, 'x', 'reader', 'active') ON CONFLICT (id) DO NOTHING`, [id, `Persona Ficticia ${quien}`, `${quien}.exportar@example.com`]);
    await db.query(`INSERT INTO portal.tmc_user_roles (user_id, role, actualizado_por) VALUES ($1, $2, 'admin.exportar@example.com') ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`, [id, rol]);
  }
});
afterAll(async () => {
  await db?.query(`DELETE FROM portal.users WHERE id = ANY($1::uuid[])`, [Object.values(PERSONAS).map(([id]) => id)]);
  await db?.query(`TRUNCATE portal.tmc_exportaciones, portal.tmc_retiros, portal.tmc_calibraciones, portal.tmc_fst022_congelaciones RESTART IDENTITY CASCADE`);
  await db?.end();
});
beforeEach(async () => {
  await db.query(`TRUNCATE desk.tickets, portal.tmc_exportaciones, portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_contactos, portal.tmc_retiros, portal.tmc_calibraciones, portal.tmc_calibraciones_pasadas, portal.tmc_fst022_congelaciones RESTART IDENTITY CASCADE`);
});

describe('migración 060', () => {
  it('se puede ejecutar varias veces: no pierde ni cambia un apunte ya hecho', async () => {
    await sembrar();
    expect((await exportar(comoAdmin)).status).toBe(200);
    const antes = await md5('tmc_exportaciones', 'id');
    await db.query(SQL_060);
    await db.query(SQL_060);
    expect(await md5('tmc_exportaciones', 'id')).toBe(antes);
    expect(await apuntes()).toHaveLength(1);
  });
});

describe('GET /trazabilidad/exportar, de punta a punta', () => {
  it('lo exportado es lo de la pestaña: las filas de la hoja en su orden y después lo que no está en ella, con sus seis columnas, sus tipos y su fórmula', async () => {
    await sembrar();
    const res = await exportar(como('comercial'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${NOMBRE}"`);
    const vivas = compararConLaPestana(res.body, await hoja());
    expect(vivas.map((f) => [f.fila, f.situacion, f.serial])).toEqual([
      [6, 'inventario', '18A00001'],
      [7, 'inventario', '18A00002'],
      [8, 'hoja', '18000000000001'],
      [9, 'enlazado', 'HB-0001'],
      [10, 'hoja', 'TH-0001'],
      [11, 'hoja', 'EV-0001'],
      [12, 'hoja', 'ev-0001'],
      [null, 'enlazado', 'KN-0001'],
      [null, 'inventario', '18A00099'],
    ]);
    const { celda, fecha, matriz } = abrir(res.body);
    // Los valores de HOY: el cliente del maestro (no el de la hoja), la fecha del ticket (no la de la hoja) y el serial de cifras, entero y como texto.
    expect([celda('A6')!.v, fecha('E6'), celda('F6')!.v]).toEqual(['Cliente Ficticio A S.A.S.', dia(-30), 335]);
    expect([celda('D8')!.t, celda('D8')!.v, celda('C8')!.v]).toEqual(['s', '18000000000001', '370']);
    expect([celda('A9')!.v, celda('B9')!.v, fecha('E9')]).toEqual(['Cliente Ficticio H S.A.S.', 'Horiba', dia(-45)]);
    expect([celda('A8')!.v, celda('A10')!.v, celda('A10')!.t]).toEqual(['Cliente Ficticio D & «Hijos»', '=Cliente Ficticio E', 's']);
    expect([celda('E10'), celda('F10')]).toEqual([undefined, undefined]);
    expect(matriz('Retirados')).toHaveLength(1);
    expect(matriz('Detalle').slice(1).map((r) => r[3])).toEqual(['Ticket de Desk 2.0 n.º 1001', 'Inventario del portal', 'Hoja F-ST-022', 'Ticket de Desk 2.0 n.º 1002', 'Sin fecha', 'Hoja F-ST-022', 'Hoja F-ST-022', 'Sin fecha', 'Inventario del portal']);
  });

  it('tras corregir una fecha a mano y retirar un equipo y una fila, la exportación siguiente lo refleja: la fecha manual, y lo retirado fuera de la principal y dentro de «Retirados»', async () => {
    await sembrar();
    const antes = abrir((await exportar(como('director'))).body);
    expect(antes.matriz('Trazabilidad')).toHaveLength(5 + 9);
    const corregir = (cuerpo: object) => request(api).post('/api/trazabilidad/calibraciones/manual').set(comoAdmin).send(cuerpo);
    expect((await corregir({ clave: '18A00002', fecha: dia(-5), motivo: 'Certificado ficticio.' })).status).toBe(200);
    expect((await corregir({ fila: 10, fecha: dia(-15), motivo: 'Certificado ficticio.' })).status).toBe(200);
    const retirar = (ruta: string, motivo: string) => request(api).post(`/api/trazabilidad/${ruta}/retirar`).set(comoAdmin).send({ motivo });
    expect((await retirar('equipos/18A00099', 'Equipo de prueba.')).status).toBe(200);
    expect((await retirar('filas/12', '=Fila duplicada.')).status).toBe(200);

    const res = await exportar(como('tecnico'));
    const vivas = compararConLaPestana(res.body, await hoja());
    expect(vivas.map((f) => f.serial)).toEqual(['18A00001', '18A00002', '18000000000001', 'HB-0001', 'TH-0001', 'EV-0001', 'KN-0001']);
    const { fecha, celda, matriz } = abrir(res.body);
    // La fila 10 es de Thermo: sin vencimiento desde el lote 11, lleva su fecha corregida y la vigencia vacía.
    expect([fecha('E7'), celda('F7')!.v, fecha('E10'), celda('F10')]).toEqual([dia(-5), 360, dia(-15), undefined]);
    expect(antes.fecha('E7')).toBe(dia(-400));
    const retirados = matriz('Retirados');
    expect(retirados.slice(1).map((r) => [r[0], r[1], r[4], r[6], r[7], r[9]])).toEqual([
      [12, 'Cliente Ficticio F', 'ev-0001', 'Fila de la hoja', 'admin.exportar@example.com', '=Fila duplicada.'],
      [null, 'Cliente Ficticio Z', '18A00099', 'Equipo', 'admin.exportar@example.com', 'Equipo de prueba.'],
    ]);
    expect(matriz('Detalle').slice(1).map((r) => r[3]).slice(1, 5)).toEqual(['Manual', 'Hoja F-ST-022', 'Ticket de Desk 2.0 n.º 1002', 'Manual']);
    const notas = new Map(matriz('Notas').filter((r) => r[0] !== null).map((r) => [String(r[0]), r[1]]));
    expect([notas.get('Exportado por'), notas.get('Filas exportadas'), notas.get('Retirados a mano (en su hoja, no en la principal)'), notas.get('Origen: Manual')]).toEqual(['tecnico.exportar@example.com', 7, 2, 2]);
  });

  it('cada exportación queda apuntada —quién, a qué día, cuántas filas, de qué congelación y la huella del fichero entregado— y «última exportación» la enseña', async () => {
    const congelacion = await sembrar();
    expect(await ultima()).toEqual({ ultima: null, total: 0 });
    const uno = await exportar(como('comercial'));
    const dos = await exportar(comoAdmin);
    const huella = (r: request.Response) => createHash('sha256').update(r.body as Buffer).digest('hex');
    expect(await apuntes()).toEqual([
      { congelacion_id: congelacion, hoy: HOY, filas: 9, retirados: 0, archivo: NOMBRE, sha256: huella(uno), por_id: PERSONAS.comercial[0], por: 'comercial.exportar@example.com' },
      { congelacion_id: congelacion, hoy: HOY, filas: 9, retirados: 0, archivo: NOMBRE, sha256: huella(dos), por_id: ADMIN, por: 'admin.exportar@example.com' },
    ]);
    const u = await ultima();
    expect(u.total).toBe(2);
    expect(u.ultima).toMatchObject({ id: 2, por: 'admin.exportar@example.com', hoy: HOY, filas: 9, retirados: 0, congelacionId: congelacion, archivo: NOMBRE, sha256: huella(dos) });
    expect(Date.now() - Date.parse(u.ultima!.en.replace(' ', 'T').replace(/\+00$/, 'Z'))).toBeLessThan(60_000);
    expect(JSON.stringify(u)).not.toMatch(/Ficticio|18A0|HB-|TH-/);
  });

  it('el Lector no exporta: 403 en español, y ni un apunte; exportar sólo escribe su apunte (la hoja, el inventario, las calibraciones y los retiros quedan como estaban), con Desk 2.0 caído', async () => {
    await sembrar();
    const antes = await foto();
    const lector = await exportar(comoLector);
    expect(lector.status).toBe(403);
    expect(JSON.parse((lector.body as Buffer).toString('utf8'))).toMatchObject({ error: 'forbidden_role', message: expect.stringMatching(/^Tu rol en Trazabilidad \(Lector\) no permite exportar la F-ST-022/) });
    expect(await apuntes()).toEqual([]);
    for (const quien of ['comercial', 'tecnico', 'director'] as const) expect((await exportar(como(quien))).status).toBe(200);
    expect(await foto()).toEqual(antes);
    expect((await apuntes()).map((a) => a.por)).toEqual(['comercial.exportar@example.com', 'tecnico.exportar@example.com', 'director.exportar@example.com']);
  });

  it('sin congelación vigente se exporta lo que hay en el inventario y en Desk 2.0, y el apunte lo dice (sin congelación)', async () => {
    await enPortal('18A00001', 'Cliente Ficticio A S.A.S.', dia(-200));
    await enPortal('KN-0001', 'Cliente Ficticio K', null, { marca: 'Kunak', modelo: 'AIR Pro', enSeguimiento: false });
    const res = await exportar(como('comercial'));
    expect(res.status).toBe(200);
    const vivas = compararConLaPestana(res.body, await hoja());
    expect(vivas.map((f) => f.serial)).toEqual(['18A00001', 'KN-0001']);
    expect(abrir(res.body).matriz('Trazabilidad')[2][0]).toMatch(/^Sin F-ST-022 congelada en este entorno/);
    expect(await apuntes()).toMatchObject([{ congelacion_id: null, filas: 2, retirados: 0 }]);
  });
});
