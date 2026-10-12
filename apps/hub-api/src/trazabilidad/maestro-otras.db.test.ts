import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { crearPoolDesk2 } from '../db-desk2.js';
import { asegurarDesk2, asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import { crearLectorCalibraciones } from './calibraciones-desk2.js';
import { leerPlanCalibraciones, sincronizarCalibraciones } from './calibraciones-repo.js';
import { planAvisos } from './dominio.js';
import { crearFuenteAgenda } from './fuente.js';
import type { Celda } from './fst022.js';
import { leerHoja } from './hoja-repo.js';
import { crearLectorMaestro } from './maestro-desk2.js';
import { leerPlanMaestro, sincronizarMaestro } from './maestro-repo.js';

// Lote 9d-2a contra Postgres: las demás marcas del maestro se enlazan con Desk
// 2.0 FUERA de seguimiento. Con la imitación de Desk 2.0 (equipos de varias
// marcas, un serial repetido, uno numérico con ceros, un inactivo y uno que la
// hoja no tiene) y una hoja congelada con forma de V3 (con una marca que no
// existe en Desk 2.0): el plan, aplicarlo, idempotencia, todo o nada, que sin
// maestro no escribe, que lo que ya había (GET /equipos, avisos, servicios)
// queda IDÉNTICO, y la pestaña «Trazabilidad F-ST-022» antes y después.
// Las rutas son las de verdad; sólo la sesión es un doble. Todo ficticio.

const SECRET = 'test-secret-maestro-otras';
process.env.JWT_SECRET = SECRET;
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async (_sql: string, params: unknown[] = []) => ({ rows: [{ role: params[0] === '00000000-0000-4000-8000-0000000000a1' ? 'admin' : 'reader', status: 'active', apps: ['trazabilidad-mantenimientos'], token_version: 0 }], rowCount: 1 }),
    on: () => {},
  }),
}));
const { createTrazabilidadRouter } = await import('./router.js');
const repo = await import('./repo.js');

