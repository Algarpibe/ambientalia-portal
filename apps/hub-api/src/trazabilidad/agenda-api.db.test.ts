import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { asegurarDesk2, asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';

// Lote 5 de la agenda del taller, de punta a punta: las rutas de verdad sobre
// la base de pruebas, con la imitación de Desk 2.0 como fuente principal. Sólo
// la sesión es de mentira (quién pide y si es administrador del portal): el
// rol en la app, la pasada, la proyección y las escrituras son los de verdad.
// Números de ticket ficticios.

const SECRET = 'test-secret-agenda-api';
process.env.JWT_SECRET = SECRET;

const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const LECTOR = '00000000-0000-4000-8000-0000000000b2';
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
const { reiniciarRegistroEstados, FRESCURA_MS } = await import('./registro-estados.js');
const { crearFuenteAgenda, CORTACIRCUITOS_MS } = await import('./fuente.js');
const { crearPoolDesk2 } = await import('../db-desk2.js');
type DbLectura = import('./fuente.js').DbLectura;

let hub: Pool;
let admin2: Pool;
let lector: Pool;
let caida: Pool; // una «principal» configurada que no contesta: puerto cerrado

const A = '/api/trazabilidad/agenda';
const AHORA = Date.UTC(2026, 9, 6, 13, 30, 0);
/** El reloj de la fuente (sincronización y cortacircuitos) y qué «Desk 2.0» tiene delante. */
const mundo = { ahora: AHORA, principal: 'viva' as 'viva' | 'caida', intentos: 0 };
const leer = (fichero: string) => readFileSync(fileURLToPath(new URL(`../users/migrations/${fichero}`, import.meta.url)), 'utf8');

const cabecera = (userId: string, correo: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: correo, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' })}` });
const director = cabecera(ADMIN, 'director@ambientalia.com.co');
const lectorApp = cabecera(LECTOR, 'consulta@ambientalia.com.co');

/** El servidor con UNA fuente, la misma para las rutas y para la pasada, como en index.ts. */
function servidor() {
  const desk2: DbLectura = {
    query: (sql, params) => {
      mundo.intentos++;
      return (mundo.principal === 'viva' ? lector : caida).query(sql, params);
    },
  };
  const a = express();
  a.use(express.json());
  a.use('/api', createTrazabilidadRouter(hub, crearFuenteAgenda({ hub, desk2: () => desk2, ahora: () => mundo.ahora })));
  return a;
}
let api: ReturnType<typeof servidor>;
const get = (ruta: string, c = director) => request(api).get(`${A}${ruta}`).set(c);
const post = (ruta: string, cuerpo: object, c = director) => request(api).post(`${A}${ruta}`).set(c).send(cuerpo);
const put = (ruta: string, cuerpo: object, c = director) => request(api).put(ruta).set(c).send(cuerpo);

const ticket = (numero: number, estado: string, remision: string | null = null) =>
  admin2.query(
    `INSERT INTO desk.tickets (id, number, status, status_type, classification, tipo_servicio, fecha_remision_entrada, synced_at)
     VALUES ($1, $2, $3, 'Open', 'Equipo Para Servicio', 'Diagnostico', $4, '2026-10-06T13:00:00Z')`,
    [`z-${numero}`, numero, estado, remision],
  );
const mover = (numero: number, estado: string) => admin2.query(`UPDATE desk.tickets SET status = $2 WHERE number = $1`, [numero, estado]);

interface Etapa {
  etapa: string;
  fila: { numero: number; situacion: string }[];
  puestos: { puesto: number; ocupante: { numero: number } | null }[];
  saturacion: { ocupados: number; puestos: number };
}
const etapa = (cuerpo: { etapas: Etapa[] }, nombre: string) => cuerpo.etapas.find((e) => e.etapa === nombre)!;
const ocupantes = (cuerpo: { etapas: Etapa[] }, nombre: string) => etapa(cuerpo, nombre).puestos.map((p) => p.ocupante?.numero ?? null);
const asignaciones = async () =>
  (await hub.query(`SELECT numero, etapa, puesto, origen, hasta IS NULL AS vigente, cierre, cierre_motivo, asignado_por, cerrado_por FROM portal.tmc_agenda_asignaciones ORDER BY id`)).rows as {
    numero: number;
    etapa: string;
    puesto: number;
    origen: string;
    vigente: boolean;
    cierre: string | null;
    cierre_motivo: string | null;
    asignado_por: string;
    cerrado_por: string | null;
  }[];
const historial = async () =>
  ((await hub.query(`SELECT numero, clave, hasta IS NULL AS abierto, desde_real FROM portal.tmc_agenda_historial ORDER BY numero, desde, id`)).rows as { numero: number; clave: string; abierto: boolean; desde_real: boolean }[]).map((t) => [
    t.numero,
    t.clave,
    t.abierto,
    t.desde_real,
  ]);
const relojReal = Date.now.bind(Date);
let desfase = 0;
/** Como si hubieran pasado `ms` más: la frescura de la pasada mira el reloj del proceso. */
function pasan(ms: number): void {
  desfase += ms;
  vi.spyOn(Date, 'now').mockImplementation(() => relojReal() + desfase);
}

beforeAll(async () => {
  hub = poolDePrueba();
  await asegurarDeskTickets(hub);
  const urls = await asegurarDesk2(hub);
  admin2 = createPoolFromUrl(urls.urlAdmin);
  lector = crearPoolDesk2(urls.urlLector);
  const muerta = new URL(urls.urlLector);
  muerta.port = '1';
  caida = crearPoolDesk2(muerta.toString());
});
afterAll(async () => {
  await Promise.all([caida?.end(), lector?.end(), admin2?.end(), hub?.end()]);
});
beforeEach(async () => {
  await hub.query(
    `TRUNCATE desk.tickets, portal.tmc_agenda_historial, portal.tmc_estados_historial, portal.tmc_agenda_asignaciones, portal.tmc_agenda_flujo,
              portal.tmc_servicios_tipo, portal.tmc_estados_desk, portal.tmc_agenda_etapas, portal.tmc_agenda_duraciones RESTART IDENTITY`,
  );
  await hub.query(leer('050_trazabilidad_estados_categoria.sql'));
  await hub.query(leer('051_trazabilidad_agenda_config.sql'));
  await admin2.query('TRUNCATE desk.tickets, desk.ticket_transitions, public.calendario_cierres RESTART IDENTITY');
  await ticket(2001, 'Rev./Diagnostico', '2026-09-01');
  await ticket(2002, 'Rev./Diagnostico', '2026-09-02');
  await ticket(2003, 'Notificado', '2026-09-03');
  await ticket(2010, 'En Proceso');
  await ticket(2020, 'Notificación cliente');
  await ticket(2030, 'Ingresado');
  Object.assign(mundo, { ahora: AHORA, principal: 'viva', intentos: 0 });
  desfase = 0;
  reiniciarRegistroEstados();
  api = servidor();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('la agenda de punta a punta', () => {
  it('leer → repartir → asignar → el ticket cambia de estado → la pasada a demanda cierra su asignación → la agenda lo refleja', async () => {
    // 1. Leer: la principal contesta, y al servirla la pasada apunta el historial (primera observación de cada ticket).
    const inicial = await get('');
    expect(inicial.status).toBe(200);
    expect(inicial.body).toMatchObject({ totalAbiertos: 6, fuente: { fuente: 'principal', motivo: null }, estadoFuente: { fuente: 'principal', cortacircuitosHasta: null }, avisos: [] });
    expect(etapa(inicial.body, 'diagnostico').fila.map((t) => [t.numero, t.situacion])).toEqual([[2001, 'en_etapa'], [2002, 'en_etapa'], [2003, 'en_etapa'], [2030, 'entrada']]);
    expect(inicial.body.standby.map((t: { numero: number }) => t.numero)).toEqual([2020]);
    expect(await historial()).toHaveLength(6);

    // 2. El reparto inicial: la propuesta, y su confirmación ajustada (el Director deja fuera al 2002 y al 2003).
    const propuesta = await get('/reparto');
    expect(propuesta.body.reparto.map((l: { numero: number; etapa: string; puesto: number }) => [l.numero, l.etapa, l.puesto])).toEqual([[2001, 'diagnostico', 1], [2002, 'diagnostico', 2], [2003, 'diagnostico', 3], [2010, 'proceso', 1]]);
    const repartido = await post('/reparto', { reparto: [{ numero: 2001, etapa: 'diagnostico', puesto: 1 }, { numero: 2010, etapa: 'proceso', puesto: 1 }] });
    expect(repartido.status).toBe(200);
    expect(ocupantes(repartido.body, 'diagnostico')).toEqual([2001, null, null]);
    expect(ocupantes(repartido.body, 'proceso')).toEqual([2010, null, null, null]);

    // 3. Asignar al primero de la fila que ya está en la etapa: no pide motivo. Y queda firmado.
    const asignado = await post('/asignaciones', { numero: 2002, etapa: 'diagnostico', puesto: 2 });
    expect(asignado.status).toBe(200);
    expect(ocupantes(asignado.body, 'diagnostico')).toEqual([2001, 2002, null]);
    expect((await asignaciones()).map((a) => [a.numero, a.puesto, a.origen, a.vigente, a.asignado_por])).toEqual([
      [2001, 1, 'arranque', true, 'director@ambientalia.com.co'],
      [2010, 1, 'arranque', true, 'director@ambientalia.com.co'],
      [2002, 2, 'fila', true, 'director@ambientalia.com.co'],
    ]);

    // 4. En Desk 2.0 el 2001 pasa a esperar al cliente. Con una pasada buena de hace menos de 30 s no se repite:
    //    la agenda ya da su puesto por libre (manda el estado), pero su asignación sigue vigente en la tabla…
    await mover(2001, 'Notificación cliente');
    const enseguida = await get('');
    expect(ocupantes(enseguida.body, 'diagnostico')).toEqual([null, 2002, null]);
    expect((await asignaciones())[0]).toMatchObject({ numero: 2001, vigente: true });
    //    …así que ese puesto no se puede dar todavía: 409 que lo explica, y nada escrito.
    const pronto = await post('/asignaciones', { numero: 2003, etapa: 'diagnostico', puesto: 1 });
    expect(pronto.status).toBe(409);
    expect(pronto.body.error).toBe('puesto_ocupado');
    expect(pronto.body.message).toMatch(/puesto 1 de Diagnóstico/);
    expect(await asignaciones()).toHaveLength(3);

    // 5. Pasados los 30 s, pedir la agenda lanza la pasada: cierra sola la asignación del 2001 y apunta su cambio de estado.
    pasan(FRESCURA_MS + 1_000);
    const despues = await get('');
    expect(despues.status).toBe(200);
    expect((await asignaciones())[0]).toMatchObject({ numero: 2001, vigente: false, cierre: 'estado', cierre_motivo: null, cerrado_por: null });
    expect((await historial()).filter(([numero]) => numero === 2001)).toEqual([
      [2001, 'rev./diagnostico', false, false],
      [2001, 'notificacion cliente', true, true],
    ]);
    // 6. Y la agenda lo refleja: el puesto 1 libre, el 2001 en standby y el 2003 primero de la fila.
    expect(ocupantes(despues.body, 'diagnostico')).toEqual([null, 2002, null]);
    expect(etapa(despues.body, 'diagnostico').saturacion).toEqual({ ocupados: 1, puestos: 3 });
    expect(despues.body.standby.map((t: { numero: number }) => t.numero)).toEqual([2001, 2020]);
    expect(etapa(despues.body, 'diagnostico').fila.map((t) => t.numero)).toEqual([2003, 2030]);

    // 7. Ahora sí se puede dar ese puesto.
    const ahoraSi = await post('/asignaciones', { numero: 2003, etapa: 'diagnostico', puesto: 1 });
    expect(ahoraSi.status).toBe(200);
    expect(ocupantes(ahoraSi.body, 'diagnostico')).toEqual([2003, 2002, null]);
  });

  it('la pasada a demanda va también antes de asignar: sin haber leído la agenda, la asignación de un ticket que ya salió se cierra y su puesto se puede dar', async () => {
    await post('/reparto', { reparto: [{ numero: 2001, etapa: 'diagnostico', puesto: 1 }] });
    await mover(2001, 'Por Facturar');
    pasan(FRESCURA_MS + 1_000);
    const res = await post('/asignaciones', { numero: 2002, etapa: 'diagnostico', puesto: 1 });
    expect(res.status).toBe(200);
    expect((await asignaciones()).map((a) => [a.numero, a.vigente, a.cierre])).toEqual([[2001, false, 'estado'], [2002, true, null]]);
  });

  it('liberar va por número de ticket (D18): motivo obligatorio, firma, y 404 si ya no tiene puesto', async () => {
    await post('/reparto', { reparto: [{ numero: 2001, etapa: 'diagnostico', puesto: 1 }, { numero: 2002, etapa: 'diagnostico', puesto: 2 }] });
    expect((await post('/liberar', { numero: 2002, motivo: ' ' })).status).toBe(400);
    const res = await post('/liberar', { numero: 2002, motivo: 'El equipo se devolvió sin reparar' });
    expect(res.status).toBe(200);
    expect(ocupantes(res.body, 'diagnostico')).toEqual([2001, null, null]);
    expect((await asignaciones())[1]).toMatchObject({ numero: 2002, vigente: false, cierre: 'manual', cierre_motivo: 'El equipo se devolvió sin reparar', cerrado_por: 'director@ambientalia.com.co' });
    expect((await post('/liberar', { numero: 2002, motivo: 'Otra vez' })).status).toBe(404);
  });

  it('el reparto sólo rellena puestos libres (D19): con uno ocupado, 409 que dice cuál y no se guarda ninguna línea', async () => {
    await post('/asignaciones', { numero: 2001, etapa: 'diagnostico', puesto: 1 });
    const res = await post('/reparto', { reparto: [{ numero: 2010, etapa: 'proceso', puesto: 1 }, { numero: 2002, etapa: 'diagnostico', puesto: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/puesto 1 de Diagnóstico/);
    expect((await asignaciones()).map((a) => a.numero)).toEqual([2001]);
    expect((await hub.query(`SELECT 1 FROM portal.tmc_agenda_asignaciones WHERE cierre = 'reparto'`)).rows).toEqual([]);
  });

  it('sin el permiso no se escribe nada: un Lector lee la agenda pero no reparte, asigna, libera, marca ni configura', async () => {
    expect((await get('', lectorApp)).status).toBe(200);
    expect((await get('/reparto', lectorApp)).status).toBe(403);
    for (const [ruta, cuerpo] of [['/reparto', { reparto: [{ numero: 2001, etapa: 'diagnostico', puesto: 1 }] }], ['/asignaciones', { numero: 2001, etapa: 'diagnostico', puesto: 1 }], ['/liberar', { numero: 2001, motivo: 'x' }]] as const) {
      expect((await post(ruta, cuerpo, lectorApp)).body.error).toBe('forbidden_role');
    }
    expect((await put(`${A}/flujo/2030`, { flujo: 'equipo_nuevo' }, lectorApp)).status).toBe(403);
    expect((await put(`${A}/configuracion/puestos`, { etapa: 'diagnostico', puestos: 9 }, lectorApp)).status).toBe(403);
    expect(await asignaciones()).toEqual([]);
    expect((await hub.query(`SELECT puestos FROM portal.tmc_agenda_etapas WHERE etapa = 'diagnostico'`)).rows).toEqual([{ puestos: 3 }]);
  });

  it('flujo a mano: 409 si la fuente ya trae la clasificación; sin ella se marca y el ticket cambia de primera etapa', async () => {
    expect((await put(`${A}/flujo/2030`, { flujo: 'equipo_nuevo' })).body.error).toBe('flujo_de_la_fuente');
    await admin2.query(`UPDATE desk.tickets SET classification = NULL WHERE number = 2030`);
    const res = await put(`${A}/flujo/2030`, { flujo: 'equipo_nuevo' });
    expect(res.status).toBe(200);
    expect(etapa(res.body, 'proceso').fila.map((t) => t.numero)).toEqual([2030, 2010]);
    expect(etapa((await put(`${A}/flujo/2030`, { flujo: null })).body, 'diagnostico').fila.map((t) => t.numero)).toContain(2030);
  });
});

describe('configuración de la agenda', () => {
  const CONFIG = `${A}/configuracion`;
  interface Estado {
    clave: string;
    ticketsAbiertos: number;
    rol: string;
    actualizadoPor: string | null;
    categoria: string | null;
    etapa: string | null;
    categoriaPor: string | null;
    categoriaEn: string | null;
  }
  const estado = (cuerpo: { estados: Estado[] }, clave: string) => cuerpo.estados.find((e) => e.clave === clave)!;

  it('GET: lo sembrado, con los abiertos de la fuente de la agenda (no los de la réplica) y las dos firmas de cada estado', async () => {
    // La réplica, la de «Servicios», dice otra cosa: aquí no cuenta.
    await hub.query(`INSERT INTO desk.tickets (number, subject, status, status_type, synced_at) VALUES (2001, 'Servicio', 'Ingresado', 'Open', NOW()), (2002, 'Servicio', 'Ingresado', 'Open', NOW())`);
    const res = await request(api).get(CONFIG).set(lectorApp);
    expect(res.status).toBe(200);
    expect(res.body.etapas.map((e: { etapa: string; puestos: number }) => [e.etapa, e.puestos])).toEqual([['diagnostico', 3], ['proceso', 4], ['verificacion', 2]]);
    expect(res.body.duraciones.map((d: { etapa: string; tipo: string; dias: number }) => [d.etapa, d.tipo, d.dias])).toEqual([['diagnostico', '*', 3], ['proceso', '*', 4], ['verificacion', '*', 1]]);
    expect(res.body.estados).toHaveLength(23);
    expect(estado(res.body, 'rev./diagnostico')).toMatchObject({ ticketsAbiertos: 2, rol: 'cuenta', actualizadoPor: null, categoria: 'activa', etapa: 'diagnostico', categoriaPor: 'semilla (migracion 050)' });
    expect(estado(res.body, 'ingresado')).toMatchObject({ ticketsAbiertos: 1, categoria: 'entrada' });
  });

  it('puestos y duraciones: se guardan firmados y la agenda los usa; la «*» no se quita', async () => {
    const puestos = await put(`${CONFIG}/puestos`, { etapa: 'diagnostico', puestos: 1 });
    expect(puestos.body.etapas[0]).toMatchObject({ etapa: 'diagnostico', puestos: 1, actualizadoPor: 'director@ambientalia.com.co' });
    expect(etapa((await get('')).body, 'diagnostico').saturacion).toEqual({ ocupados: 0, puestos: 1 });

    const tipo = await put(`${CONFIG}/duraciones`, { etapa: 'diagnostico', tipo: 'Diagnóstico', dias: 7 });
    expect(tipo.body.duraciones.map((d: { etapa: string; tipo: string; dias: number }) => [d.etapa, d.tipo, d.dias])).toContainEqual(['diagnostico', 'diagnostico', 7]);
    expect((await get('/huecos?etapa=diagnostico&tipo=Diagnostico')).body).toMatchObject({ duracionDias: 7, sinTipo: false });
    const quitada = await put(`${CONFIG}/duraciones`, { etapa: 'diagnostico', tipo: 'diagnostico', dias: null });
    expect(quitada.body.duraciones).toHaveLength(3);
    expect((await put(`${CONFIG}/duraciones`, { etapa: 'diagnostico', tipo: '*', dias: null })).status).toBe(400);
    expect((await get(`/configuracion`)).body.duraciones).toHaveLength(3);
  });

  it('categoría y rol del reloj, cada uno por su ruta y con su firma: ninguna toca a la otra', async () => {
    const gerencia = cabecera(ADMIN, 'gerencia@ambientalia.com.co');
    // El rol, por la ruta de siempre y con el cuerpo de siempre.
    expect((await put('/api/trazabilidad/estados', { estado: 'Notificación cliente', rol: 'standby' }, gerencia)).status).toBe(200);
    // La categoría, por la de la agenda: no toca el rol ni su firma.
    const cat = await put(`${CONFIG}/estados`, { estado: 'Notificación  Cliente', categoria: 'activa', etapa: 'diagnostico' });
    expect(cat.status).toBe(200);
    expect(estado(cat.body, 'notificacion cliente')).toMatchObject({ rol: 'standby', actualizadoPor: 'gerencia@ambientalia.com.co', categoria: 'activa', etapa: 'diagnostico', categoriaPor: 'director@ambientalia.com.co' });
    // Y la agenda lo aplica: el 2020 deja el standby y entra en la fila de Diagnóstico.
    expect(etapa((await get('')).body, 'diagnostico').fila.map((t) => t.numero)).toContain(2020);
    // Volver a guardar el rol tampoco toca la categoría; GET /estados enseña las dos firmas.
    const rol = await put('/api/trazabilidad/estados', { estado: 'Notificación cliente', rol: 'cuenta' }, gerencia);
    expect(estado(rol.body, 'notificacion cliente')).toMatchObject({ rol: 'cuenta', actualizadoPor: 'gerencia@ambientalia.com.co', categoria: 'activa', etapa: 'diagnostico', categoriaPor: 'director@ambientalia.com.co' });
    expect(estado(rol.body, 'notificacion cliente').categoriaEn).toEqual(expect.any(String));
  });
});

// Si la principal cae, el cortacircuitos manda las lecturas al respaldo durante 60 s; y lo que NO puede
// pasar: que esa lectura (la réplica, aquí vacía) se tome por «todos cerrados» y cierre las asignaciones.
describe('cortacircuitos con la base de verdad', () => {
  it('con la principal caída la agenda sale del respaldo sin volver a esperarla, y la pasada no apunta historial ni cierra asignaciones; al volver, sigue', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await post('/reparto', { reparto: [{ numero: 2001, etapa: 'diagnostico', puesto: 1 }, { numero: 2010, etapa: 'proceso', puesto: 1 }] });
    const antes = await historial();
    expect(antes).toHaveLength(6);

    mundo.principal = 'caida';
    mundo.intentos = 0;
    pasan(FRESCURA_MS + 1_000);
    const caido = await get('');
    expect(caido.status).toBe(200);
    expect(caido.body).toMatchObject({ totalAbiertos: 0, fuente: { fuente: 'respaldo', motivo: 'error_conexion' }, estadoFuente: { cortacircuitosHasta: new Date(AHORA + CORTACIRCUITOS_MS).toISOString() } });
    expect(caido.body.avisos.map((a: { codigo: string }) => a.codigo)).toContain('fuente_respaldo');
    // Los puestos se conservan aunque la fuente de ahora no traiga sus tickets.
    expect(ocupantes(caido.body, 'diagnostico')).toEqual([2001, null, null]);
    expect(mundo.intentos).toBe(1);

    // Aunque Desk 2.0 vuelva, hasta que pasen los 60 s no se la prueba: ni las lecturas ni otra pasada.
    mundo.principal = 'viva';
    mundo.ahora = AHORA + CORTACIRCUITOS_MS - 1;
    pasan(FRESCURA_MS + 1_000);
    expect((await get('')).body.fuente.fuente).toBe('respaldo');
    expect(mundo.intentos).toBe(1);
    expect(await historial()).toEqual(antes);
    expect((await asignaciones()).every((a) => a.vigente)).toBe(true);

    // Pasados los 60 s se cierra: vuelve la principal y la pasada retoma su trabajo.
    await mover(2001, 'Notificación cliente');
    mundo.ahora = AHORA + CORTACIRCUITOS_MS;
    pasan(FRESCURA_MS + 1_000);
    const vuelta = await get('');
    expect(vuelta.body).toMatchObject({ totalAbiertos: 6, fuente: { fuente: 'principal' }, estadoFuente: { cortacircuitosHasta: null, ultimoFalloPrincipal: { motivo: 'error_conexion' } } });
    expect((await asignaciones()).map((a) => [a.numero, a.vigente, a.cierre])).toEqual([[2001, false, 'estado'], [2010, true, null]]);
    expect(JSON.stringify([warn.mock.calls, caido.body])).not.toMatch(/postgres:\/\/|agenda_lector_prueba/);
  });
});
