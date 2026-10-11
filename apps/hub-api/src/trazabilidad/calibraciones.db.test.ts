import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { crearPoolDesk2 } from '../db-desk2.js';
import { asegurarDesk2, asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import { crearLectorCalibraciones, leerCalibracionesDesk2 } from './calibraciones-desk2.js';
import { leerPlanCalibraciones, sincronizarCalibraciones } from './calibraciones-repo.js';
import { planAvisos } from './dominio.js';
import { crearFuenteAgenda } from './fuente.js';
import { TzError } from './types.js';

// Las calibraciones desde Desk 2.0 (lote 9c) contra Postgres: la 057, la
// lectura del campo de Zoho en la imitación de Desk 2.0 (por nombre interno y
// por etiqueta), el plan —que no escribe—, aplicarlo (todo o nada, idempotente,
// uno detrás de otro), que sin Desk 2.0 no se escribe, que un fallo de esta
// lectura no mueve la agenda de la principal y que el inventario enseña la
// fecha de la regla. Las rutas son las de verdad; sólo la sesión es un doble.
// Todo ficticio.

const SECRET = 'test-secret-calibraciones';
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
const HOY = '2026-10-11';
const SQL_057 = readFileSync(fileURLToPath(new URL('../users/migrations/057_trazabilidad_calibraciones.sql', import.meta.url)), 'utf8');
const cabecera = (userId: string, correo: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: correo, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' })}` });
const comoAdmin = cabecera(ADMIN, 'admin@example.com');
const comoLector = cabecera('00000000-0000-4000-8000-0000000000b2', 'lector@example.com');

const desk2 = () => crearLectorCalibraciones(() => lector);
const sinVariable = crearLectorCalibraciones(() => null);
const desk2Caido = () => crearLectorCalibraciones(() => caida);
const plan = async (hoy = HOY) => leerPlanCalibraciones(hub, desk2(), hoy, true);
const actor = { userId: ADMIN, email: 'director@example.com' };
const traer = (huella: string | null = null, hoy = HOY) => sincronizarCalibraciones(hub, desk2(), huella, actor, hoy);

const enPortal = (serial: string, cliente: string, calibracion: string | null, extra: { deskId?: string; activo?: boolean } = {}) =>
  hub.query(`INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, ultima_calibracion, activo, desk_id) VALUES ($1, $1, $2, 'Grimm', 'EDM 180C', $3, $4, $5)`, [serial, cliente, calibracion, extra.activo ?? true, extra.deskId ?? null]);
/** Un ticket de la imitación de Desk 2.0: `cf` es lo que Zoho da en `raw.cf` (por nombre interno) y `etiquetas`, sus `custom_fields`. */
const enDesk = (numero: number, t: { serial?: string | null; equipoId?: string; cf?: Record<string, string> | null; etiquetas?: Record<string, string>; app?: boolean }) =>
  admin2.query(`INSERT INTO desk.tickets (id, number, status, status_type, tipo_servicio, serial, equipo_id, raw, custom_fields, managed_by_app, synced_at) VALUES ($1, $2, 'Finalizado', 'Closed', 'Calibración', $3, $4, $5::jsonb, $6::jsonb, $7, now())`, [
    `t-${numero}`,
    numero,
    t.serial ?? null,
    t.equipoId ?? null,
    JSON.stringify(t.cf === null ? { subject: 'reservado' } : { subject: 'reservado', cf: t.cf ?? {} }),
    JSON.stringify(t.etiquetas ?? {}),
    t.app ?? false,
  ]);
const NOMBRE = (fecha: string) => ({ cf_fecha_de_calibracion: fecha });
const ETIQUETA = (fecha: string) => ({ 'Fecha de Calibración': fecha });
const cambiarFecha = (numero: number, fecha: string | null) => admin2.query(`UPDATE desk.tickets SET raw = jsonb_set(raw, '{cf}', $2::jsonb), custom_fields = $3::jsonb WHERE number = $1`, [numero, JSON.stringify(fecha ? NOMBRE(fecha) : {}), JSON.stringify(fecha ? ETIQUETA(fecha) : {})]);
/** Una calibración ya guardada, sembrada por SQL (sin pasada: como si la hubiera dejado, o anulado, una persona). */
const guardada = (ticket: number | null, clave: string | null, fecha: string, extra: { origen?: string; estado?: string; aMano?: boolean } = {}) =>
  hub.query(
    `INSERT INTO portal.tmc_calibraciones (clave, serial, serial_norm, fecha, origen, ticket, estado, por, anulada_por, anulada_en)
     VALUES ($1::text, COALESCE($1::text, ''), COALESCE($1::text, ''), $2, $3, $4, $5, 'director@example.com', $6, $7)`,
    [clave, fecha, extra.origen ?? 'desk', ticket, extra.estado ?? 'vigente', extra.estado === 'anulada' ? 'tecnico@example.com' : null, extra.estado === 'anulada' ? '2026-10-01T00:00:00Z' : null],
  );

/** Una congelación con la forma de la V3 (seis columnas; la «Última Calibración», la quinta). */
async function congelar(filas: [string, string, string | null, string | null][]): Promise<void> {
  const cabeceras = [['Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Vigencia de Calibración (Dias)']];
  const { rows } = await hub.query(
    `INSERT INTO portal.tmc_fst022_congelaciones (archivo, sha256, hoja, fila_cabecera, cabeceras, total_filas, total_columnas, filas_guardadas, filas_equipo, filas_con_serial, filas_edm180, problemas, por)
     VALUES ('F-ST-022 ficticia V3.xlsx', $1, 'Trazabilidad', 5, $2::jsonb, 9, 6, 5, 4, 4, 2, '{}'::jsonb, 'director@example.com') RETURNING id`,
    ['ab'.repeat(32), JSON.stringify(cabeceras)],
  );
  let fila = 5;
  await hub.query(`INSERT INTO portal.tmc_fst022_congelada (congelacion_id, fila, celdas, es_equipo) VALUES ($1, $2, $3::jsonb, false)`, [rows[0].id, fila, JSON.stringify(cabeceras[0])]);
  for (const [serial, marca, fecha, clave] of filas) {
    await hub.query(`INSERT INTO portal.tmc_fst022_congelada (congelacion_id, fila, celdas, es_equipo, serial_norm, clave_equipo) VALUES ($1, $2, $3::jsonb, true, $4, $5)`, [
      rows[0].id,
      ++fila,
      JSON.stringify(['Cliente Ficticio', marca, 'EDM 180C', serial, fecha ? { v: fecha, t: 'fecha' } : null, 100]),
      serial.toUpperCase(),
      clave,
    ]);
  }
}

/** El inventario enlazado con Desk 2.0, la hoja congelada y siete tickets: cinco traen el campo. */
async function sembrar(): Promise<void> {
  await enPortal('18A00001', 'Cliente Ficticio A', '2025-06-01', { deskId: 'eq-1' }); // vencida
  await enPortal('18A00002', 'Cliente Ficticio B', '2025-12-01', { deskId: 'eq-2' }); // la hoja dice otra fecha
  await enPortal('18A00003', 'Cliente Ficticio C', '2026-03-01'); // no está en la hoja
  await enPortal('18A00004', 'Cliente Ficticio D', null); // sin fecha en ningún sitio
  await congelar([['18A00001', 'Grimm', '2025-06-01', '18A00001'], ['18A00002', 'Grimm', '2025-11-20', '18A00002'], ['HB-0001', 'HORIBA', '2024-03-01', null]]);
  await enDesk(1001, { serial: 'OTRO-SERIAL', equipoId: 'eq-1', cf: NOMBRE('2026-09-20'), etiquetas: ETIQUETA('2026-09-19') }); // por nombre interno, y por el equipo de Desk 2.0
  await enDesk(1002, { serial: ' 18a00003 ', cf: null, etiquetas: ETIQUETA('2026-08-15') }); // sólo por etiqueta (Desk 2.0 no lo ha releído al detalle)
  await enDesk(1003, { serial: '18A00002', cf: NOMBRE('2027-01-10') }); // fecha futura
  await enDesk(1004, { serial: null, cf: NOMBRE('2026-07-01') }); // sin serial ni equipo
  await enDesk(1005, { serial: 'HB-0001', equipoId: 'eq-h', cf: NOMBRE('2026-06-30'), app: true }); // otra marca
  await enDesk(1006, { serial: '18A00001', cf: { cf_fecha_cal_sensores_ext: '2026-10-01' }, etiquetas: { 'Fecha Cal. Sensores Ext.': '2026-10-01' } }); // OTRO campo: no se lee
  await enDesk(1007, { serial: '18A00002', cf: null }); // sin el campo
}

const ESPERADO = {
  tickets: 7, conCf: 5, conCampo: 5, porNombre: 4, porEtiqueta: 1, gestionadosPorApp: 1,
  nuevas: 4, sinCambios: 0, cambiadas: 0, reenlazadas: 0, vaciadas: 0, enRevision: 1, otrasMarcas: 1, historial: 0, sinEquipo: 1, ilegibles: 0, noResucitan: 0,
  partida: 3, partidaDeInventario: 1, partidaDistintas: 1, equiposCambian: 3, salenDeAvisos: 1, entranEnAvisos: 0,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;
const FOTO = `id, clave, serial, serial_norm, desk_equipo_id, fecha::text AS fecha, origen, ticket, estado, motivo, pasada_id, por, anulada_pasada_id, anulada_por, anulada_motivo`;
const foto = async () => (await hub.query(`SELECT ${FOTO} FROM portal.tmc_calibraciones ORDER BY id`)).rows as Fila[];
const pasadas = async () => (await hub.query(`SELECT id, huella, recuentos, detalle, por_id, por FROM portal.tmc_calibraciones_pasadas ORDER BY id`)).rows as Fila[];
const inventario = async () => (await hub.query(`SELECT clave, ultima_calibracion::text AS ultima, activo, desk_id FROM portal.tmc_equipos ORDER BY clave`)).rows as Fila[];
const fechasDe = async (hoy = HOY) => Object.fromEntries((await repo.listarEquipos(hub, hoy)).map((e) => [e.clave, [e.ultimaCalibracion, e.estado]]));

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
  api.use('/api', createTrazabilidadRouter(hub, crearFuenteAgenda({ hub, desk2: () => lector }), undefined, desk2()));
});
afterAll(async () => {
  // La base es la misma para todos los ficheros: aquí no se deja ninguna calibración sembrada.
  await hub?.query(`TRUNCATE portal.tmc_calibraciones, portal.tmc_calibraciones_pasadas RESTART IDENTITY`);
  await Promise.all([caida?.end(), lector?.end(), admin2?.end(), hub?.end()]);
});
beforeEach(async () => {
  await hub.query(`TRUNCATE desk.tickets, portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_contactos, portal.tmc_calibraciones, portal.tmc_calibraciones_pasadas, portal.tmc_fst022_congelaciones RESTART IDENTITY CASCADE`);
  await admin2.query('TRUNCATE desk.equipos, desk.tickets, desk.ticket_transitions RESTART IDENTITY');
});

describe('migración 057', () => {
  it('ejecutarla otra vez (cada arranque) no toca las calibraciones ni sus pasadas', async () => {
    await guardada(1001, '18A00001', '2026-09-20');
    await guardada(null, '18A00001', '2025-06-01', { origen: 'fst022' });
    await hub.query(`INSERT INTO portal.tmc_calibraciones_pasadas (huella, recuentos, detalle, por) VALUES ($1, '{"nuevas": 1}', '[]', 'director@example.com')`, ['ab'.repeat(32)]);
    const todo = async () => [(await hub.query(`SELECT * FROM portal.tmc_calibraciones ORDER BY id`)).rows, (await hub.query(`SELECT * FROM portal.tmc_calibraciones_pasadas ORDER BY id`)).rows];
    const antes = await todo();
    await hub.query(SQL_057);
    await hub.query(SQL_057);
    expect(await todo()).toEqual(antes);
    expect(antes.map((t) => t.length)).toEqual([2, 1]);
  });

  it('los CHECK: origen y estado con sus valores, el ticket sólo en las de Desk, la corrección sólo en una manual y la anulación firmada', async () => {
    const alta = (cols: string, vals: string) => hub.query(`INSERT INTO portal.tmc_calibraciones (fecha, por, ${cols}) VALUES ('2026-01-01', 'director@example.com', ${vals})`);
    await expect(alta('origen', `'excel'`)).rejects.toThrow(/check/i);
    await expect(alta('origen, estado', `'manual', 'dudosa'`)).rejects.toThrow(/check/i);
    await expect(alta('origen', `'desk'`)).rejects.toThrow(/tmc_calibraciones_ticket_de_desk/);
    await expect(alta('origen, ticket', `'fst022', 7`)).rejects.toThrow(/tmc_calibraciones_ticket_de_desk/);
    await expect(alta('origen, corrige_ticket', `'manual', 7`)).rejects.toThrow(/tmc_calibraciones_corrige/);
    await expect(alta('origen, ticket, corrige_ticket, corrige_fecha', `'desk', 7, 7, '2026-01-01'`)).rejects.toThrow(/tmc_calibraciones_corrige/);
    await expect(alta('origen, estado', `'manual', 'anulada'`)).rejects.toThrow(/tmc_calibraciones_anulada_firmada/);
    await alta('origen, corrige_ticket, corrige_fecha', `'manual', 7, '2026-01-02'`);
    await expect(hub.query(`UPDATE portal.tmc_calibraciones SET fecha = NULL`)).rejects.toThrow(/null/i);
    await expect(hub.query(`INSERT INTO portal.tmc_calibraciones_pasadas (huella, recuentos, detalle, por) VALUES ('corta', '{}', '[]', 'director@example.com')`)).rejects.toThrow(/check/i);
  });

  it('como mucho una fila sin anular por ticket de Desk (las anuladas no cuentan) y una fila fst022 por equipo', async () => {
    await guardada(7, null, '2026-01-01', { estado: 'anulada' });
    await guardada(7, null, '2026-01-01', { estado: 'anulada' });
    await guardada(7, null, '2026-01-01', { estado: 'en_revision' });
    await expect(guardada(7, null, '2026-01-01')).rejects.toThrow(/tmc_calibraciones_ticket_uq/);
    await guardada(null, '18A00001', '2026-01-01', { origen: 'fst022' });
    await expect(guardada(null, '18A00001', '2026-01-01', { origen: 'fst022' })).rejects.toThrow(/tmc_calibraciones_fst022_uq/);
  });
});

describe('leer las fechas de Desk 2.0', () => {
  beforeEach(sembrar);

  it('por el rol de sólo lectura: primero el nombre interno, si no la etiqueta; el otro campo de fecha no se lee; y cuenta cuántos tickets traen `raw.cf`', async () => {
    const lectura = await leerCalibracionesDesk2(lector);
    expect([lectura.total, lectura.conCf]).toEqual([7, 5]);
    expect(lectura.tickets).toEqual([
      { numero: 1001, fecha: '2026-09-20', campo: 'nombre_interno', equipoId: 'eq-1', serial: 'OTRO-SERIAL', tipoServicio: 'Calibración', estado: 'Finalizado', gestionadoPorApp: false },
      { numero: 1002, fecha: '2026-08-15', campo: 'etiqueta', equipoId: null, serial: ' 18a00003 ', tipoServicio: 'Calibración', estado: 'Finalizado', gestionadoPorApp: false },
      { numero: 1003, fecha: '2027-01-10', campo: 'nombre_interno', equipoId: null, serial: '18A00002', tipoServicio: 'Calibración', estado: 'Finalizado', gestionadoPorApp: false },
      { numero: 1004, fecha: '2026-07-01', campo: 'nombre_interno', equipoId: null, serial: null, tipoServicio: 'Calibración', estado: 'Finalizado', gestionadoPorApp: false },
      { numero: 1005, fecha: '2026-06-30', campo: 'nombre_interno', equipoId: 'eq-h', serial: 'HB-0001', tipoServicio: 'Calibración', estado: 'Finalizado', gestionadoPorApp: true },
    ]);
    await expect(lector.query(`UPDATE desk.tickets SET custom_fields = '{}'`)).rejects.toThrow(/read-only|permission denied/i);
  });

  it('un valor vacío no es traer el campo, y uno que no es una fecha llega sin fecha', async () => {
    await admin2.query(`UPDATE desk.tickets SET raw = jsonb_set(raw, '{cf}', '{"cf_fecha_de_calibracion": "  "}') WHERE number = 1003`);
    await admin2.query(`UPDATE desk.tickets SET raw = jsonb_set(raw, '{cf}', '{"cf_fecha_de_calibracion": "pendiente"}') WHERE number = 1004`);
    const { tickets } = await leerCalibracionesDesk2(lector);
    expect(tickets.map((t) => [t.numero, t.fecha])).toEqual([[1001, '2026-09-20'], [1002, '2026-08-15'], [1004, null], [1005, '2026-06-30']]);
  });

  it('no lanza: sin la variable o con Desk 2.0 caído dice por qué, con un motivo de la lista, y entonces no hay plan', async () => {
    expect(await sinVariable()).toEqual({ disponible: false, motivo: 'sin_variable' });
    const caido = await desk2Caido()();
    expect(caido.disponible).toBe(false);
    expect(['error_conexion', 'timeout']).toContain((caido as { motivo: string }).motivo);
    for (const leer of [sinVariable, desk2Caido()]) {
      const r = await leerPlanCalibraciones(hub, leer, HOY, true);
      expect(r).toMatchObject({ lectura: { disponible: false }, plan: null, salud: null, ultima: null });
      expect(JSON.stringify(r)).not.toMatch(/postgres|127\.0\.0\.1|agenda_lector/i);
    }
  });

  it('un fallo de ESTA lectura no manda la agenda al respaldo: la fuente sigue en principal y su cortacircuitos, cerrado', async () => {
    const fuente = crearFuenteAgenda({ hub, desk2: () => lector });
    // Al lector se le deja sólo lo que lee la agenda: ni `raw` ni `custom_fields`.
    await admin2.query(`REVOKE SELECT ON desk.tickets FROM ${ROL_LECTOR}`);
    await admin2.query(`GRANT SELECT (id, number, status, status_type, priority, classification, created_time, tipo_servicio, fecha_creacion_ticket, fecha_remision_entrada, prioridad_en_app_at, synced_at, subject) ON desk.tickets TO ${ROL_LECTOR}`);
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await desk2()()).toEqual({ disponible: false, motivo: 'error_consulta' });
      expect(await leerPlanCalibraciones(hub, desk2(), HOY, true)).toMatchObject({ lectura: { disponible: false, motivo: 'error_consulta' }, plan: null });
      expect(await fuente.estadoFuente()).toMatchObject({ fuente: 'principal', motivo: null, ultimoFalloPrincipal: null, cortacircuitosHasta: null });
      expect((await fuente.abiertosConOrigen()).fuente).toBe('principal');
    } finally {
      vi.restoreAllMocks();
      await admin2.query(`GRANT SELECT ON desk.tickets TO ${ROL_LECTOR}`);
    }
  });
});

