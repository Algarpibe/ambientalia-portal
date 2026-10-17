import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { crearPoolDesk2 } from '../db-desk2.js';
import { asegurarDesk2, asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import { crearLectorCalibraciones } from './calibraciones-desk2.js';
import { leerPlanCalibraciones, sincronizarCalibraciones } from './calibraciones-repo.js';
import { ESTADOS_AVISO, planAvisos } from './dominio.js';
import { crearFuenteAgenda } from './fuente.js';
import type { Celda } from './fst022.js';
import { claveMarcaSql } from './inventario.js';
import { crearLectorMaestro } from './maestro-desk2.js';
import { sincronizarMaestro } from './maestro-repo.js';
import { claveMarca } from './marcas.js';

// Marcas en seguimiento (lote 9f, migración 061) contra Postgres, con las rutas
// de verdad (sólo la sesión es un doble), la imitación de Desk 2.0 y una hoja
// congelada con forma de V3 y varias marcas. APAGADA: nada cambia. ENCENDIDA:
// entran exactamente sus equipos activos no retirados, con la MISMA fecha que
// les daba la pestaña; apagarla vuelve a lo de antes byte a byte; volver a
// encenderla no duplica nada; el maestro y la pasada de calibraciones después.
// Ningún correo: los avisos siguen siendo manuales o simulados. Todo ficticio.

const SECRET = 'test-secret-marcas';
process.env.JWT_SECRET = SECRET;
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async (_sql: string, params: unknown[] = []) => ({ rows: [{ role: params[0] === '00000000-0000-4000-8000-0000000000a1' ? 'admin' : 'reader', status: 'active', apps: ['trazabilidad-mantenimientos'], token_version: 0 }], rowCount: 1 }),
    on: () => {},
  }),
}));
const { createTrazabilidadRouter } = await import('./router.js');

