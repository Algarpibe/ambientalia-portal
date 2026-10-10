import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { crearPoolDesk2 } from '../db-desk2.js';
import { COLUMNAS_EQUIPOS_LECTOR, asegurarDesk2, asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import { crearFuenteAgenda } from './fuente.js';
import { crearLectorMaestro, leerEquiposDesk2 } from './maestro-desk2.js';
import { leerCruceFst022, leerPlanMaestro, sincronizarMaestro } from './maestro-repo.js';
import { TzError } from './types.js';

// El maestro de equipos (lote 9b) contra Postgres: la 056, el permiso por
// columnas del rol lector sobre `desk.equipos` en la imitación de Desk 2.0,
// el plan, aplicarlo (todo o nada, idempotente, uno detrás de otro), que sin
// maestro no se escribe y que un fallo del maestro no mueve la agenda de la
// principal. Las rutas son las de verdad; sólo la sesión es un doble.
// Clientes y seriales inventados (el repo es público).

const SECRET = 'test-secret-maestro';
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

let hub: Pool;
let admin2: Pool;
let lector: Pool;
let caida: Pool; // una Desk 2.0 configurada que no contesta: puerto cerrado
let api: express.Express;

const ROL_LECTOR = 'agenda_lector_prueba';
const HOY = '2026-10-10';
const actor = { userId: ADMIN, email: 'director@example.com' };
const SQL_056 = readFileSync(fileURLToPath(new URL('../users/migrations/056_trazabilidad_maestro_equipos.sql', import.meta.url)), 'utf8');
const cabecera = (userId: string, correo: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: correo, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' })}` });
const comoAdmin = cabecera(ADMIN, 'admin@example.com');
const comoLector = cabecera('00000000-0000-4000-8000-0000000000b2', 'lector@example.com');

const maestro = () => crearLectorMaestro(() => lector);
const sinVariable = crearLectorMaestro(() => null);
const maestroCaido = () => crearLectorMaestro(() => caida);
const sincronizar = (huella: string | null = null) => sincronizarMaestro(hub, maestro(), huella, actor);
const plan = async () => (await leerPlanMaestro(hub, maestro(), true)).plan!;

const enPortal = (serial: string, cliente: string, calibracion: string | null, extra: { clave?: string; activo?: boolean } = {}) =>
  hub.query(
    `INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, hoja_vida, ultima_calibracion, activo, actualizado_en)
     VALUES ($1, $2, $3, 'Grimm', 'EDM 180C', $4, $5, $6, '2026-01-01T00:00:00Z')`,
    [extra.clave ?? serial, serial, cliente, `HV_${serial}`, calibracion, extra.activo ?? true],
  );
const enDesk = (id: string, serial: string, cliente: string | null, extra: { marca?: string; modelo?: string; activo?: boolean } = {}) =>
  admin2.query(`INSERT INTO desk.equipos (id, serial, marca, modelo, cliente_nombre, active, raw) VALUES ($1, $2, $3, $4, $5, $6, '{"reservado": "no se lee"}')`, [
    id,
    serial,
    extra.marca ?? 'GRIMM',
    extra.modelo ?? 'EDM180C',
    cliente,
    extra.activo ?? true,
  ]);

/** El inventario de partida y un maestro que no coincide del todo con él. */
async function sembrar(): Promise<void> {
  await enPortal('18A00001', 'Cliente Ficticio A', '2025-10-17');
  await enPortal('18A00002', 'Cliente Ficticio B', '2025-06-01');
  await enPortal('18A00003', 'Cliente Ficticio C', '2025-12-01');
  await enPortal('18A00004', 'Cliente Ficticio E', '2024-03-26');
  await enPortal('18A00004', 'Cliente Ficticio F', '2024-03-26', { clave: '18A00004-2' });
  await enPortal('18A00050', 'Cliente Ficticio G', '2025-02-02');
  await repo.guardarSeguimiento(hub, '18A00001', { enAmbientalia: false, avisoEnviado: '2026-09-01', servicioProgramado: null, nota: 'llamar a Ana' }, actor);
  await repo.guardarSeguimiento(hub, '18A00002', { enAmbientalia: true, avisoEnviado: null, servicioProgramado: null, nota: 'en el taller' }, actor);
  await repo.guardarContacto(hub, { cliente: 'Cliente Ficticio A', emails: ['compras@cliente-a.example'], nombre: 'Ana Ruiz' }, actor);
  await enDesk('eq-1', ' 18a00001 ', 'Cliente Ficticio Z'); // cambia de cliente y de escritura del serial
  await enDesk('eq-2', '18A00002', 'Cliente Ficticio B', { activo: false }); // inactivo en el maestro
  await enDesk('eq-3', '18A00003', 'Cliente Ficticio C S.A.S.', { modelo: 'EDM180D' }); // renombrado y otro modelo
  await enDesk('eq-4', '18A00004', 'Cliente Ficticio E'); // ambiguo: el portal lo tiene dos veces
  await enDesk('eq-9', '18A00009', 'Cliente Ficticio D', { modelo: 'EDM180D' }); // sólo en Desk 2.0
  await enDesk('eq-h', 'HB-0001', 'Cliente Ficticio H', { marca: 'Horiba', modelo: 'APNA-370' }); // otra marca: no entra
}

const FOTO = `clave, serial, cliente, marca, modelo, hoja_vida, ultima_calibracion::text AS calibracion, activo, desk_id, origen, actualizado_en::text AS actualizado_en`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;
const foto = async (extra = '') => (await hub.query(`SELECT ${FOTO}${extra} FROM portal.tmc_equipos ORDER BY clave`)).rows as Fila[];
const auditoria = async () => (await hub.query(`SELECT id, huella, recuentos, cambios, por_id, por FROM portal.tmc_maestro_sincronizaciones ORDER BY id`)).rows as Fila[];
const loDemas = async () => [(await hub.query(`SELECT * FROM portal.tmc_seguimiento ORDER BY clave`)).rows, (await hub.query(`SELECT * FROM portal.tmc_contactos ORDER BY clave`)).rows];

beforeAll(async () => {
  hub = poolDePrueba();
  await asegurarDeskTickets(hub);
  const urls = await asegurarDesk2(hub);
  admin2 = createPoolFromUrl(urls.urlAdmin);
  lector = crearPoolDesk2(urls.urlLector);
  const muerta = new URL(urls.urlLector);
  muerta.port = '1';
  caida = crearPoolDesk2(muerta.toString(), { conexionMs: 2_000 });
  api = express();
  api.use(express.json());
  api.use('/api', createTrazabilidadRouter(hub, crearFuenteAgenda({ hub, desk2: () => lector }), maestro()));
});
afterAll(async () => {
  await Promise.all([caida?.end(), lector?.end(), admin2?.end(), hub?.end()]);
});
beforeEach(async () => {
  await hub.query(`TRUNCATE desk.tickets, portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_contactos, portal.tmc_maestro_sincronizaciones, portal.tmc_fst022_congelaciones RESTART IDENTITY CASCADE`);
  await admin2.query('TRUNCATE desk.equipos, desk.tickets, desk.ticket_transitions RESTART IDENTITY');
});

describe('migración 056', () => {
  it('ejecutarla otra vez (cada arranque) no toca el inventario, sus enlaces ni la auditoría', async () => {
    await sembrar();
    await sincronizar();
    const antes = [await foto(', maestro_en::text AS maestro_en'), await auditoria()];
    await hub.query(SQL_056);
    await hub.query(SQL_056);
    expect([await foto(', maestro_en::text AS maestro_en'), await auditoria()]).toEqual(antes);
  });

  it('lo que ya había nace con origen «fst022» y sin enlazar; el origen sólo admite sus dos valores y un equipo de Desk 2.0 va en una sola fila', async () => {
    await enPortal('18A00001', 'Cliente Ficticio A', null);
    await enPortal('18A00002', 'Cliente Ficticio B', null);
    expect((await hub.query(`SELECT origen, desk_id, maestro_en FROM portal.tmc_equipos`)).rows).toEqual(Array(2).fill({ origen: 'fst022', desk_id: null, maestro_en: null }));
    await expect(hub.query(`UPDATE portal.tmc_equipos SET origen = 'excel'`)).rejects.toThrow(/check/i);
    await expect(hub.query(`UPDATE portal.tmc_equipos SET desk_id = 'eq-1'`)).rejects.toThrow(/tmc_equipos_desk_id_uq/);
  });
});

describe('leer el maestro de Desk 2.0', () => {
  beforeEach(sembrar);

  it('trae todos los equipos con lo que el portal usa, por el rol de sólo lectura', async () => {
    const equipos = await leerEquiposDesk2(lector);
    expect(equipos).toHaveLength(6);
    expect(equipos[0]).toEqual({ id: 'eq-1', serial: ' 18a00001 ', marca: 'GRIMM', modelo: 'EDM180C', cliente: 'Cliente Ficticio Z', activo: true });
    await expect(lector.query(`UPDATE desk.equipos SET active = false`)).rejects.toThrow(/read-only|permission denied/i);
  });

  it('el permiso es por columnas: `raw`, un `*` o la fila entera fallan con el rol lector, y las concedidas no', async () => {
    for (const sql of ['SELECT raw FROM desk.equipos', 'SELECT * FROM desk.equipos', 'SELECT to_jsonb(e) FROM desk.equipos e']) {
      await expect(lector.query(sql)).rejects.toMatchObject({ code: '42501' });
    }
    expect((await lector.query(`SELECT ${COLUMNAS_EQUIPOS_LECTOR} FROM desk.equipos`)).rows).toHaveLength(6);
  });

  it('no lanza: sin la variable, con Desk 2.0 caído o sin el permiso dice por qué, con un motivo de la lista', async () => {
    expect(await sinVariable()).toEqual({ disponible: false, motivo: 'sin_variable' });
    const caido = await maestroCaido()();
    expect(caido.disponible).toBe(false);
    expect(['error_conexion', 'timeout']).toContain((caido as { motivo: string }).motivo);
  });

  it('si al rol le falta el permiso de equipos, el maestro no está disponible y la AGENDA sigue en la principal, sin abrir su cortacircuitos', async () => {
    const fuente = crearFuenteAgenda({ hub, desk2: () => lector });
    await admin2.query(`REVOKE ALL ON desk.equipos FROM ${ROL_LECTOR}`);
    try {
      expect(await maestro()()).toEqual({ disponible: false, motivo: 'error_consulta' });
      expect(await leerPlanMaestro(hub, maestro(), true)).toMatchObject({ maestro: { disponible: false, motivo: 'error_consulta' }, plan: null });
      await expect(sincronizar()).rejects.toMatchObject({ status: 409, code: 'maestro_no_disponible' });
      expect(await fuente.estadoFuente()).toMatchObject({ fuente: 'principal', motivo: null, ultimoFalloPrincipal: null, cortacircuitosHasta: null });
      expect((await fuente.abiertosConOrigen()).fuente).toBe('principal');
      const res = await request(api).get('/api/trazabilidad/agenda/fuente').set(comoLector);
      expect([res.status, res.body.fuente]).toEqual([200, 'principal']);
    } finally {
      await admin2.query(`GRANT SELECT (${COLUMNAS_EQUIPOS_LECTOR}) ON desk.equipos TO ${ROL_LECTOR}`);
    }
    expect(await auditoria()).toEqual([]);
  });
});

describe('el plan y su aplicación', () => {
  beforeEach(sembrar);

  const ESPERADO = {
    maestro: 5, portal: 6, casan: 3, enlaces: 3, cambios: { cliente: 2, modelo: 1, serial: 1, activo: 1 }, altas: 1, soloPortal: 1, soloPortalActivos: 1,
    ambiguosMaestro: 1, ambiguosPortal: 2, sinSerial: 0, inactivos: 1, cambianDeCliente: 2, contactosSinEquipos: 1,
  };

  it('el plan, en recuentos, y su detalle; leerlo no escribe nada', async () => {
    const antes = [await foto(), await loDemas()];
    const r = await leerPlanMaestro(hub, maestro(), true);
    expect(r.maestro).toEqual({ disponible: true, motivo: null, mensaje: null });
    expect(r.plan!.recuentos).toEqual(ESPERADO);
    expect(r.plan!.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(r.ultima).toBeNull();
    expect(r.detalleTotal).toBe(6);
    expect(r.detalle).toContainEqual({ clave: '18A00001', campo: 'cliente', antes: 'Cliente Ficticio A', despues: 'Cliente Ficticio Z' });
    expect(await leerPlanMaestro(hub, maestro(), false)).not.toHaveProperty('detalle');
    expect([await foto(), await loDemas(), await auditoria()]).toEqual([...antes, []]);
  });

  it('aplicar: enlaza y actualiza los que casan, da de alta sin fecha, y no toca los ambiguos, lo que sólo está en el portal, la fecha de calibración, el seguimiento ni los contactos', async () => {
    const [antes, demas] = [await foto(), await loDemas()];
    const s = await sincronizar((await plan()).huella);
    expect(s).toMatchObject({ id: 1, por: 'director@example.com', recuentos: ESPERADO });

    const despues = await foto();
    const de = (clave: string) => despues.find((e) => e.clave === clave);
    expect(de('18A00001')).toMatchObject({ serial: '18a00001', cliente: 'Cliente Ficticio Z', modelo: 'EDM 180C', activo: true, desk_id: 'eq-1', origen: 'desk', calibracion: '2025-10-17', hoja_vida: 'HV_18A00001', marca: 'Grimm' });
    expect(de('18A00002')).toMatchObject({ activo: false, desk_id: 'eq-2', origen: 'desk', calibracion: '2025-06-01' });
    expect(de('18A00003')).toMatchObject({ cliente: 'Cliente Ficticio C S.A.S.', modelo: 'EDM 180D', desk_id: 'eq-3', calibracion: '2025-12-01' });
    expect(de('18A00009')).toMatchObject({ serial: '18A00009', cliente: 'Cliente Ficticio D', marca: 'GRIMM', modelo: 'EDM 180D', activo: true, desk_id: 'eq-9', origen: 'desk', calibracion: null, hoja_vida: null });
    // Ni los ambiguos ni el que sólo está en el portal: tal cual, fecha de cambio incluida.
    for (const clave of ['18A00004', '18A00004-2', '18A00050']) expect(de(clave)).toEqual(antes.find((e) => e.clave === clave));
    expect(despues.map((e) => e.clave)).toEqual(['18A00001', '18A00002', '18A00003', '18A00004', '18A00004-2', '18A00009', '18A00050']);
    expect(await loDemas()).toEqual(demas);

    // La auditoría: quién, la huella, los recuentos y cada cambio con su antes y su después.
    const [fila] = await auditoria();
    expect(fila).toMatchObject({ por_id: ADMIN, por: 'director@example.com', recuentos: ESPERADO, huella: s.huella });
    expect(fila.cambios).toEqual([
      { clave: '18A00001', campo: 'cliente', antes: 'Cliente Ficticio A', despues: 'Cliente Ficticio Z' },
      { clave: '18A00001', campo: 'serial', antes: '18A00001', despues: '18a00001' },
      { clave: '18A00002', campo: 'activo', antes: 'sí', despues: 'no' },
      { clave: '18A00003', campo: 'cliente', antes: 'Cliente Ficticio C', despues: 'Cliente Ficticio C S.A.S.' },
      { clave: '18A00003', campo: 'modelo', antes: 'EDM 180C', despues: 'EDM 180D' },
      { clave: '18A00009', campo: 'alta', antes: null, despues: '18A00009 · Cliente Ficticio D' },
    ]);
  });

  it('el inventario de la app lo refleja: cliente nuevo, alta «sin fecha», el inactivo fuera y el seguimiento donde estaba (el contacto puesto a mano va por cliente: ya no le llega al equipo que cambió)', async () => {
    await sincronizar();
    const equipos = await repo.listarEquipos(hub, HOY);
    expect(equipos.map((e) => e.clave)).toEqual(['18A00003', '18A00009', '18A00004', '18A00004-2', '18A00050', '18A00001']);
    expect(equipos.find((e) => e.clave === '18A00001')).toMatchObject({ cliente: 'Cliente Ficticio Z', estado: 'VENCE_30', contacto: null, seguimiento: { avisoEnviado: '2026-09-01', nota: 'llamar a Ana' } });
    expect(equipos.find((e) => e.clave === '18A00009')).toMatchObject({ estado: 'SIN_FECHA', ultimaCalibracion: null, seguimiento: null, modelo: 'EDM 180D' });
    expect((await repo.listarContactos(hub)).map((c) => c.cliente)).toEqual(['Cliente Ficticio A']);
    // El seguimiento del que quedó inactivo sigue guardado, por su clave.
    expect((await hub.query(`SELECT nota FROM portal.tmc_seguimiento WHERE clave = '18A00002'`)).rows).toEqual([{ nota: 'en el taller' }]);
  });

  it('idempotente: una segunda sincronización no cambia nada (sólo confirma) y deja su fila de auditoría, sin cambios', async () => {
    await sincronizar();
    const antes = [await foto(), await loDemas()];
    const otra = await leerPlanMaestro(hub, maestro(), true);
    expect(otra.plan!.recuentos).toMatchObject({ casan: 4, enlaces: 0, cambios: { cliente: 0, modelo: 0, serial: 0, activo: 0 }, altas: 0, cambianDeCliente: 0, contactosSinEquipos: 0, soloPortal: 1, ambiguosPortal: 2 });
    expect(otra.detalle).toEqual([]);
    expect(otra.ultima).toMatchObject({ id: 1, por: 'director@example.com' });
    const s = await sincronizar(otra.plan!.huella);
    expect(s.id).toBe(2);
    expect([await foto(), await loDemas()]).toEqual(antes);
    expect((await auditoria()).map((a) => a.cambios.length)).toEqual([6, 0]);
  });

  it('todo o nada: si la base falla a mitad, no queda ni un equipo cambiado ni la auditoría', async () => {
    const antes = await foto();
    const rota = {
      query: hub.query.bind(hub),
      connect: async () => {
        const c = await hub.connect();
        return { query: (sql: string, p?: unknown[]) => (/INSERT INTO portal\.tmc_maestro_sincronizaciones/.test(sql) ? Promise.reject(new Error('la base falló')) : c.query(sql, p)), release: () => c.release() };
      },
    } as unknown as Pool;
    await expect(sincronizarMaestro(rota, maestro(), null, actor)).rejects.toThrow('la base falló');
    expect([await foto(), await auditoria()]).toEqual([antes, []]);
  });

  it.each([
    ['sin la variable (o en respaldo: la réplica no tiene maestro)', () => sinVariable],
    ['con Desk 2.0 configurado pero caído', maestroCaido],
  ])('%s no escribe: 409 y la base como estaba', async (_nombre, lectorMaestro) => {
    const antes = [await foto(), await loDemas()];
    const e = await sincronizarMaestro(hub, lectorMaestro(), null, actor).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TzError);
    expect(e).toMatchObject({ status: 409, code: 'maestro_no_disponible' });
    expect((e as TzError).messageEs).toMatch(/No se ha sincronizado nada\.$/);
    expect((e as TzError).messageEs).not.toMatch(/postgres|127\.0\.0\.1|agenda_lector/i);
    expect([await foto(), await loDemas(), await auditoria()]).toEqual([...antes, []]);
  });

  it('si el plan cambió entre verlo y aplicarlo (alguien tocó Desk 2.0), 409 y no se aplica nada; con la huella de ahora, sí', async () => {
    const visto = (await plan()).huella;
    const antes = await foto();
    await admin2.query(`UPDATE desk.equipos SET cliente_nombre = 'Cliente Ficticio Y' WHERE id = 'eq-3'`);
    await expect(sincronizar(visto)).rejects.toMatchObject({ status: 409, code: 'plan_cambiado' });
    expect([await foto(), await auditoria()]).toEqual([antes, []]);
    await sincronizar((await plan()).huella);
    expect((await foto()).find((e) => e.clave === '18A00003')).toMatchObject({ cliente: 'Cliente Ficticio Y' });
  });

  it('dos a la vez van una detrás de otra: el alta entra una sola vez y la segunda no trae cambios; con la misma huella, la segunda es un 409', async () => {
    const [a, b] = await Promise.all([sincronizar(), sincronizar()]);
    expect([a.id, b.id].sort()).toEqual([1, 2]);
    expect((await foto()).filter((e) => e.desk_id === 'eq-9')).toHaveLength(1);
    expect((await auditoria()).map((x) => x.cambios.length)).toEqual([6, 0]);

    await admin2.query(`UPDATE desk.equipos SET cliente_nombre = 'Cliente Ficticio W' WHERE id = 'eq-9'`);
    const huella = (await plan()).huella;
    const dos = await Promise.allSettled([sincronizar(huella), sincronizar(huella)]);
    expect(dos.map((d) => d.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((dos.find((d) => d.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'plan_cambiado' });
    expect(await auditoria()).toHaveLength(3);
  });

  it('con el bloqueo cogido por otra, la sincronización espera; y no es el de la agenda', async () => {
    const c = await hub.connect();
    await c.query('BEGIN');
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('portal.tmc_maestro_sincronizaciones'))`);
    let acabada = false;
    const enEspera = sincronizar().then((r) => {
      acabada = true;
      return r;
    });
    await new Promise((ok) => setTimeout(ok, 300));
    expect(acabada).toBe(false);
    expect((await repo.registrarEstadosAgenda(hub, crearFuenteAgenda({ hub, desk2: () => lector }))).fuente).toBe('principal');
    await c.query('ROLLBACK');
    c.release();
    expect((await enEspera).id).toBe(1);
  });
});

describe('las rutas', () => {
  beforeEach(sembrar);

  it('GET /maestro/plan: a un Lector, sólo recuentos (ni un cliente ni un serial); a quien puede sincronizar, además el detalle', async () => {
    const res = await request(api).get('/api/trazabilidad/maestro/plan').set(comoLector);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ maestro: { disponible: true }, plan: { recuentos: { casan: 3, altas: 1 } }, ultima: null });
    expect(res.body).not.toHaveProperty('detalle');
    expect(JSON.stringify(res.body)).not.toMatch(/Ficticio|18A0|eq-/);
    const conPermiso = await request(api).get('/api/trazabilidad/maestro/plan').set(comoAdmin);
    expect(conPermiso.body.detalle).toHaveLength(6);
  });

  it('POST /maestro/sincronizar: 403 para un Lector, sin tocar nada; quien puede lo aplica, lo firma con su correo y el plan siguiente sale sin cambios', async () => {
    const antes = await foto();
    const no = await request(api).post('/api/trazabilidad/maestro/sincronizar').set(comoLector).send({});
    expect([no.status, no.body.error]).toEqual([403, 'forbidden_role']);
    expect([await foto(), await auditoria()]).toEqual([antes, []]);

    const { huella } = (await request(api).get('/api/trazabilidad/maestro/plan').set(comoAdmin)).body.plan;
    const si = await request(api).post('/api/trazabilidad/maestro/sincronizar').set(comoAdmin).send({ huella });
    expect(si.status).toBe(200);
    expect(si.body).toMatchObject({ id: 1, por: 'admin@example.com', recuentos: { altas: 1 } });
    const otra = await request(api).post('/api/trazabilidad/maestro/sincronizar').set(comoAdmin).send({ huella });
    expect([otra.status, otra.body.error]).toEqual([409, 'plan_cambiado']);
    expect((await request(api).get('/api/trazabilidad/maestro/plan').set(comoLector)).body).toMatchObject({ plan: { recuentos: { altas: 0, enlaces: 0 } }, ultima: { id: 1, por: 'admin@example.com' } });
  });
});

describe('cruce informativo de la congelación con el maestro', () => {
  it('por marca y sólo recuentos, con una congelación de la forma de la V3; no escribe nada', async () => {
    await sembrar();
    await enDesk('eq-t', '000123', 'Cliente Ficticio T', { marca: 'Thermo', modelo: '49i' });
    const { rows } = await hub.query(
      `INSERT INTO portal.tmc_fst022_congelaciones (archivo, sha256, hoja, fila_cabecera, cabeceras, total_filas, total_columnas, filas_guardadas, filas_equipo, filas_con_serial, filas_edm180, problemas, por)
       VALUES ('F-ST-022 ficticia V3.xlsx', $1, 'Trazabilidad', 5, $2::jsonb, 9, 6, 5, 4, 4, 2, '{}'::jsonb, 'director@example.com') RETURNING id`,
      ['ab'.repeat(32), JSON.stringify([['Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Vigencia de Calibración (Dias)']])],
    );
    const filas: [number, unknown[], boolean, string | null][] = [
      [5, ['Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Vigencia de Calibración (Dias)'], false, null],
      [6, ['Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', { v: '2025-10-17', t: 'fecha' }, 357], true, '18A00001'],
      [7, ['Cliente Ficticio X', 'Grimm', 'EDM 180C', '18A00077', null, null], true, '18A00077'],
      [8, ['Cliente Ficticio H', 'HORIBA', 'APNA-370', 'HB-0001', null, null], true, 'HB-0001'],
      [9, ['Cliente Ficticio T', 'Thermo', '49i', 123, null, null], true, '123'],
    ];
    for (const [fila, celdas, esEquipo, serial] of filas) {
      await hub.query(`INSERT INTO portal.tmc_fst022_congelada (congelacion_id, fila, celdas, es_equipo, serial_norm) VALUES ($1, $2, $3::jsonb, $4, $5)`, [rows[0].id, fila, JSON.stringify(celdas), esEquipo, serial]);
    }
    const antes = await foto();

    const cruce = await leerCruceFst022(hub, maestro());
    expect(cruce.congelacion).toEqual({ id: Number(rows[0].id), archivo: 'F-ST-022 ficticia V3.xlsx' });
    expect(cruce.marcas).toEqual([
      { marca: 'Grimm', v3: 2, desk: 5, casan: 1, soloV3: 1, soloDesk: 4, ambiguos: 0, sinCeros: 0 },
      { marca: 'HORIBA', v3: 1, desk: 1, casan: 1, soloV3: 0, soloDesk: 0, ambiguos: 0, sinCeros: 0 },
      { marca: 'Thermo', v3: 1, desk: 1, casan: 0, soloV3: 1, soloDesk: 1, ambiguos: 0, sinCeros: 1 },
    ]);
    const res = await request(api).get('/api/trazabilidad/maestro/cruce').set(comoLector);
    expect(res.status).toBe(200);
    expect(res.body.marcas).toEqual(cruce.marcas);
    expect(JSON.stringify(res.body)).not.toMatch(/Cliente Ficticio|18A0|HB-0/);
    expect([await foto(), await auditoria()]).toEqual([antes, []]);
  });

  it('sin congelación o sin maestro no hay cruce, y lo dice', async () => {
    expect(await leerCruceFst022(hub, maestro())).toEqual({ maestro: { disponible: true, motivo: null, mensaje: null }, congelacion: null, marcas: [] });
    expect(await leerCruceFst022(hub, sinVariable)).toMatchObject({ maestro: { disponible: false, motivo: 'sin_variable' }, marcas: [] });
  });
});