describe('el plan', () => {
  beforeEach(sembrar);

  it('no escribe: recuentos, salud y huella; el detalle (con seriales), sólo si se pide; y el inventario sigue enseñando su fecha', async () => {
    const antes = await inventario();
    const r = await plan();
    expect(r.lectura).toEqual({ disponible: true, motivo: null, mensaje: null });
    expect(r.plan!.recuentos).toEqual(ESPERADO);
    expect(r.plan!.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(r.salud).toEqual({ alerta: false, bloquea: false, mensaje: null });
    expect(r.ultima).toBeNull();
    expect(r.detalle!.map((d) => [d.tipo, d.ticket ?? d.clave, d.fecha, d.antes])).toEqual([
      ['revision', 1003, '2027-01-10', null],
      ['sin_equipo', 1004, '2026-07-01', null],
      ['distinta', '18A00002', '2025-11-20', '2025-12-01'],
      ['nueva', 1001, '2026-09-20', null],
      ['nueva', 1002, '2026-08-15', null],
      ['otra_marca', 1005, '2026-06-30', null],
      ['partida', '18A00001', '2025-06-01', null],
      ['partida', '18A00003', '2026-03-01', null],
    ]);
    expect(r.detalleTotal).toBe(8);
    expect(await leerPlanCalibraciones(hub, desk2(), HOY, false)).not.toHaveProperty('detalle');
    expect((await plan()).plan!.huella).toBe(r.plan!.huella);
    expect([await foto(), await pasadas(), await inventario()]).toEqual([[], [], antes]);
    expect((await repo.listarEquipos(hub, HOY)).map((e) => [e.clave, e.ultimaCalibracion, e.estado])).toEqual([['18A00001', '2025-06-01', 'VENCIDA'], ['18A00002', '2025-12-01', 'VENCE_60'], ['18A00003', '2026-03-01', 'AL_DIA'], ['18A00004', null, 'SIN_FECHA']]);
  });

  it('contra lo ya guardado: lo que está igual no cuenta como nuevo, la fecha que cambió en Zoho y el campo vaciado se ven, y una anulada a mano no vuelve', async () => {
    await guardada(1001, '18A00001', '2026-09-20'); // igual
    await guardada(1002, '18A00003', '2026-08-01'); // en Zoho ahora dice el 15
    await guardada(1099, '18A00002', '2026-05-05'); // ese ticket ya no trae el campo
    await guardada(1005, null, '2026-06-30', { estado: 'anulada' }); // anulada a mano, y Zoho sigue igual
    for (const clave of ['18A00001', '18A00002', '18A00003']) await guardada(null, clave, '2025-01-01', { origen: 'fst022' });
    const antes = await foto();
    const r = await plan();
    expect(r.plan!.recuentos).toMatchObject({ nuevas: 1, sinCambios: 1, cambiadas: 1, vaciadas: 1, noResucitan: 1, enRevision: 1, partida: 0, sinEquipo: 1 });
    expect(r.detalle!.map((d) => [d.tipo, d.ticket, d.fecha, d.antes])).toEqual([
      ['revision', 1003, '2027-01-10', null],
      ['cambiada', 1002, '2026-08-15', '2026-08-01'],
      ['vaciada', 1099, null, '2026-05-05'],
      ['sin_equipo', 1004, '2026-07-01', null],
      ['no_resucita', 1005, '2026-06-30', null],
    ]);
    expect(await foto()).toEqual(antes);
  });

  it('salud: si ningún ticket trae ya el campo (lo renombraron en Zoho) lo dice; si antes venían, además marca que no se debe traer', async () => {
    await admin2.query(`UPDATE desk.tickets SET raw = raw - 'cf', custom_fields = '{}'`);
    const nunca = await plan();
    expect(nunca.plan!.recuentos).toMatchObject({ tickets: 7, conCf: 0, conCampo: 0 });
    expect(nunca.salud).toMatchObject({ alerta: true, bloquea: false });
    await guardada(1001, '18A00001', '2026-09-20');
    await guardada(1002, '18A00003', '2026-08-15');
    const baja = await plan();
    expect(baja.plan!.recuentos).toMatchObject({ conCampo: 0, vaciadas: 2 });
    expect(baja.salud).toMatchObject({ alerta: true, bloquea: true });
    expect(baja.salud!.mensaje).toMatch(/Ningún ticket de Desk 2\.0 trae la «Fecha de Calibración» \(antes la traían 2\)/);
    // También cuenta lo que trajo la última pasada, aunque sus filas ya no estén sin anular.
    await hub.query(`INSERT INTO portal.tmc_calibraciones_pasadas (huella, recuentos, detalle, por) VALUES ($1, '{"conCampo": 5}', '[]', 'director@example.com')`, ['ab'.repeat(32)]);
    const conPasada = await plan();
    expect(conPasada.salud!.mensaje).toMatch(/antes la traían 5/);
    expect(conPasada.ultima).toMatchObject({ id: 1, por: 'director@example.com', recuentos: { conCampo: 5 } });
  });
});

describe('aplicar el plan', () => {
  beforeEach(sembrar);

  it('una fila por calibración (enlazada por el equipo de Desk 2.0 o por serial), la futura en revisión, la de otra marca sin clave, y el punto de partida; firmado, con su pasada, y sin tocar el inventario', async () => {
    const antes = await inventario();
    const s = await traer((await plan()).plan!.huella);
    expect(s).toMatchObject({ id: 1, por: 'director@example.com', recuentos: ESPERADO });
    expect((await foto()).map((f) => [f.origen, f.ticket, f.clave, f.serial, f.serial_norm, f.desk_equipo_id, f.fecha, f.estado, f.motivo])).toEqual([
      ['desk', 1001, '18A00001', 'OTRO-SERIAL', 'OTRO-SERIAL', 'eq-1', '2026-09-20', 'vigente', null],
      ['desk', 1002, '18A00003', '18a00003', '18A00003', null, '2026-08-15', 'vigente', null],
      ['desk', 1003, '18A00002', '18A00002', '18A00002', null, '2027-01-10', 'en_revision', 'La fecha es posterior a hoy.'],
      ['desk', 1005, null, 'HB-0001', 'HB-0001', 'eq-h', '2026-06-30', 'vigente', null],
      ['fst022', null, '18A00001', '18A00001', '18A00001', 'eq-1', '2025-06-01', 'vigente', 'F-ST-022 congelada.'],
      ['fst022', null, '18A00002', '18A00002', '18A00002', 'eq-2', '2025-11-20', 'vigente', 'F-ST-022 congelada.'],
      ['fst022', null, '18A00003', '18A00003', '18A00003', null, '2026-03-01', 'vigente', 'Inventario del portal (la hoja congelada no trae fecha para este equipo).'],
    ]);
    for (const f of await foto()) expect(f).toMatchObject({ pasada_id: '1', por: 'director@example.com', anulada_pasada_id: null, anulada_por: null });
    const [pasada] = await pasadas();
    expect(pasada).toMatchObject({ por_id: ADMIN, por: 'director@example.com', recuentos: ESPERADO, huella: s.huella });
    expect(pasada.detalle).toHaveLength(8);
    expect(await inventario()).toEqual(antes);
  });

  it('idempotente: una segunda pasada no cambia nada y deja su fila de auditoría, sin detalle que escribir', async () => {
    await traer();
    const antes = await foto();
    const otra = await plan();
    expect(otra.plan!.recuentos).toMatchObject({ nuevas: 0, sinCambios: 4, cambiadas: 0, vaciadas: 0, sinEquipo: 1, partida: 0, equiposCambian: 0, salenDeAvisos: 0 });
    expect(otra.detalle!.map((d) => d.tipo)).toEqual(['sin_equipo']);
    expect(otra.ultima).toMatchObject({ id: 1, por: 'director@example.com' });
    expect((await traer(otra.plan!.huella)).id).toBe(2);
    expect(await foto()).toEqual(antes);
  });

  it('la fecha cambió en Zoho → anula la fila (firmada, con su pasada y su motivo) e inserta otra; el campo vaciado → anula y no inserta', async () => {
    await traer();
    await cambiarFecha(1001, '2026-09-25');
    await cambiarFecha(1005, null);
    const r = await plan();
    expect(r.plan!.recuentos).toMatchObject({ nuevas: 0, sinCambios: 2, cambiadas: 1, vaciadas: 1, equiposCambian: 1 });
    await traer(r.plan!.huella);
    const de = (ticket: number) => foto().then((fs) => fs.filter((f) => f.ticket === ticket).map((f) => [f.fecha, f.estado, f.anulada_pasada_id, f.anulada_por, f.anulada_motivo]));
    expect(await de(1001)).toEqual([
      ['2026-09-20', 'anulada', '2', 'director@example.com', 'La fecha cambió en Zoho: 2026-09-20 → 2026-09-25.'],
      ['2026-09-25', 'vigente', null, null, null],
    ]);
    expect(await de(1005)).toEqual([['2026-06-30', 'anulada', '2', 'director@example.com', 'El campo se vació en Zoho (o el ticket ya no está en Desk 2.0).']]);
    expect((await fechasDe())['18A00001']).toEqual(['2026-09-25', 'AL_DIA']);
  });

  it('una fila anulada A MANO no la resucita la pasada mientras Zoho siga con esa fecha', async () => {
    await traer();
    await hub.query(`UPDATE portal.tmc_calibraciones SET estado = 'anulada', anulada_por = 'tecnico@example.com', anulada_en = NOW(), anulada_motivo = 'No es de este equipo' WHERE ticket = 1001`);
    const r = await plan();
    expect(r.plan!.recuentos).toMatchObject({ nuevas: 0, noResucitan: 1 });
    await traer(r.plan!.huella);
    expect((await foto()).filter((f) => f.ticket === 1001).map((f) => f.estado)).toEqual(['anulada']);
    expect((await fechasDe())['18A00001']).toEqual(['2025-06-01', 'VENCIDA']);
  });

  it('una en revisión por futura pasa a vigente cuando llega su día', async () => {
    await traer();
    expect((await fechasDe())['18A00002']).toEqual(['2025-11-20', 'VENCE_60']);
    const r = await plan('2027-01-10');
    expect(r.plan!.recuentos).toMatchObject({ reenlazadas: 1, enRevision: 0 });
    await traer(r.plan!.huella, '2027-01-10');
    expect((await fechasDe('2027-01-10'))['18A00002']).toEqual(['2027-01-10', 'AL_DIA']);
  });

  it('todo o nada: si la base falla a mitad, no queda ni una calibración ni la pasada', async () => {
    const rota = {
      query: hub.query.bind(hub),
      connect: async () => {
        const c = await hub.connect();
        return { query: (sql: string, p?: unknown[]) => (/INSERT INTO portal\.tmc_calibraciones \(/.test(sql) ? Promise.reject(new Error('la base falló')) : c.query(sql, p)), release: () => c.release() };
      },
    } as unknown as Pool;
    await expect(sincronizarCalibraciones(rota, desk2(), null, actor, HOY)).rejects.toThrow('la base falló');
    expect([await foto(), await pasadas()]).toEqual([[], []]);
  });

  it.each([
    ['sin la variable (o en respaldo: la réplica no trae campos personalizados)', () => sinVariable],
    ['con Desk 2.0 configurado pero caído', desk2Caido],
  ])('%s no escribe: 409 y la base como estaba', async (_nombre, lectorDesk2) => {
    const e = await sincronizarCalibraciones(hub, lectorDesk2(), null, actor, HOY).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TzError);
    expect(e).toMatchObject({ status: 409, code: 'calibraciones_no_disponibles' });
    expect((e as TzError).messageEs).toMatch(/No se ha traído nada\.$/);
    expect((e as TzError).messageEs).not.toMatch(/postgres|127\.0\.0\.1|agenda_lector/i);
    expect([await foto(), await pasadas()]).toEqual([[], []]);
  });

  it('con Desk 2.0 contestando a la agenda pero no a ESTA lectura, tampoco escribe', async () => {
    await admin2.query(`REVOKE SELECT ON desk.tickets FROM ${ROL_LECTOR}`);
    await admin2.query(`GRANT SELECT (id, number, status, status_type) ON desk.tickets TO ${ROL_LECTOR}`);
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(traer()).rejects.toMatchObject({ status: 409, code: 'calibraciones_no_disponibles' });
      expect([await foto(), await pasadas()]).toEqual([[], []]);
    } finally {
      vi.restoreAllMocks();
      await admin2.query(`GRANT SELECT ON desk.tickets TO ${ROL_LECTOR}`);
    }
  });

  it('si el plan cambió entre verlo y aplicarlo (alguien tocó el ticket en Zoho), 409 y no se aplica nada; con la huella de ahora, sí', async () => {
    const visto = (await plan()).plan!.huella;
    await cambiarFecha(1001, '2026-09-21');
    await expect(traer(visto)).rejects.toMatchObject({ status: 409, code: 'plan_cambiado' });
    expect([await foto(), await pasadas()]).toEqual([[], []]);
    await traer((await plan()).plan!.huella);
    expect((await foto()).find((f) => f.ticket === 1001)).toMatchObject({ fecha: '2026-09-21' });
  });

  it('dos a la vez van una detrás de otra: cada calibración entra una sola vez; con la misma huella, la segunda es un 409', async () => {
    const [a, b] = await Promise.all([traer(), traer()]);
    expect([a.id, b.id].sort()).toEqual([1, 2]);
    expect(await foto()).toHaveLength(7);
    expect((await pasadas()).map((p) => p.recuentos.nuevas + p.recuentos.partida)).toEqual([7, 0]);

    await cambiarFecha(1001, '2026-09-22');
    const huella = (await plan()).plan!.huella;
    const dos = await Promise.allSettled([traer(huella), traer(huella)]);
    expect(dos.map((d) => d.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((dos.find((d) => d.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'plan_cambiado' });
    expect((await foto()).filter((f) => f.ticket === 1001 && f.estado !== 'anulada')).toHaveLength(1);
  });

  it('salud: si ningún ticket trae ya el campo (lo renombraron en Zoho) NO deja traer: no se anula nada', async () => {
    await traer();
    const antes = await foto();
    await admin2.query(`UPDATE desk.tickets SET raw = raw - 'cf', custom_fields = '{}'`);
    const r = await plan();
    expect(r.plan!.recuentos).toMatchObject({ conCf: 0, conCampo: 0, vaciadas: 4 });
    expect(r.salud!.mensaje).toMatch(/Ningún ticket de Desk 2\.0 trae la «Fecha de Calibración» \(antes la traían 5\)/);
    await expect(traer(r.plan!.huella)).rejects.toMatchObject({ status: 409, code: 'lectura_sospechosa' });
    expect(await foto()).toEqual(antes);
  });

  it('salud: en un entorno donde nunca vino ninguna avisa pero deja traer el punto de partida', async () => {
    await admin2.query(`UPDATE desk.tickets SET raw = raw - 'cf', custom_fields = '{}'`);
    const r = await plan();
    expect(r.salud).toMatchObject({ alerta: true, bloquea: false });
    await traer(r.plan!.huella);
    expect((await foto()).map((f) => f.origen)).toEqual(['fst022', 'fst022', 'fst022']);
  });
});

describe('el inventario enseña la fecha que da la regla', () => {
  beforeEach(sembrar);

  it('sin ninguna calibración guardada, cada equipo sigue con la del inventario, como hasta ahora', async () => {
    expect(await fechasDe()).toEqual({ '18A00001': ['2025-06-01', 'VENCIDA'], '18A00002': ['2025-12-01', 'VENCE_60'], '18A00003': ['2026-03-01', 'AL_DIA'], '18A00004': [null, 'SIN_FECHA'] });
  });

  it('DE PUNTA A PUNTA: el equipo vencido que recibe una calibración reciente pasa a «Al día» y sale del plan de avisos; y sigue sin existir ningún envío', async () => {
    const avisos = async () => {
      const p = planAvisos(await repo.listarEquipos(hub, HOY), HOY, await repo.listarContactos(hub));
      return [...p.vencidasSinAviso, ...p.correos.flatMap((c) => c.equipos), ...p.sinDestinatario.flatMap((c) => c.equipos)].map((a) => a.equipo.clave).sort();
    };
    expect(await avisos()).toEqual(['18A00001', '18A00002']);
    await traer();
    expect(await fechasDe()).toEqual({ '18A00001': ['2026-09-20', 'AL_DIA'], '18A00002': ['2025-11-20', 'VENCE_60'], '18A00003': ['2026-08-15', 'AL_DIA'], '18A00004': [null, 'SIN_FECHA'] });
    expect(await avisos()).toEqual(['18A00002']);
    // La fecha del inventario no se ha tocado: la que cuenta sale de las calibraciones.
    expect((await inventario()).map((e) => e.ultima)).toEqual(['2025-06-01', '2025-12-01', '2026-03-01', null]);
    const { rows } = await hub.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'portal' AND table_name ~ 'outbox|envio|mensaje|cola|pendiente' AND table_name LIKE 'tmc%'`);
    expect(rows).toEqual([]);
  });

  it('la corrección manual (el modelo; su pantalla es del 9d) manda sobre la fecha de Desk de su ticket hasta que esa fecha cambie en Zoho', async () => {
    await traer();
    await hub.query(`INSERT INTO portal.tmc_calibraciones (clave, serial, serial_norm, fecha, origen, corrige_ticket, corrige_fecha, motivo, por) VALUES ('18A00001', '18A00001', '18A00001', '2026-09-10', 'manual', 1001, '2026-09-20', 'El certificado dice el 10', 'tecnico@example.com')`);
    expect((await fechasDe())['18A00001']).toEqual(['2026-09-10', 'AL_DIA']);
    // Otra pasada, con Zoho igual, no toca nada: la manual sigue mandando.
    await traer();
    expect((await fechasDe())['18A00001']).toEqual(['2026-09-10', 'AL_DIA']);
    await cambiarFecha(1001, '2026-09-12');
    await traer();
    expect((await fechasDe())['18A00001']).toEqual(['2026-09-12', 'AL_DIA']);
    expect((await foto()).filter((f) => f.origen === 'manual').map((f) => f.estado)).toEqual(['vigente']);
  });
});

describe('las rutas', () => {
  beforeEach(sembrar);
  const PLAN = '/api/trazabilidad/calibraciones/plan';
  const TRAER = '/api/trazabilidad/calibraciones/sincronizar';

  it('GET /calibraciones/plan: a un Lector, sólo recuentos (ni un cliente ni un serial); a quien puede traer, además el detalle; y no escribe', async () => {
    const res = await request(api).get(PLAN).set(comoLector);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lectura: { disponible: true }, plan: { recuentos: { nuevas: 4, partida: 3 } }, salud: { alerta: false }, ultima: null });
    expect(res.body).not.toHaveProperty('detalle');
    expect(JSON.stringify(res.body)).not.toMatch(/Ficticio|18A0|HB-|OTRO-SERIAL|eq-/);
    expect((await request(api).get(PLAN).set(comoAdmin)).body.detalle).toHaveLength(8);
    expect([await foto(), await pasadas()]).toEqual([[], []]);
  });

  it('POST /calibraciones/sincronizar: 403 para un Lector, sin tocar nada; quien puede lo aplica y lo firma con su correo; y el plan siguiente sale sin cambios', async () => {
    const no = await request(api).post(TRAER).set(comoLector).send({});
    expect([no.status, no.body.error]).toEqual([403, 'forbidden_role']);
    expect([await foto(), await pasadas()]).toEqual([[], []]);

    const { huella } = (await request(api).get(PLAN).set(comoAdmin)).body.plan;
    const si = await request(api).post(TRAER).set(comoAdmin).send({ huella });
    expect(si.status).toBe(200);
    expect(si.body).toMatchObject({ id: 1, por: 'admin@example.com', recuentos: { nuevas: 4 } });
    const otra = await request(api).post(TRAER).set(comoAdmin).send({ huella });
    expect([otra.status, otra.body.error]).toEqual([409, 'plan_cambiado']);
    expect((await request(api).get(PLAN).set(comoLector)).body).toMatchObject({ plan: { recuentos: { nuevas: 0, partida: 0 } }, ultima: { id: 1, por: 'admin@example.com' } });
  });

  it('GET /equipos/:clave/calibraciones: el historial del equipo, la más reciente primero, con su origen, su estado, quién y cuándo, y cuál es la que cuenta', async () => {
    await request(api).post(TRAER).set(comoAdmin).send({});
    await cambiarFecha(1001, '2026-09-25');
    await request(api).post(TRAER).set(comoAdmin).send({});
    const res = await request(api).get('/api/trazabilidad/equipos/18A00001/calibraciones').set(comoLector);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ clave: '18A00001', ultima: '2026-09-25' });
    expect(res.body.calibraciones.map((c: Fila) => [c.fecha, c.origen, c.ticket, c.estado, c.cuenta, c.por, c.anuladaPor])).toEqual([
      ['2026-09-25', 'desk', 1001, 'vigente', true, 'admin@example.com', null],
      ['2026-09-20', 'desk', 1001, 'anulada', false, 'admin@example.com', 'admin@example.com'],
      ['2025-06-01', 'fst022', null, 'vigente', false, 'admin@example.com', null],
    ]);
    expect(res.body.calibraciones[0].en).toMatch(/^2\d{3}-\d\d-\d\d /);
    expect((await request(api).get('/api/trazabilidad/equipos/18A00004/calibraciones').set(comoLector)).body).toEqual({ clave: '18A00004', ultima: null, calibraciones: [] });
    expect((await request(api).get('/api/trazabilidad/equipos/a%20b/calibraciones').set(comoLector)).status).toBe(400);
  });

  it('GET /equipos lleva ya la fecha nueva', async () => {
    await request(api).post(TRAER).set(comoAdmin).send({});
    const res = await request(api).get(`/api/trazabilidad/equipos?hoy=${HOY}`).set(comoLector);
    expect(res.body.equipos.find((e: Fila) => e.clave === '18A00001')).toMatchObject({ ultimaCalibracion: '2026-09-20', estado: 'AL_DIA', vence: '2027-09-20' });
  });
});