let hub: Pool;
let admin2: Pool;
let lector: Pool;
let api: express.Express;
const HOY = '2026-10-17';
const actor = { userId: ADMIN, email: 'director@example.com' };
const cabecera = (userId: string, correo: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: correo, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' })}` });
const comoAdmin = cabecera(ADMIN, 'admin@example.com');
const comoLector = cabecera('00000000-0000-4000-8000-0000000000b2', 'lector@example.com');
const SQL_061 = readFileSync(fileURLToPath(new URL('../users/migrations/061_trazabilidad_marcas_seguimiento.sql', import.meta.url)), 'utf8');

const maestro = () => crearLectorMaestro(() => lector);
const tickets = () => crearLectorCalibraciones(() => lector);
const sincronizar = () => sincronizarMaestro(hub, maestro(), null, actor);
const traer = () => sincronizarCalibraciones(hub, tickets(), null, actor, HOY);

const enPortal = (serial: string, cliente: string, calibracion: string, deskId: string) =>
  hub.query(`INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, ultima_calibracion, desk_id, origen, actualizado_en) VALUES ($1, $1, $2, 'GRIMM', 'EDM 180C', $3, $4, 'desk', '2026-01-01T00:00:00Z')`, [serial, cliente, calibracion, deskId]);
const enDesk = (id: string, serial: string, marca: string, modelo: string, cliente: string) =>
  admin2.query(`INSERT INTO desk.equipos (id, serial, marca, modelo, cliente_nombre, active, raw) VALUES ($1, $2, $3, $4, $5, true, '{}')`, [id, serial, marca, modelo, cliente]);
const ticketCalibrado = (numero: number, serial: string, equipoId: string | null, fecha: string) =>
  admin2.query(`INSERT INTO desk.tickets (id, number, status, status_type, tipo_servicio, serial, equipo_id, raw, custom_fields, managed_by_app, synced_at) VALUES ($1, $2, 'Finalizado', 'Closed', 'Calibración', $3, $4, $5::jsonb, '{}'::jsonb, false, now())`, [`t-${numero}`, numero, serial, equipoId, JSON.stringify({ cf: { cf_fecha_de_calibracion: fecha } })]);

const CABECERA: Celda[] = ['Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Vigencia de Calibración (Dias)'];
type FilaV3 = [cliente: string, marca: string, modelo: string, serial: string, fecha: string | null, clave?: string];
const HOJA: FilaV3[] = [
  ['Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', '2025-10-20', '18A00001'], // fila 6
  ['Cliente Ficticio B', 'Grimm', 'EDM 180C', '18A00002', '2025-06-01', '18A00002'], // 7
  ['Cliente Ficticio H', 'HORIBA', 'APNA 370', 'HB-0001', '2025-10-22'], // 8: vence en 5 días → avisos
  ['Cliente Ficticio H', 'Horiba', 'APSA-370', 'HB-0002', '2024-01-01'], // 9: con un ticket calibrado después → al día
  ['Cliente Ficticio J', 'Horiba', 'APNA-370', 'HB-0003', '2023-03-03'], // 10: con una manual por serial, vencida
  ['Cliente Ficticio J', 'Horiba', 'APNA-370', 'HB-0004', '2025-12-01'], // 11: se retira a mano
  ['Cliente Ficticio L', 'Horiba', 'APNA-370', 'HB-0005', '2024-02-02'], // 12: +1 año
  ['Cliente Ficticio L', 'Horiba', 'APNA-370', 'HB-0006', null], // 13: sin fecha
  ['Cliente Ficticio M', 'Horiba', 'APNA-370', 'HB-0007', '2031-01-01'], // 14: fecha futura → en revisión
  ['Cliente Ficticio N', 'Horiba', 'APNA-370', 'HB-0008', '2025-12-24'], // 15: aún no está en Desk 2.0 (llega después, con la marca encendida)
  ['Cliente Ficticio K', 'Kunak', 'AIR Pro', 'KN-0001', '2025-11-11'], // 16: su marca sigue apagada
  ['Cliente Ficticio Z', 'Grimm', 'EDM 280', '28A00001', '2025-11-30'], // 17: GRIMM de otro modelo
];
const HORIBA_ACTIVOS = ['HB-0001', 'HB-0002', 'HB-0003', 'HB-0005', 'HB-0006', 'HB-0007'];

async function sembrar(): Promise<void> {
  await enPortal('18A00001', 'Cliente Ficticio A S.A.S.', '2025-10-20', 'eq-1');
  await enPortal('18A00002', 'Cliente Ficticio B', '2025-06-01', 'eq-2');
  await hub.query(`INSERT INTO portal.tmc_contactos (clave, cliente, emails, nombre, actualizado_por, actualizado_en) VALUES ('cliente ficticio h s.a.s.', 'Cliente Ficticio H S.A.S.', '{calidad@cliente-h.example}', 'Hugo Ficticio', 'comercial@example.com', '2026-09-01T00:00:00Z')`);
  await hub.query(
    `INSERT INTO desk.tickets (number, subject, status, status_type, serial, codigo_servicio, tipo_servicio, created_time, fecha_creacion_ticket, synced_at, raw)
     VALUES (700, 'CAL_HB-0002 asunto ficticio', 'En proceso', 'Open', 'HB-0002', 'CAL_HB-0002', 'Calibración', '2026-10-01T15:00:00Z', '2026-10-01', NOW(), '{"email": "laboratorio@cliente-h.example"}'::jsonb)`,
  );
  await enDesk('eq-1', '18A00001', 'GRIMM', 'EDM180C', 'Cliente Ficticio A S.A.S.');
  await enDesk('eq-2', '18A00002', 'GRIMM', 'EDM180C', 'Cliente Ficticio B');
  for (const [i, s] of ['HB-0001', 'HB-0002', 'HB-0003', 'HB-0004', 'HB-0005', 'HB-0006', 'HB-0007'].entries()) await enDesk(`eq-h${i + 1}`, s, 'Horiba', 'APNA-370', i < 2 ? 'Cliente Ficticio H S.A.S.' : 'Cliente Ficticio J S.A.S.');
  await enDesk('eq-k', 'KN-0001', 'Kunak', 'AIR Pro', 'Cliente Ficticio K');
  await enDesk('eq-g', '28A00001', 'GRIMM', 'EDM 280', 'Cliente Ficticio Z');
  await ticketCalibrado(1001, '18A00001', 'eq-1', '2026-09-20');
  await ticketCalibrado(1005, 'HB-0002', 'eq-h2', '2026-06-30');
  await ticketCalibrado(1008, 'HB-0008', null, '2026-02-02'); // de un Horiba que el maestro aún no tiene
  await ticketCalibrado(1009, 'KN-0001', 'eq-k', '2026-01-05');
  const { rows } = await hub.query(
    `INSERT INTO portal.tmc_fst022_congelaciones (archivo, sha256, hoja, fila_cabecera, cabeceras, total_filas, total_columnas, filas_guardadas, filas_equipo, filas_con_serial, filas_edm180, problemas, por, en)
     VALUES ('F-ST-022 ficticia V3.xlsx', $1, 'Trazabilidad', 5, $2::jsonb, 17, 6, 13, 12, 12, 2, '{}'::jsonb, 'director@example.com', '2026-10-10T15:00:00Z') RETURNING id`,
    ['ab'.repeat(32), JSON.stringify([CABECERA])],
  );
  const datos = HOJA.map(([cliente, marca, modelo, serial, fecha, clave], i) => ({ fila: 6 + i, celdas: [cliente, marca, modelo, serial, fecha ? { v: fecha, t: 'fecha' } : null, 357], serial_norm: serial.toUpperCase(), clave_equipo: clave ?? null }));
  await hub.query(
    `INSERT INTO portal.tmc_fst022_congelada (congelacion_id, fila, celdas, es_equipo, serial_norm, clave_equipo)
     SELECT $1, x.fila, x.celdas, true, x.serial_norm, x.clave_equipo FROM jsonb_to_recordset($2::jsonb) AS x(fila int, celdas jsonb, serial_norm text, clave_equipo text)`,
    [rows[0].id, JSON.stringify(datos)],
  );
  // Lo de hoy: una manual registrada por la fila de la hoja (sin equipo todavía: se guarda por serial), las otras marcas enlazadas
  // fuera de seguimiento, las calibraciones traídas (las de otras marcas, sin clave) y un Horiba retirado a mano.
  expect((await request(api).post('/api/trazabilidad/calibraciones/manual').set(comoAdmin).send({ fila: 10, fecha: '2025-08-01', motivo: 'Certificado ficticio en papel.' })).status).toBe(200);
  await sincronizar();
  await traer();
  expect((await request(api).post('/api/trazabilidad/equipos/HB-0004/retirar').set(comoAdmin).send({ motivo: 'Ya no se atiende (ficticio).' })).status).toBe(200);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;
const pedir = (ruta: string, quien = comoLector) => request(api).get(`/api/trazabilidad/${ruta}${ruta.includes('?') ? '&' : '?'}hoy=${HOY}`).set(quien);
const cambiar = (clave: string, incluir: boolean, motivo = 'Decisión ficticia de Alfonso.') => request(api).post(`/api/trazabilidad/marcas/${encodeURIComponent(clave)}`).set(comoAdmin).send({ incluir, motivo });
const calibraciones = async () => (await hub.query(`SELECT id, clave, serial, fecha::text AS fecha, origen, ticket, estado, motivo, por, anulada_motivo FROM portal.tmc_calibraciones ORDER BY id`)).rows as Fila[];
/** Lo que alimenta Resumen, Equipos, Calendario, Avisos, su simulación, contactos y Servicios, como texto. */
async function foto(): Promise<Record<string, string>> {
  const [eq, servicios] = await Promise.all([pedir('equipos'), pedir('servicios')]);
  expect([eq.status, servicios.status]).toEqual([200, 200]);
  return { equipos: JSON.stringify(eq.body), avisos: JSON.stringify(planAvisos(eq.body.equipos, HOY, eq.body.contactos)), servicios: JSON.stringify(servicios.body), seguimiento: JSON.stringify((await hub.query(`SELECT * FROM portal.tmc_seguimiento ORDER BY clave`)).rows), contactos: JSON.stringify((await hub.query(`SELECT * FROM portal.tmc_contactos ORDER BY clave`)).rows) };
}
/** La fecha y el estado de cada equipo en la pestaña F-ST-022, por clave. */
const fechasHoja = async () => {
  const h = (await pedir('hoja')).body;
  return Object.fromEntries([...h.filas, ...h.fueraDeHoja].filter((f: Fila) => f.clave).map((f: Fila) => [f.clave, [f.ultimaCalibracion, f.estado, f.situacion]]));
};
const equipos = async () => ((await pedir('equipos')).body.equipos as Fila[]);

beforeAll(async () => {
  hub = poolDePrueba();
  await asegurarDeskTickets(hub);
  const urls = await asegurarDesk2(hub);
  admin2 = createPoolFromUrl(urls.urlAdmin);
  lector = crearPoolDesk2(urls.urlLector);
  api = express();
  api.use(express.json());
  api.use('/api', createTrazabilidadRouter(hub, crearFuenteAgenda({ hub, desk2: () => lector }), maestro(), tickets()));
});
afterAll(async () => {
  await hub?.query(`TRUNCATE portal.tmc_calibraciones, portal.tmc_calibraciones_pasadas, portal.tmc_fst022_congelaciones, portal.tmc_marcas, portal.tmc_marcas_cambios, portal.tmc_retiros RESTART IDENTITY CASCADE`);
  await Promise.all([lector?.end(), admin2?.end(), hub?.end()]);
});
beforeEach(async () => {
  await hub.query(`TRUNCATE desk.tickets, portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_contactos, portal.tmc_maestro_sincronizaciones, portal.tmc_calibraciones, portal.tmc_calibraciones_pasadas, portal.tmc_estados_historial, portal.tmc_fst022_congelaciones, portal.tmc_marcas, portal.tmc_marcas_cambios, portal.tmc_retiros RESTART IDENTITY CASCADE`);
  await admin2.query('TRUNCATE desk.equipos, desk.tickets, desk.ticket_transitions RESTART IDENTITY');
  await sembrar();
});

describe('migración 061', () => {
  it('ejecutarla otra vez, en cada arranque, no cambia nada; no siembra (todas apagadas); motivo obligatorio', async () => {
    await cambiar('horiba', true);
    const antes = [(await hub.query(`SELECT * FROM portal.tmc_marcas`)).rows, (await hub.query(`SELECT * FROM portal.tmc_marcas_cambios`)).rows];
    await hub.query(SQL_061);
    await hub.query(SQL_061);
    expect([(await hub.query(`SELECT * FROM portal.tmc_marcas`)).rows, (await hub.query(`SELECT * FROM portal.tmc_marcas_cambios`)).rows]).toEqual(antes);
    await expect(hub.query(`INSERT INTO portal.tmc_marcas (clave, marca, incluida, motivo, por) VALUES ('thermo', 'Thermo', true, '  ', 'x@example.com')`)).rejects.toThrow(/check/i);
    await expect(hub.query(`INSERT INTO portal.tmc_marcas_cambios (clave, marca, accion, motivo, equipos, partidas, enlazadas, por) VALUES ('thermo', 'Thermo', 'borrar', 'm', 0, 0, 0, 'x@example.com')`)).rejects.toThrow(/check/i);
  });

  it('la clave de la marca en SQL (`claveMarcaSql`) es la misma que en la app (`claveMarca`)', async () => {
    const muestras = ['HORIBA', ' Horiba ', 'Énvironics   Inc', 'TÜV Ñandú', 'GRIMM', 'Durag\tGmbH', ''];
    const { rows } = await hub.query(`SELECT ${claveMarcaSql('x.m')} AS clave FROM unnest($1::text[]) WITH ORDINALITY AS x(m, i) ORDER BY x.i`, [muestras]);
    expect(rows.map((r: Fila) => r.clave)).toEqual(muestras.map(claveMarca));
  });
});

describe('APAGADA: nada cambia', () => {
  it('sin ninguna marca encendida, y con una encendida y apagada después, GET /equipos, el plan de avisos y su simulación, GET /servicios, el seguimiento y los contactos son IDÉNTICOS byte a byte', async () => {
    await pedir('servicios'); // la primera lectura apunta el historial de estados
    const antes = await foto();
    expect((JSON.parse(antes.equipos).equipos as Fila[]).map((e) => e.clave)).toEqual(['18A00001', '18A00002']);
    expect((await pedir('marcas')).body.marcas.filter((m: Fila) => m.incluida).map((m: Fila) => m.clave)).toEqual(['grimm edm 180']);
    expect((await cambiar('kunak', true)).status).toBe(200);
    expect((await cambiar('kunak', false)).status).toBe(200);
    expect(await foto()).toEqual(antes);
  });
});

describe('ENCENDIDA', () => {
  it('entran EXACTAMENTE los equipos activos y no retirados de esa marca, cada uno con la MISMA fecha que le daba la pestaña; la pestaña los da «en el inventario»; Kunak y el GRIMM de otro modelo, no', async () => {
    const hoja = await fechasHoja();
    const res = await cambiar('horiba', true);
    expect(res.status).toBe(200);
    const eq = await equipos();
    expect(eq.map((e) => e.clave).sort()).toEqual(['18A00001', '18A00002', ...HORIBA_ACTIVOS].sort());
    for (const e of eq.filter((x) => x.clave.startsWith('HB-'))) expect([e.ultimaCalibracion, e.estado], e.clave).toEqual(hoja[e.clave].slice(0, 2));
    // Y no salen en masa «Sin fecha»: cada estado es el que tenía.
    expect(Object.fromEntries(eq.filter((x) => x.clave.startsWith('HB-')).map((e) => [e.clave, e.estado]))).toEqual({ 'HB-0001': 'VENCE_30', 'HB-0002': 'AL_DIA', 'HB-0003': 'VENCIDA', 'HB-0005': 'FUERA_CICLO', 'HB-0006': 'SIN_FECHA', 'HB-0007': 'SIN_FECHA' });
    const despues = await fechasHoja();
    for (const clave of HORIBA_ACTIVOS) expect(despues[clave], clave).toEqual([...hoja[clave].slice(0, 2), 'inventario']);
    expect(despues['HB-0004']).toEqual([...hoja['HB-0004'].slice(0, 2), 'inactivo']);
    expect([despues['KN-0001'][2], despues['28A00001'][2]]).toEqual(['enlazado', 'enlazado']);
    // Lo que escribió: la partida de cada Horiba con fecha en la hoja (también del retirado), con su clave, y la manual y el ticket sueltos, enlazados.
    const filas = await calibraciones();
    expect(filas.filter((c) => c.origen === 'fst022' && c.clave?.startsWith('HB-')).map((c) => [c.clave, c.fecha, c.estado])).toEqual([['HB-0001', '2025-10-22', 'vigente'], ['HB-0002', '2024-01-01', 'vigente'], ['HB-0003', '2023-03-03', 'vigente'], ['HB-0004', '2025-12-01', 'vigente'], ['HB-0005', '2024-02-02', 'vigente'], ['HB-0007', '2031-01-01', 'en_revision']]);
    expect(filas.filter((c) => c.origen !== 'fst022' && c.serial.toUpperCase().startsWith('HB-')).map((c) => [c.clave, c.origen, c.fecha, c.por])).toEqual([['HB-0003', 'manual', '2025-08-01', 'admin@example.com'], ['HB-0002', 'desk', '2026-06-30', 'director@example.com'], [null, 'desk', '2026-02-02', 'director@example.com']]);
    const marcas = res.body.marcas as Fila[];
    expect(marcas.find((m) => m.clave === 'horiba')).toMatchObject({ incluida: true, firma: { por: 'admin@example.com', motivo: 'Decisión ficticia de Alfonso.' } });
    expect(res.body.cambios[0]).toMatchObject({ clave: 'horiba', accion: 'incluir', equipos: 6, partidas: 6, enlazadas: 2, por: 'admin@example.com' });
  });

  it('el plan de avisos (manual y simulación) gana exactamente sus vencidas y por vencer; las de +1 año y sin fecha no avisan; ningún correo sale de aquí', async () => {
    const enAvisos = (eq: Fila[]) => eq.filter((e) => ESTADOS_AVISO.includes(e.estado)).map((e) => e.clave).sort();
    const antes = enAvisos(await equipos());
    await cambiar('horiba', true);
    const eq = await equipos();
    expect(enAvisos(eq)).toEqual([...antes, 'HB-0001', 'HB-0003'].sort());
    const plan = planAvisos(eq as never, HOY, (await pedir('equipos')).body.contactos);
    const claves = (xs: { equipo: Fila }[]) => xs.map((a) => a.equipo.clave);
    expect([...plan.correos, ...plan.sinDestinatario].flatMap((g) => claves(g.equipos))).toContain('HB-0001');
    expect(claves(plan.vencidasSinAviso)).toContain('HB-0003');
    expect(claves(plan.fueraCiclo)).toContain('HB-0005');
    expect(JSON.stringify(plan.correos)).not.toMatch(/HB-000[2567]/);
    // Se les puede guardar seguimiento: ahora sí están en el inventario.
    expect((await request(api).put('/api/trazabilidad/seguimiento/HB-0001').set(comoAdmin).send({ enAmbientalia: false, avisoEnviado: '2026-10-17', servicioProgramado: null, nota: '' })).status).toBe(200);
  });

  it('apagarla vuelve a lo de antes BYTE A BYTE (las filas quedan: la pestaña da las mismas fechas); volver a encenderla no duplica ni una fila', async () => {
    await pedir('servicios');
    const antes = await foto();
    const hoja = await fechasHoja();
    await cambiar('horiba', true);
    const conHoriba = await foto();
    const guardadas = await calibraciones();
    expect(conHoriba.equipos).not.toBe(antes.equipos);
    expect((await cambiar('horiba', false, 'Vuelta atrás ficticia.')).status).toBe(200);
    expect(await foto()).toEqual(antes);
    expect(await fechasHoja()).toEqual(hoja);
    expect(await calibraciones()).toEqual(guardadas);
    expect((await cambiar('horiba', true)).body.cambios[0]).toMatchObject({ accion: 'incluir', partidas: 0, enlazadas: 0 });
    expect(await calibraciones()).toEqual(guardadas);
    expect(await foto()).toEqual(conHoriba);
    expect(((await pedir('marcas')).body.cambios as Fila[]).map((c) => c.accion)).toEqual(['incluir', 'excluir', 'incluir']);
  });

  it('la pasada de calibraciones después no duplica partidas, no re-enlaza nada y no mueve ninguna fecha', async () => {
    await cambiar('horiba', true);
    const antes = [await calibraciones(), await equipos()];
    const p = await leerPlanCalibraciones(hub, tickets(), HOY, true);
    expect(p.plan!.recuentos).toMatchObject({ nuevas: 0, cambiadas: 0, reenlazadas: 0, vaciadas: 0, partida: 0, equiposCambian: 0 });
    await traer();
    expect([await calibraciones(), await equipos()]).toEqual(antes);
  });

  it('el maestro, con la marca encendida: un Horiba nuevo en Desk 2.0 entra SOLO en el inventario, con la fecha que ya le daba la pestaña (su partida y su ticket, enlazados en la misma transacción); la pasada después no cambia nada', async () => {
    await cambiar('horiba', true);
    const hoja = await fechasHoja();
    expect(hoja['HB-0008']).toBeUndefined();
    const fila = ((await pedir('hoja')).body.filas as Fila[]).find((f) => f.fila === 15)!;
    expect([fila.situacion, fila.ultimaCalibracion, fila.estado]).toEqual(['hoja', '2026-02-02', 'AL_DIA']);
    await enDesk('eq-h8', 'HB-0008', 'Horiba', 'APNA-370', 'Cliente Ficticio N S.A.S.');
    await sincronizar();
    const nuevo = (await equipos()).find((e) => e.clave === 'HB-0008');
    expect([nuevo?.ultimaCalibracion, nuevo?.estado]).toEqual(['2026-02-02', 'AL_DIA']);
    expect((await fechasHoja())['HB-0008']).toEqual(['2026-02-02', 'AL_DIA', 'inventario']);
    const antes = [await calibraciones(), await equipos()];
    await traer();
    expect([await calibraciones(), await equipos()]).toEqual(antes);
  });

  it('todo o nada: si la base falla al apuntar el cambio, no queda ni la marca, ni una partida, ni un enlace', async () => {
    const antes = [await calibraciones(), (await hub.query(`SELECT * FROM portal.tmc_marcas`)).rows];
    const { cambiarMarca } = await import('./marcas-repo.js');
    const rota = {
      query: hub.query.bind(hub),
      connect: async () => {
        const c = await hub.connect();
        return { query: (sql: string, p?: unknown[]) => (/INSERT INTO portal\.tmc_marcas_cambios/.test(sql) ? Promise.reject(new Error('la base falló')) : c.query(sql, p)), release: () => c.release() };
      },
    } as unknown as Pool;
    await expect(cambiarMarca(rota, 'horiba', { incluir: true, motivo: 'm' }, actor, HOY)).rejects.toThrow('la base falló');
    expect([await calibraciones(), (await hub.query(`SELECT * FROM portal.tmc_marcas`)).rows]).toEqual(antes);
  });

  it('un Lector ve las marcas (sólo recuentos) y no puede encender ninguna: 403 y nada escrito', async () => {
    const res = await pedir('marcas');
    expect(res.body.marcas.find((m: Fila) => m.clave === 'horiba').resumen).toMatchObject({ equipos: 6, avisos: 2, clientesAvisos: 2, partidas: 6, enlazadas: 2 });
    expect(JSON.stringify(res.body)).not.toMatch(/Ficticio|HB-|KN-|18A0|eq-/);
    const no = await request(api).post('/api/trazabilidad/marcas/horiba').set(comoLector).send({ incluir: true, motivo: 'x' });
    expect([no.status, no.body.error]).toEqual([403, 'forbidden_role']);
    expect((await hub.query(`SELECT count(*)::int AS n FROM portal.tmc_marcas`)).rows[0].n).toBe(0);
  });
});
