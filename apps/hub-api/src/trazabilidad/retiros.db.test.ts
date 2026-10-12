import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { hoyEnColombia } from '../ausencias/saldo.js';
import { crearPoolDesk2 } from '../db-desk2.js';
import { asegurarDesk2, asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import { planAvisos } from './dominio.js';
import { crearFuenteAgenda } from './fuente.js';
import { crearLectorMaestro } from './maestro-desk2.js';
import { leerPlanMaestro, sincronizarMaestro } from './maestro-repo.js';

// Retirar y reincorporar (lote 9d-2b, migración 059) contra Postgres, con las
// rutas de verdad (sólo la sesión es un doble) y la imitación de Desk 2.0: la
// 059 repetida, retirar un equipo (el inventario lo pierde; su seguimiento y
// sus calibraciones se conservan), que la sincronización del maestro NO lo
// reactiva aunque Desk 2.0 lo tenga activo —y sí le actualiza el cliente—,
// reincorporarlo, la auditoría, las filas de la hoja sin equipo, todo o nada y
// dos a la vez. Todo ficticio.

const SECRET = 'test-secret-retiros';
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
const { retirarEquipo } = await import('./retiros-repo.js');

let hub: Pool;
let admin2: Pool;
let lector: Pool;
let api: express.Express;

const HOY = hoyEnColombia();
const dia = (delta: number): string => new Date(Date.parse(`${HOY}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
const SQL_059 = readFileSync(fileURLToPath(new URL('../users/migrations/059_trazabilidad_retiros.sql', import.meta.url)), 'utf8');
const actor = { userId: ADMIN, email: 'director@example.com' };
const cabecera = (userId: string, correo: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: correo, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' })}` });
const comoAdmin = cabecera(ADMIN, 'director@example.com');
const comoLector = cabecera('00000000-0000-4000-8000-0000000000b2', 'lector@example.com');

const maestro = () => crearLectorMaestro(() => lector);
const sincronizar = () => sincronizarMaestro(hub, maestro(), null, actor);
const plan = async () => (await leerPlanMaestro(hub, maestro(), true)).plan!;

const enPortal = (clave: string, cliente: string, calibracion: string | null, extra: { activo?: boolean; marca?: string; modelo?: string; enSeguimiento?: boolean } = {}) =>
  hub.query(`INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, ultima_calibracion, activo, desk_id, origen, en_seguimiento, actualizado_en) VALUES ($1, $1, $2, $3, $4, $5, $6, $7, 'desk', $8, '2026-01-01T00:00:00Z')`, [
    clave, cliente, extra.marca ?? 'GRIMM', extra.modelo ?? 'EDM 180C', calibracion, extra.activo ?? true, `eq-${clave}`, extra.enSeguimiento ?? true,
  ]);
const enDesk = (clave: string, cliente: string, extra: { marca?: string; modelo?: string; activo?: boolean } = {}) =>
  admin2.query(`INSERT INTO desk.equipos (id, serial, marca, modelo, cliente_nombre, active, raw) VALUES ($1, $2, $3, $4, $5, $6, '{}')`, [`eq-${clave}`, clave, extra.marca ?? 'GRIMM', extra.modelo ?? 'EDM180C', cliente, extra.activo ?? true]);

/** Una congelación con la forma de la V3: `[serial, marca, clave]` por fila, desde la fila 6. */
async function congelar(filas: [string, string, string | null][]): Promise<void> {
  const cabeceras = [['Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Vigencia de Calibración (Dias)']];
  const { rows } = await hub.query(
    `INSERT INTO portal.tmc_fst022_congelaciones (archivo, sha256, hoja, fila_cabecera, cabeceras, total_filas, total_columnas, filas_guardadas, filas_equipo, filas_con_serial, filas_edm180, problemas, por)
     VALUES ('F-ST-022 ficticia V3.xlsx', $1, 'Trazabilidad', 5, $2::jsonb, 9, 6, 5, 4, 4, 2, '{}'::jsonb, 'director@example.com') RETURNING id`,
    ['ab'.repeat(32), JSON.stringify(cabeceras)],
  );
  let fila = 5;
  for (const [serial, marca, clave] of filas) {
    await hub.query(`INSERT INTO portal.tmc_fst022_congelada (congelacion_id, fila, celdas, es_equipo, serial_norm, clave_equipo) VALUES ($1, $2, $3::jsonb, true, $4, $5)`, [rows[0].id, ++fila, JSON.stringify(['Cliente Ficticio', marca, 'Modelo ficticio', serial, { v: dia(-357), t: 'fecha' }, 8]), serial.toUpperCase(), clave]);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;
const equipoBd = async (clave: string) => (await hub.query(`SELECT cliente, activo, en_seguimiento, retirado_en IS NOT NULL AS retirado, retirado_por, retirado_motivo, retirado_por_id FROM portal.tmc_equipos WHERE clave = $1`, [clave])).rows[0] as Fila;
const apuntes = async () => (await hub.query(`SELECT clave, congelacion_id, fila, accion, motivo, antes, despues, por, por_id FROM portal.tmc_retiros ORDER BY id`)).rows as Fila[];
const md5 = async (tabla: string, orden: string) => (await hub.query(`SELECT md5(coalesce(string_agg(t::text, ';' ORDER BY ${orden}), '')) AS h FROM portal.${tabla} t`)).rows[0].h as string;
const equipos = async () => (await request(api).get(`/api/trazabilidad/equipos?hoy=${HOY}`).set(comoLector)).body as { equipos: Fila[]; contactos: never[] };
const claves = async () => (await equipos()).equipos.map((e) => e.clave).sort();
const enAvisos = async (clave: string) => {
  const inv = await equipos();
  const p = planAvisos(inv.equipos as never[], HOY, inv.contactos);
  return [...p.correos, ...p.sinDestinatario].some((c) => JSON.stringify(c).includes(`"clave":"${clave}"`));
};
const hoja = async () => (await request(api).get(`/api/trazabilidad/hoja?hoy=${HOY}`).set(comoLector)).body as { filas: Fila[]; fueraDeHoja: Fila[]; resumen: Fila };
const pedir = (ruta: string, motivo = 'El cliente lo dio de baja.', quien = comoAdmin) => request(api).post(`/api/trazabilidad/${ruta}`).set(quien).send({ motivo });
const historial = async (q: string) => (await request(api).get(`/api/trazabilidad/retiros?${q}`).set(comoLector)).body.retiros as Fila[];

/** Dos GRIMM EDM 180 en seguimiento (uno a punto de vencer, con seguimiento y calibraciones), un Horiba enlazado fuera de seguimiento, y Desk 2.0 con los tres ACTIVOS. */
async function sembrar(): Promise<void> {
  await enPortal('18A00001', 'Cliente Ficticio A', dia(-357));
  await enPortal('18A00002', 'Cliente Ficticio B', dia(-10));
  await enPortal('HB-0001', 'Cliente Ficticio H S.A.S.', null, { marca: 'Horiba', modelo: 'APNA-370', enSeguimiento: false });
  await enDesk('18A00001', 'Cliente Ficticio A');
  await enDesk('18A00002', 'Cliente Ficticio B');
  await enDesk('HB-0001', 'Cliente Ficticio H S.A.S.', { marca: 'Horiba', modelo: 'APNA-370' });
  await hub.query(`INSERT INTO portal.tmc_seguimiento (clave, nota, actualizado_por) VALUES ('18A00001', 'nota ficticia', 'tecnico@example.com')`);
  await hub.query(`INSERT INTO portal.tmc_calibraciones (clave, serial, serial_norm, fecha, origen, estado, por) VALUES ('18A00001', '18A00001', '18A00001', $1, 'fst022', 'vigente', 'director@example.com')`, [dia(-357)]);
  // Filas 6 y 7: de los dos equipos en seguimiento. 8: sólo en la hoja. 9 y 10: el mismo serial dos veces (una sobra).
  await congelar([['18A00001', 'Grimm', '18A00001'], ['18A00002', 'Grimm', '18A00002'], ['TH-0001', 'Thermo', null], ['EV-0001', 'Environics', null], ['ev-0001', 'Environics', null]]);
}

beforeAll(async () => {
  hub = poolDePrueba();
  await asegurarDeskTickets(hub);
  const urls = await asegurarDesk2(hub);
  admin2 = createPoolFromUrl(urls.urlAdmin);
  lector = crearPoolDesk2(urls.urlLector);
  api = express();
  api.use(express.json());
  api.use('/api', createTrazabilidadRouter(hub, crearFuenteAgenda({ hub, desk2: () => lector }), maestro()));
});
afterAll(async () => {
  await hub?.query(`TRUNCATE portal.tmc_retiros, portal.tmc_calibraciones, portal.tmc_fst022_congelaciones RESTART IDENTITY CASCADE`);
  await Promise.all([lector?.end(), admin2?.end(), hub?.end()]);
});
beforeEach(async () => {
  await hub.query(`TRUNCATE desk.tickets, portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_contactos, portal.tmc_retiros, portal.tmc_calibraciones, portal.tmc_maestro_sincronizaciones, portal.tmc_fst022_congelaciones RESTART IDENTITY CASCADE`);
  await admin2.query('TRUNCATE desk.equipos, desk.tickets, desk.ticket_transitions RESTART IDENTITY');
});

describe('migración 059', () => {
  it('nadie nace retirado; ejecutarla otra vez (cada arranque) no toca los equipos, sus marcas ni los apuntes', async () => {
    await sembrar();
    expect(await equipoBd('18A00001')).toMatchObject({ activo: true, retirado: false, retirado_por: null, retirado_motivo: null });
    expect((await pedir('equipos/18A00001/retirar')).status).toBe(200);
    expect((await pedir('filas/8/retirar', 'Fila duplicada.')).status).toBe(200);
    const todo = async () => [await md5('tmc_equipos', 'clave'), await md5('tmc_retiros', 'id')];
    const antes = await todo();
    await hub.query(SQL_059);
    await hub.query(SQL_059);
    expect(await todo()).toEqual(antes);
    expect(await apuntes()).toHaveLength(2);
  });

  it('los CHECK de tmc_retiros: la acción, el motivo (obligatorio) y de quién es (un equipo O una fila con su congelación)', async () => {
    const alta = (cols: string, vals: string) => hub.query(`INSERT INTO portal.tmc_retiros (antes, despues, por, ${cols}) VALUES ('activo', 'retirado', 'director@example.com', ${vals})`);
    await expect(alta('clave, accion, motivo', `'18A00001', 'borrar', 'm'`)).rejects.toThrow(/check/i);
    await expect(alta('clave, accion, motivo', `'18A00001', 'retirar', '  '`)).rejects.toThrow(/check/i);
    await expect(alta('accion, motivo', `'retirar', 'm'`)).rejects.toThrow(/tmc_retiros_objeto/);
    await expect(alta('clave, congelacion_id, fila, accion, motivo', `'18A00001', 1, 6, 'retirar', 'm'`)).rejects.toThrow(/tmc_retiros_objeto/);
    await expect(alta('fila, accion, motivo', `6, 'retirar', 'm'`)).rejects.toThrow(/tmc_retiros_objeto/);
    await alta('congelacion_id, fila, accion, motivo', `1, 6, 'retirar', 'm'`);
    await alta('clave, accion, motivo', `'18A00001', 'retirar', 'm'`);
  });
});

describe('retirar un equipo en seguimiento', () => {
  it('queda inactivo, con su marca firmada y su apunte; el inventario lo pierde (Equipos, Avisos) y conserva su seguimiento y sus calibraciones; nadie más cambia', async () => {
    await sembrar();
    expect([await claves(), await enAvisos('18A00001')]).toEqual([['18A00001', '18A00002'], true]);
    const intacto = async () => [await md5('tmc_seguimiento', 'clave'), await md5('tmc_calibraciones', 'id'), await md5('tmc_fst022_congelada', 'fila'), JSON.stringify([await equipoBd('18A00002'), await equipoBd('HB-0001')])];
    const antes = await intacto();

    const res = await pedir('equipos/18A00001/retirar');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ retirado: true, retiros: [{ accion: 'retirar', motivo: 'El cliente lo dio de baja.', antes: 'activo', despues: 'retirado', por: 'director@example.com' }] });
    expect(await equipoBd('18A00001')).toMatchObject({ activo: false, en_seguimiento: true, retirado: true, retirado_por: 'director@example.com', retirado_por_id: ADMIN, retirado_motivo: 'El cliente lo dio de baja.' });
    expect(await apuntes()).toEqual([{ clave: '18A00001', congelacion_id: null, fila: null, accion: 'retirar', motivo: 'El cliente lo dio de baja.', antes: 'activo', despues: 'retirado', por: 'director@example.com', por_id: ADMIN }]);
    expect([await claves(), await enAvisos('18A00001')]).toEqual([['18A00002'], false]);
    expect(await intacto()).toEqual(antes);
    // La pestaña lo sigue enseñando, inactivo y con quién, cuándo y por qué; y ya no cuenta por estado.
    const h = await hoja();
    expect(h.filas[0]).toMatchObject({ clave: '18A00001', situacion: 'inactivo', estado: 'VENCE_30', retirado: { por: 'director@example.com', motivo: 'El cliente lo dio de baja.' } });
    expect(h.resumen).toMatchObject({ retirados: 1, enInventario: 2, inactivos: 1 });
    expect(h.resumen.porEstado.VENCE_30).toBe(3); // las tres filas sin equipo, que siguen vivas
  });

  it('la sincronización del maestro NO lo reactiva aunque Desk 2.0 lo tenga activo: lo cuenta aparte, sin proponer cambio sobre su `activo`, y sí le actualiza el cliente', async () => {
    await sembrar();
    await pedir('equipos/18A00001/retirar');
    await admin2.query(`UPDATE desk.equipos SET cliente_nombre = 'Cliente Ficticio A S.A.S.' WHERE id = 'eq-18A00001'`);
    const p = await plan();
    expect(p.recuentos).toMatchObject({ casan: 2, retiradosAMano: 1, cambios: { cliente: 1, modelo: 0, serial: 0, activo: 0 } });
    const aplicada = await sincronizar();
    expect(aplicada.recuentos).toMatchObject({ retiradosAMano: 1 });
    expect(await equipoBd('18A00001')).toMatchObject({ cliente: 'Cliente Ficticio A S.A.S.', activo: false, retirado: true, retirado_motivo: 'El cliente lo dio de baja.' });
    expect(await claves()).toEqual(['18A00002']);
    // Otra vez: sigue igual, y el plan ya no trae nada.
    await sincronizar();
    expect([(await equipoBd('18A00001')).activo, (await plan()).recuentos.cambios]).toEqual([false, { cliente: 0, modelo: 0, serial: 0, activo: 0 }]);
  });

  it('contraste: un inactivo SIN la marca, activo en Desk 2.0, sí se reactiva al sincronizar (es lo que hacía siempre); y por eso no hace falta «retirarlo»', async () => {
    await enPortal('18A00003', 'Cliente Ficticio C', dia(-10), { activo: false });
    await enDesk('18A00003', 'Cliente Ficticio C');
    const inactivo = await pedir('equipos/18A00003/retirar');
    expect([inactivo.status, inactivo.body.error]).toEqual([409, 'equipo_inactivo']);
    expect((await plan()).recuentos).toMatchObject({ retiradosAMano: 0, cambios: { activo: 1 } });
    await sincronizar();
    expect(await equipoBd('18A00003')).toMatchObject({ activo: true, retirado: false });
  });

  it('reincorporar: quita la marca, vuelve a estar activo y a seguir al maestro; la auditoría guarda las dos cosas, la más reciente primero', async () => {
    await sembrar();
    await pedir('equipos/18A00001/retirar');
    const res = await pedir('equipos/18A00001/reincorporar', 'Se retiró por error.');
    expect([res.status, res.body.retirado, res.body.retiros.map((r: Fila) => r.accion)]).toEqual([200, false, ['reincorporar', 'retirar']]);
    expect(await equipoBd('18A00001')).toMatchObject({ activo: true, retirado: false, retirado_por: null, retirado_motivo: null, retirado_por_id: null });
    expect([await claves(), await enAvisos('18A00001')]).toEqual([['18A00001', '18A00002'], true]);
    expect((await hoja()).filas[0]).toMatchObject({ situacion: 'inventario', retirado: null });
    expect((await historial('clave=18A00001')).map((r) => [r.accion, r.motivo, r.antes, r.despues, r.por])).toEqual([
      ['reincorporar', 'Se retiró por error.', 'retirado', 'activo', 'director@example.com'],
      ['retirar', 'El cliente lo dio de baja.', 'activo', 'retirado', 'director@example.com'],
    ]);
    // Ya sin la marca, si Desk 2.0 lo da de baja, la sincronización lo desactiva como a cualquiera.
    await admin2.query(`UPDATE desk.equipos SET active = false WHERE id = 'eq-18A00001'`);
    await sincronizar();
    expect(await equipoBd('18A00001')).toMatchObject({ activo: false, retirado: false });
  });

  it('409 al retirar dos veces o al reincorporar lo que no está retirado; 404 si no existe; un Lector no puede (403) y la base queda como estaba', async () => {
    await sembrar();
    const antes = [await md5('tmc_equipos', 'clave'), await apuntes()];
    expect((await pedir('equipos/18A00001/retirar', 'm', comoLector)).status).toBe(403);
    expect((await pedir('filas/8/retirar', 'm', comoLector)).status).toBe(403);
    expect((await pedir('equipos/NO-EXISTE/retirar')).status).toBe(404);
    expect((await pedir('equipos/18A00001/reincorporar')).body).toMatchObject({ error: 'no_retirado' });
    expect((await request(api).post('/api/trazabilidad/equipos/18A00001/retirar').set(comoAdmin).send({})).body).toMatchObject({ error: 'invalid_input', field: 'motivo' });
    expect([await md5('tmc_equipos', 'clave'), await apuntes()]).toEqual(antes);
    await pedir('equipos/18A00001/retirar');
    expect((await pedir('equipos/18A00001/retirar')).body).toMatchObject({ error: 'ya_retirado' });
    expect(await apuntes()).toHaveLength(1);
  });

  it('todo o nada: si el apunte no se puede guardar, el equipo NO queda retirado', async () => {
    await sembrar();
    await expect(retirarEquipo(hub, '18A00001', true, '   ', actor)).rejects.toThrow(/check/i);
    expect(await equipoBd('18A00001')).toMatchObject({ activo: true, retirado: false });
    expect(await apuntes()).toEqual([]);
  });

  it('dos a la vez: entra uno y el otro es un 409; un solo apunte', async () => {
    await sembrar();
    const [a, b] = await Promise.all([pedir('equipos/18A00002/retirar'), pedir('equipos/18A00002/retirar')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await apuntes()).toHaveLength(1);
  });
});

describe('retirar un equipo enlazado fuera de seguimiento', () => {
  it('lo mismo: se respeta al sincronizar (contado en las otras marcas), la pestaña lo dice, y `en_seguimiento` no cambia en nadie', async () => {
    await sembrar();
    const ambitos = async () => (await hub.query(`SELECT clave, en_seguimiento FROM portal.tmc_equipos ORDER BY clave`)).rows;
    const antes = await ambitos();
    expect((await pedir('equipos/HB-0001/retirar', 'Equipo de prueba.')).status).toBe(200);
    expect((await plan()).otras).toMatchObject({ casan: 1, retiradosAMano: 1, cambios: { activo: 0 } });
    await sincronizar();
    expect(await equipoBd('HB-0001')).toMatchObject({ activo: false, en_seguimiento: false, retirado: true });
    expect((await hoja()).fueraDeHoja.find((f) => f.clave === 'HB-0001')).toMatchObject({ situacion: 'enlazado', retirado: { motivo: 'Equipo de prueba.' } });
    expect((await pedir('equipos/HB-0001/reincorporar', 'No era de prueba.')).status).toBe(200);
    expect(await equipoBd('HB-0001')).toMatchObject({ activo: true, en_seguimiento: false, retirado: false });
    expect(await ambitos()).toEqual(antes);
    expect(await claves()).toEqual(['18A00001', '18A00002']);
  });
});

describe('retirar una fila de la hoja sin equipo', () => {
  it('se apunta con su congelación y su fila; la pestaña la sigue enseñando, retirada y con su motivo, fuera de los totales vivos; la hoja congelada y el inventario no se tocan; y se deshace', async () => {
    await sembrar();
    const intacto = async () => [await md5('tmc_fst022_congelada', 'fila'), await md5('tmc_equipos', 'clave')];
    const antes = await intacto();
    expect((await hoja()).resumen).toMatchObject({ total: 5, soloHoja: 3, retirados: 0 });

    const res = await pedir('filas/8/retirar', 'Ese analizador ya no existe.');
    expect([res.status, res.body.retirado]).toEqual([200, true]);
    // También una de las dos filas con el serial repetido: la que sobra.
    expect((await pedir('filas/10/retirar', 'Fila duplicada.')).status).toBe(200);
    expect(await apuntes()).toMatchObject([
      { clave: null, congelacion_id: '1', fila: 8, accion: 'retirar', motivo: 'Ese analizador ya no existe.', antes: 'activo', despues: 'retirado', por: 'director@example.com' },
      { clave: null, congelacion_id: '1', fila: 10, accion: 'retirar', motivo: 'Fila duplicada.' },
    ]);
    const h = await hoja();
    expect(h.filas.map((f) => [f.fila, f.serial, f.retirado?.motivo ?? null])).toEqual([[6, '18A00001', null], [7, '18A00002', null], [8, 'TH-0001', 'Ese analizador ya no existe.'], [9, 'EV-0001', null], [10, 'ev-0001', 'Fila duplicada.']]);
    expect(h.resumen).toMatchObject({ total: 5, soloHoja: 1, retirados: 2 });
    expect(await intacto()).toEqual(antes);

    expect((await pedir('filas/8/reincorporar', 'Sí existe: estaba en otra sede.')).body).toMatchObject({ retirado: false });
    expect((await hoja()).filas[2]).toMatchObject({ fila: 8, retirado: null });
    expect((await hoja()).resumen).toMatchObject({ soloHoja: 2, retirados: 1 });
    expect((await historial('fila=8')).map((r) => [r.accion, r.motivo])).toEqual([['reincorporar', 'Sí existe: estaba en otra sede.'], ['retirar', 'Ese analizador ya no existe.']]);
    expect(await intacto()).toEqual(antes);
  });

  it('409 si la fila es de un equipo (se retira el equipo), si ya está retirada o si se recupera una que no lo está; 404 si no existe; dos a la vez, una', async () => {
    await sembrar();
    expect((await pedir('filas/6/retirar')).body).toMatchObject({ error: 'fila_con_equipo' });
    expect((await pedir('filas/8/reincorporar')).body).toMatchObject({ error: 'no_retirada' });
    expect((await pedir('filas/77/retirar')).status).toBe(404);
    expect(await apuntes()).toEqual([]);
    const [a, b] = await Promise.all([pedir('filas/8/retirar'), pedir('filas/8/retirar')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await pedir('filas/8/retirar')).body).toMatchObject({ error: 'ya_retirada' });
    expect(await apuntes()).toHaveLength(1);
  });
});