let hub: Pool;
let admin2: Pool;
let lector: Pool;
let api: express.Express;
const HOY = '2026-10-12';
const actor = { userId: ADMIN, email: 'director@example.com' };
const cabecera = (userId: string, correo: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: correo, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' })}` });
const comoAdmin = cabecera(ADMIN, 'admin@example.com');
const comoLector = cabecera('00000000-0000-4000-8000-0000000000b2', 'lector@example.com');

const maestro = () => crearLectorMaestro(() => lector);
const tickets = () => crearLectorCalibraciones(() => lector);
const sincronizar = (huella: string | null = null) => sincronizarMaestro(hub, maestro(), huella, actor);
const plan = async () => leerPlanMaestro(hub, maestro(), true);

const enPortal = (serial: string, cliente: string, calibracion: string | null, deskId: string) =>
  hub.query(`INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, ultima_calibracion, desk_id, origen, actualizado_en) VALUES ($1, $1, $2, 'GRIMM', 'EDM 180C', $3, $4, 'desk', '2026-01-01T00:00:00Z')`, [serial, cliente, calibracion, deskId]);
const enDesk = (id: string, serial: string, marca: string, modelo: string, cliente: string, activo = true) =>
  admin2.query(`INSERT INTO desk.equipos (id, serial, marca, modelo, cliente_nombre, active, raw) VALUES ($1, $2, $3, $4, $5, $6, '{"reservado": "no se lee"}')`, [id, serial, marca, modelo, cliente, activo]);
const ticketCalibrado = (numero: number, serial: string, equipoId: string, fecha: string) =>
  admin2.query(`INSERT INTO desk.tickets (id, number, status, status_type, tipo_servicio, serial, equipo_id, raw, custom_fields, managed_by_app, synced_at) VALUES ($1, $2, 'Finalizado', 'Closed', 'Calibración', $3, $4, $5::jsonb, '{}'::jsonb, false, now())`, [`t-${numero}`, numero, serial, equipoId, JSON.stringify({ cf: { cf_fecha_de_calibracion: fecha } })]);

const CABECERA: Celda[] = ['Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Vigencia de Calibración (Dias)'];
type FilaHoja = [cliente: string, marca: string, modelo: string, serial: Celda, fecha: string | null, clave?: string];
const HOJA: FilaHoja[] = [
  ['Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', '2025-10-20', '18A00001'],
  ['Cliente Ficticio B', 'Grimm', 'EDM 180C', '18A00002', '2025-06-01', '18A00002'],
  ['Cliente Ficticio H', 'HORIBA', 'APNA 370', 'HB-0001', '2025-10-22'], // el nombre corto de la Excel: en Desk 2.0 es la razón social
  ['Cliente Ficticio H', 'Horiba', 'APSA-370', 'HB-0002', '2024-01-01'], // con un ticket calibrado después
  ['Cliente Ficticio J', 'Horiba', 'APNA-370', 'HB-0005', '2025-03-03'], // en Desk 2.0, dos veces
  ['Cliente Ficticio N', 'Horiba', 'APNA-370', 123, '2025-04-04'], // numérico: en Desk 2.0 es 00123
  ['Cliente Ficticio K', 'Kunak', 'AIR Pro', 'KN-0001', null], // inactivo en Desk 2.0
  ['Cliente Ficticio T', 'Thermo', '49i', 'TH-0001', '2025-05-05'], // la marca no existe en Desk 2.0
];

/** El inventario en seguimiento ya sincronizado con su maestro (así una sincronización sólo trae otras marcas), la hoja, Desk 2.0 con varias marcas y los tickets. */
async function sembrar(): Promise<void> {
  await enPortal('18A00001', 'Cliente Ficticio A S.A.S.', '2025-10-20', 'eq-1');
  await enPortal('18A00002', 'Cliente Ficticio B', '2025-06-01', 'eq-2');
  await hub.query(`INSERT INTO portal.tmc_seguimiento (clave, aviso_enviado, nota, actualizado_por, actualizado_en) VALUES ('18A00002', '2026-09-01', 'nota ficticia', 'tecnico@example.com', '2026-09-01T00:00:00Z')`);
  await hub.query(`INSERT INTO portal.tmc_contactos (clave, cliente, emails, nombre, actualizado_por, actualizado_en) VALUES ('cliente ficticio h s.a.s.', 'Cliente Ficticio H S.A.S.', '{calidad@cliente-h.example}', 'Hugo Ficticio', 'comercial@example.com', '2026-09-01T00:00:00Z')`);
  await hub.query(
    `INSERT INTO desk.tickets (number, subject, status, status_type, serial, codigo_servicio, tipo_servicio, created_time, fecha_creacion_ticket, synced_at, raw)
     VALUES (700, 'CAL_HB-0001 asunto ficticio', 'En proceso', 'Open', 'HB-0001', 'CAL_HB-0001', 'Calibración', '2026-10-01T15:00:00Z', '2026-10-01', NOW(), '{"email": "laboratorio@cliente-h.example", "contact": {"firstName": "Eva", "lastName": "Ficticia"}}'::jsonb)`,
  );
  await enDesk('eq-1', '18A00001', 'GRIMM', 'EDM180C', 'Cliente Ficticio A S.A.S.');
  await enDesk('eq-2', '18A00002', 'GRIMM', 'EDM180C', 'Cliente Ficticio B');
  await enDesk('eq-g', '28A00001', 'GRIMM', 'EDM 280', 'Cliente Ficticio A S.A.S.'); // un GRIMM de otro modelo, que la hoja no tiene
  await enDesk('eq-h1', 'HB-0001', 'Horiba', 'APNA-370', 'Cliente Ficticio H S.A.S.');
  await enDesk('eq-h2', ' hb-0002 ', 'Horiba', 'APSA-370', 'Cliente Ficticio H S.A.S.');
  await enDesk('eq-h5a', 'HB-0005', 'Horiba', 'APNA-370', 'Cliente Ficticio J S.A.S.');
  await enDesk('eq-h5b', 'HB-0005', 'Horiba', 'APNA-370', 'Cliente Ficticio Otro');
  await enDesk('eq-k', 'KN-0001', 'Kunak', 'AIR Pro', 'Cliente Ficticio K', false);
  await enDesk('eq-n', '00123', 'Horiba', 'APNA-370', 'Cliente Ficticio N S.A.S.');
  await ticketCalibrado(1001, '18A00001', 'eq-1', '2026-09-20');
  await ticketCalibrado(1005, 'HB-0002', 'eq-h2', '2026-06-30');
  const { rows } = await hub.query(
    `INSERT INTO portal.tmc_fst022_congelaciones (archivo, sha256, hoja, fila_cabecera, cabeceras, total_filas, total_columnas, filas_guardadas, filas_equipo, filas_con_serial, filas_edm180, problemas, por, en)
     VALUES ('F-ST-022 ficticia V3.xlsx', $1, 'Trazabilidad', 5, $2::jsonb, 13, 6, 9, 8, 8, 2, '{}'::jsonb, 'director@example.com', '2026-10-10T15:00:00Z') RETURNING id`,
    ['ab'.repeat(32), JSON.stringify([CABECERA])],
  );
  const datos = HOJA.map(([cliente, marca, modelo, serial, fecha, clave], i) => ({ fila: 6 + i, celdas: [cliente, marca, modelo, serial, fecha ? { v: fecha, t: 'fecha' } : null, 357], serial_norm: String(serial).toUpperCase(), clave_equipo: clave ?? null }));
  await hub.query(
    `INSERT INTO portal.tmc_fst022_congelada (congelacion_id, fila, celdas, es_equipo, serial_norm, clave_equipo)
     SELECT $1, x.fila, x.celdas, true, x.serial_norm, x.clave_equipo FROM jsonb_to_recordset($2::jsonb) AS x(fila int, celdas jsonb, serial_norm text, clave_equipo text)`,
    [rows[0].id, JSON.stringify(datos)],
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;
const equipos = async () => (await hub.query(`SELECT clave, serial, cliente, marca, modelo, ultima_calibracion::text AS calibracion, activo, desk_id, origen, en_seguimiento, actualizado_en::text AS actualizado_en FROM portal.tmc_equipos ORDER BY en_seguimiento DESC, clave`)).rows as Fila[];
const auditoria = async () => (await hub.query(`SELECT recuentos, cambios, por FROM portal.tmc_maestro_sincronizaciones ORDER BY id`)).rows as Fila[];
const calibraciones = async () => (await hub.query(`SELECT clave, serial, fecha::text AS fecha, origen, ticket, estado FROM portal.tmc_calibraciones ORDER BY id`)).rows as Fila[];
const pedir = (ruta: string, quien = comoLector) => request(api).get(`/api/trazabilidad/${ruta}`).set(quien);
/** Lo que alimenta Resumen, Equipos, Calendario, Avisos, su simulación, contactos y Servicios, como texto. */
async function fotoApp(): Promise<Record<string, string>> {
  const [eq, servicios] = await Promise.all([pedir(`equipos?hoy=${HOY}`), pedir(`servicios?hoy=${HOY}`)]);
  expect([eq.status, servicios.status]).toEqual([200, 200]);
  return { equipos: JSON.stringify(eq.body), avisos: JSON.stringify(planAvisos(eq.body.equipos, HOY, eq.body.contactos)), servicios: JSON.stringify(servicios.body), seguimiento: JSON.stringify((await hub.query(`SELECT * FROM portal.tmc_seguimiento ORDER BY clave`)).rows), contactos: JSON.stringify((await hub.query(`SELECT * FROM portal.tmc_contactos ORDER BY clave`)).rows) };
}
const hoja = async () => leerHoja(hub, HOY);

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
  await hub?.query(`TRUNCATE portal.tmc_calibraciones, portal.tmc_calibraciones_pasadas, portal.tmc_fst022_congelaciones RESTART IDENTITY CASCADE`);
  await Promise.all([lector?.end(), admin2?.end(), hub?.end()]);
});
beforeEach(async () => {
  await hub.query(`TRUNCATE desk.tickets, portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_contactos, portal.tmc_maestro_sincronizaciones, portal.tmc_calibraciones, portal.tmc_calibraciones_pasadas, portal.tmc_estados_historial, portal.tmc_fst022_congelaciones RESTART IDENTITY CASCADE`);
  await admin2.query('TRUNCATE desk.equipos, desk.tickets, desk.ticket_transitions RESTART IDENTITY');
  await sembrar();
});

const OTRAS = { maestro: 7, portal: 0, casan: 0, cambios: { cliente: 0, modelo: 0, serial: 0, activo: 0 }, altas: 4, soloPortal: 0, ambiguos: 2, sinSerial: 0, inactivos: 1, retiradosAMano: 0 };
const CRUCE = [
  { marca: 'Grimm', filas: 2, enlazadas: 2, soloHoja: 0, sinCeros: 0, repetidas: 0 },
  { marca: 'HORIBA', filas: 4, enlazadas: 2, soloHoja: 1, sinCeros: 1, repetidas: 1 },
  { marca: 'Kunak', filas: 1, enlazadas: 0, soloHoja: 1, sinCeros: 0, repetidas: 0 },
  { marca: 'Thermo', filas: 1, enlazadas: 0, soloHoja: 1, sinCeros: 0, repetidas: 0 },
];

describe('el plan con las otras marcas', () => {
  it('dos ámbitos y el cruce con la hoja, en recuentos: a un Lector no le llega ni un cliente ni un serial; leerlo no escribe', async () => {
    const antes = await equipos();
    const res = await pedir('maestro/plan');
    expect(res.status).toBe(200);
    expect(res.body.plan.recuentos).toMatchObject({ maestro: 2, portal: 2, casan: 2, enlaces: 0, altas: 0, cambios: { cliente: 0, modelo: 0, serial: 0, activo: 0 }, soloPortal: 0, clienteOtroNombre: 0, contactosSinEquipos: 0 });
    expect(res.body.plan.otras).toEqual(OTRAS);
    expect(res.body.plan.hoja).toEqual(CRUCE);
    expect(Object.keys(res.body).sort()).toEqual(['maestro', 'plan', 'ultima']);
    expect(JSON.stringify(res.body)).not.toMatch(/Ficticio|HB-|18A0|28A0|eq-|00123/);
    expect([await equipos(), await auditoria()]).toEqual([antes, []]);
  });

  it('a quien puede sincronizar le llega además, aparte, el detalle de las otras marcas: altas, ambiguos y las filas de la hoja que no se enlazan, con lo delicado primero', async () => {
    const res = await pedir('maestro/plan', comoAdmin);
    expect([res.body.detalle, res.body.detalleTotal]).toEqual([[], 0]); // el del seguimiento, como siempre: aquí no hay nada pendiente
    expect(res.body.otras.detalleTotal).toBe(4);
    expect(res.body.otras.detalle).toEqual([
      { clave: '28A00001', campo: 'alta', antes: null, despues: '28A00001 · Cliente Ficticio A S.A.S.', ambito: 'otras' },
      { clave: 'HB-0001', campo: 'alta', antes: null, despues: 'HB-0001 · Cliente Ficticio H S.A.S.', ambito: 'otras' },
      { clave: 'hb-0002', campo: 'alta', antes: null, despues: 'hb-0002 · Cliente Ficticio H S.A.S.', ambito: 'otras' },
      { clave: '00123', campo: 'alta', antes: null, despues: '00123 · Cliente Ficticio N S.A.S.', ambito: 'otras' },
    ]);
    expect(res.body.otras.ambiguos).toEqual([
      { origen: 'desk', clave: 'eq-h5a', serial: 'HB-0005', cliente: 'Cliente Ficticio J S.A.S.', activo: true },
      { origen: 'desk', clave: 'eq-h5b', serial: 'HB-0005', cliente: 'Cliente Ficticio Otro', activo: true },
    ]);
    expect(res.body.otras.soloPortal).toEqual([]);
    expect(res.body.otras.hoja).toEqual([
      { motivo: 'repetido', marca: 'Horiba', serial: 'HB-0005', cliente: 'Cliente Ficticio J' },
      { motivo: 'sin_ceros', marca: 'Horiba', serial: '123', cliente: 'Cliente Ficticio N' },
      { motivo: 'solo_hoja', marca: 'Kunak', serial: 'KN-0001', cliente: 'Cliente Ficticio K' },
      { motivo: 'solo_hoja', marca: 'Thermo', serial: 'TH-0001', cliente: 'Cliente Ficticio T' },
    ]);
  });
});

describe('aplicar', () => {
  it('da de alta las otras marcas FUERA de seguimiento, enlazadas, con lo del maestro tal cual y sin fecha; no toca lo que está en seguimiento, y la auditoría distingue el ámbito', async () => {
    const antes = await equipos();
    const s = await sincronizar((await plan()).plan!.huella);
    expect(s.recuentos).toMatchObject({ casan: 2, altas: 0, otras: OTRAS });

    const despues = await equipos();
    expect(despues.slice(0, 2)).toEqual(antes); // los dos GRIMM EDM 180: ni su fecha de cambio
    expect(despues.slice(2).map((e) => [e.clave, e.serial, e.cliente, e.marca, e.modelo, e.calibracion, e.activo, e.desk_id, e.origen, e.en_seguimiento])).toEqual([
      ['00123', '00123', 'Cliente Ficticio N S.A.S.', 'Horiba', 'APNA-370', null, true, 'eq-n', 'desk', false],
      ['28A00001', '28A00001', 'Cliente Ficticio A S.A.S.', 'GRIMM', 'EDM 280', null, true, 'eq-g', 'desk', false],
      ['HB-0001', 'HB-0001', 'Cliente Ficticio H S.A.S.', 'Horiba', 'APNA-370', null, true, 'eq-h1', 'desk', false],
      ['hb-0002', 'hb-0002', 'Cliente Ficticio H S.A.S.', 'Horiba', 'APSA-370', null, true, 'eq-h2', 'desk', false],
    ]);
    const [fila] = await auditoria();
    expect(fila).toMatchObject({ por: 'director@example.com', recuentos: { casan: 2, otras: OTRAS } });
    expect(fila.cambios.map((c: Fila) => [c.clave, c.campo, c.ambito])).toEqual([['28A00001', 'alta', 'otras'], ['HB-0001', 'alta', 'otras'], ['hb-0002', 'alta', 'otras'], ['00123', 'alta', 'otras']]);
  });

  it('BLINDAJE con la sincronización de verdad: GET /equipos, el plan de avisos, GET /servicios, el seguimiento y los contactos quedan idénticos byte a byte', async () => {
    await pedir(`servicios?hoy=${HOY}`); // la primera lectura apunta el historial de estados
    const antes = await fotoApp();
    expect(JSON.parse(antes.equipos).equipos).toHaveLength(2);
    await sincronizar();
    expect((await equipos()).filter((e) => !e.en_seguimiento)).toHaveLength(4);
    expect(await fotoApp()).toEqual(antes);
    expect((await repo.listarEquipos(hub, HOY)).map((e) => e.clave)).toEqual(['18A00001', '18A00002']);
  });

  it('idempotente: la segunda no cambia nada; y después se actualizan por su id de Desk 2.0 sin cambiar de clave ni de ámbito, aunque el maestro los dé como EDM 180', async () => {
    await sincronizar();
    const antes = await equipos();
    const otra = await plan();
    expect(otra.plan!.otras).toEqual({ ...OTRAS, portal: 4, casan: 4, altas: 0 });
    expect([otra.otras!.detalle, otra.plan!.hoja]).toEqual([[], CRUCE]);
    await sincronizar(otra.plan!.huella);
    expect(await equipos()).toEqual(antes);
    expect((await auditoria()).map((a) => a.cambios.length)).toEqual([4, 0]);

    await admin2.query(`UPDATE desk.equipos SET modelo = 'EDM180C', cliente_nombre = 'Cliente Ficticio A Norte S.A.S.' WHERE id = 'eq-g'`);
    await admin2.query(`UPDATE desk.equipos SET active = false WHERE id = 'eq-h1'`);
    const s = await sincronizar();
    expect(s.recuentos).toMatchObject({ maestro: 2, casan: 2, altas: 0, clienteOtroNombre: 0, otras: { casan: 4, altas: 0, cambios: { cliente: 1, modelo: 1, serial: 0, activo: 1 } } });
    const de = async (clave: string) => (await equipos()).find((e) => e.clave === clave);
    expect(await de('28A00001')).toMatchObject({ modelo: 'EDM180C', cliente: 'Cliente Ficticio A Norte S.A.S.', en_seguimiento: false, desk_id: 'eq-g' });
    expect(await de('HB-0001')).toMatchObject({ activo: false, en_seguimiento: false });
    expect((await repo.listarEquipos(hub, HOY)).map((e) => e.clave)).toEqual(['18A00001', '18A00002']);
  });

  it('todo o nada: si la base falla a mitad, no queda ni un equipo de otra marca ni la auditoría', async () => {
    const antes = await equipos();
    const rota = {
      query: hub.query.bind(hub),
      connect: async () => {
        const c = await hub.connect();
        return { query: (sql: string, p?: unknown[]) => (/INSERT INTO portal\.tmc_maestro_sincronizaciones/.test(sql) ? Promise.reject(new Error('la base falló')) : c.query(sql, p)), release: () => c.release() };
      },
    } as unknown as Pool;
    await expect(sincronizarMaestro(rota, maestro(), null, actor)).rejects.toThrow('la base falló');
    expect([await equipos(), await auditoria()]).toEqual([antes, []]);
  });

  it('sin Desk 2.0 (sin la variable, o en respaldo) no escribe: 409 y la base como estaba', async () => {
    const antes = await equipos();
    await expect(sincronizarMaestro(hub, crearLectorMaestro(() => null), null, actor)).rejects.toMatchObject({ status: 409, code: 'maestro_no_disponible' });
    expect([await equipos(), await auditoria()]).toEqual([antes, []]);
  });

  it('por la ruta: 403 para un Lector, sin tocar nada; quien puede lo aplica', async () => {
    const antes = await equipos();
    const no = await request(api).post('/api/trazabilidad/maestro/sincronizar').set(comoLector).send({});
    expect([no.status, no.body.error]).toEqual([403, 'forbidden_role']);
    expect(await equipos()).toEqual(antes);
    const si = await request(api).post('/api/trazabilidad/maestro/sincronizar').set(comoAdmin).send({});
    expect([si.status, si.body.recuentos.otras.altas]).toEqual([200, 4]);
  });
});

describe('la pestaña «Trazabilidad F-ST-022» y las calibraciones, antes y después de enlazar', () => {
  const traer = () => sincronizarCalibraciones(hub, tickets(), null, actor, HOY);
  const fechas = (h: Awaited<ReturnType<typeof hoja>>) => h.filas.map((f) => [f.fila, f.ultimaCalibracion, f.estado, f.calibraciones.find((c) => c.cuenta)?.origen ?? null]);

  it('una fila enlazada enseña cliente, marca, modelo y serial del maestro, con lo de la hoja debajo sólo si es otra cosa, y pasa a «enlazado»; su última calibración es la MISMA que antes', async () => {
    await traer(); // las calibraciones de los tickets ya estaban traídas: la de HB-0002, sin clave
    const antes = await hoja();
    expect(antes.filas.map((f) => [f.fila, f.situacion, f.cliente])).toEqual([[6, 'inventario', 'Cliente Ficticio A S.A.S.'], [7, 'inventario', 'Cliente Ficticio B'], [8, 'hoja', 'Cliente Ficticio H'], [9, 'hoja', 'Cliente Ficticio H'], [10, 'hoja', 'Cliente Ficticio J'], [11, 'hoja', 'Cliente Ficticio N'], [12, 'hoja', 'Cliente Ficticio K'], [13, 'hoja', 'Cliente Ficticio T']]);
    expect(fechas(antes).slice(2, 4)).toEqual([[8, '2025-10-22', 'VENCE_30', 'fst022'], [9, '2026-06-30', 'AL_DIA', 'desk']]);

    await sincronizar();
    const despues = await hoja();
    expect(despues.filas.map((f) => [f.fila, f.situacion, f.clave, f.cliente, f.marca, f.modelo, f.serial, f.enHoja])).toEqual([
      [6, 'inventario', '18A00001', 'Cliente Ficticio A S.A.S.', 'GRIMM', 'EDM 180C', '18A00001', { cliente: 'Cliente Ficticio A', marca: 'Grimm', ultimaCalibracion: '2025-10-20' }],
      [7, 'inventario', '18A00002', 'Cliente Ficticio B', 'GRIMM', 'EDM 180C', '18A00002', { marca: 'Grimm' }],
      // La razón social del maestro; «HORIBA» / «Horiba» y «APNA 370» / «APNA-370» son lo mismo escrito de otra forma: no se repiten debajo.
      [8, 'enlazado', 'HB-0001', 'Cliente Ficticio H S.A.S.', 'Horiba', 'APNA-370', 'HB-0001', { cliente: 'Cliente Ficticio H' }],
      [9, 'enlazado', 'hb-0002', 'Cliente Ficticio H S.A.S.', 'Horiba', 'APSA-370', 'hb-0002', { cliente: 'Cliente Ficticio H', serial: 'HB-0002', ultimaCalibracion: '2024-01-01' }],
      [10, 'hoja', null, 'Cliente Ficticio J', 'Horiba', 'APNA-370', 'HB-0005', {}],
      [11, 'hoja', null, 'Cliente Ficticio N', 'Horiba', 'APNA-370', '123', {}],
      [12, 'hoja', null, 'Cliente Ficticio K', 'Kunak', 'AIR Pro', 'KN-0001', {}],
      [13, 'hoja', null, 'Cliente Ficticio T', 'Thermo', '49i', 'TH-0001', {}],
    ]);
    expect(fechas(despues)).toEqual(fechas(antes));
    // Con la marca y el modelo del maestro, la fila deja de desentonar con las de su marca; los demás avisos no se mueven.
    expect([antes.filas[2].avisos, despues.filas[2].avisos]).toEqual([['marca_distinta', 'modelo_distinto'], []]);
    expect(despues.filas.slice(3).map((f) => f.avisos)).toEqual(antes.filas.slice(3).map((f) => f.avisos));
    // Lo que el maestro tiene y la hoja no, aparte y diciendo que está fuera de seguimiento.
    expect(despues.fueraDeHoja.map((f) => [f.clave, f.situacion, f.marca])).toEqual([['28A00001', 'enlazado', 'GRIMM'], ['00123', 'enlazado', 'Horiba']]);
    expect(despues.resumen).toMatchObject({ total: 8, enInventario: 2, inactivos: 0, soloHoja: 4, fueraDeHoja: 2, calibracionesSueltas: 0 });
    expect(despues.resumen.porEstado).toEqual(antes.resumen.porEstado);
  });

  it('traer las calibraciones después de enlazar no les da punto de partida ni les re-enlaza nada: siguen por serial, sin clave, y la pestaña dice lo mismo', async () => {
    await traer();
    const guardadas = await calibraciones();
    expect(guardadas.map((c) => `${c.clave} · ${c.origen} · ${c.ticket}`).sort()).toEqual(['18A00001 · desk · 1001', '18A00001 · fst022 · null', '18A00002 · fst022 · null', 'null · desk · 1005']);
    await sincronizar();
    const antes = fechas(await hoja());
    const p = await leerPlanCalibraciones(hub, tickets(), HOY, true);
    expect(p.plan!.recuentos).toMatchObject({ nuevas: 0, sinCambios: 2, reenlazadas: 0, partida: 0, cambiadas: 0, vaciadas: 0, equiposCambian: 0 });
    expect(p.detalle).toEqual([]);
    await traer();
    expect(await calibraciones()).toEqual(guardadas);
    expect(fechas(await hoja())).toEqual(antes);
  });

  it('si las calibraciones aún no se habían traído, enlazar tampoco mueve la fecha de la fila: vale la de la hoja', async () => {
    const antes = fechas(await hoja());
    expect(antes.slice(2, 4)).toEqual([[8, '2025-10-22', 'VENCE_30', 'fst022'], [9, '2024-01-01', 'FUERA_CICLO', 'fst022']]);
    await sincronizar();
    expect(fechas(await hoja())).toEqual(antes);
  });
});
