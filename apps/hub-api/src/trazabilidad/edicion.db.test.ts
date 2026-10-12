import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { hoyEnColombia } from '../ausencias/saldo.js';
import { crearPoolDesk2 } from '../db-desk2.js';
import { asegurarDesk2, asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import { crearLectorCalibraciones } from './calibraciones-desk2.js';
import { leerPlanCalibraciones, sincronizarCalibraciones } from './calibraciones-repo.js';
import { planAvisos } from './dominio.js';
import { crearFuenteAgenda } from './fuente.js';

// Editar a mano (lote 9d-2b) contra Postgres, con las rutas de verdad (sólo la
// sesión es un doble) y la imitación de Desk 2.0: registrar una calibración
// manual, corregir un ticket, anular y anular la partida de una fila de la
// hoja; lo que hace después la pasada de Desk 2.0 (no resucita lo anulado a
// mano; una corrección deja de contar cuando el ticket cambia en Zoho); cómo
// cambia el estado del equipo y si entra o sale de los avisos; y el blindaje:
// lo que está fuera de seguimiento no asoma en ellos. NADA de esto envía nada.
// Todo ficticio.

const SECRET = 'test-secret-edicion';
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

let hub: Pool;
let admin2: Pool;
let lector: Pool;
let api: express.Express;

/** Las escrituras usan SIEMPRE el día de hoy en Colombia: las fechas de estas pruebas se cuentan desde él. */
const HOY = hoyEnColombia();
const dia = (delta: number): string => new Date(Date.parse(`${HOY}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
const VENCE_EN_8 = dia(-357);
const VENCIDA = dia(-400);
const cabecera = (userId: string, correo: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: correo, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' })}` });
const comoAdmin = cabecera(ADMIN, 'director@example.com');
const comoLector = cabecera('00000000-0000-4000-8000-0000000000b2', 'lector@example.com');

const desk2 = () => crearLectorCalibraciones(() => lector);
const traer = () => sincronizarCalibraciones(hub, desk2(), null, { userId: ADMIN, email: 'director@example.com' }, HOY);
const plan = async () => (await leerPlanCalibraciones(hub, desk2(), HOY, false)).plan!.recuentos;

const enPortal = (clave: string, cliente: string, calibracion: string | null, extra: { marca?: string; modelo?: string; enSeguimiento?: boolean } = {}) =>
  hub.query(`INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, ultima_calibracion, desk_id, origen, en_seguimiento) VALUES ($1, $1, $2, $3, $4, $5, $6, 'desk', $7)`, [clave, cliente, extra.marca ?? 'GRIMM', extra.modelo ?? 'EDM 180C', calibracion, `eq-${clave}`, extra.enSeguimiento ?? true]);
const enDesk = (numero: number, serial: string, fecha: string) =>
  admin2.query(`INSERT INTO desk.tickets (id, number, status, status_type, tipo_servicio, serial, raw, custom_fields, managed_by_app, synced_at) VALUES ($1, $2, 'Finalizado', 'Closed', 'Calibración', $3, $4::jsonb, '{}'::jsonb, false, now())`, [`t-${numero}`, numero, serial, JSON.stringify({ subject: 'reservado', cf: { cf_fecha_de_calibracion: fecha } })]);
const cambiarEnZoho = (numero: number, fecha: string) => admin2.query(`UPDATE desk.tickets SET raw = jsonb_set(raw, '{cf}', $2::jsonb) WHERE number = $1`, [numero, JSON.stringify({ cf_fecha_de_calibracion: fecha })]);

/** Una congelación con la forma de la V3: `[serial, marca, fecha, clave]` por fila, desde la fila 6. */
async function congelar(filas: [string, string, string | null, string | null][]): Promise<void> {
  const cabeceras = [['Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Vigencia de Calibración (Dias)']];
  const { rows } = await hub.query(
    `INSERT INTO portal.tmc_fst022_congelaciones (archivo, sha256, hoja, fila_cabecera, cabeceras, total_filas, total_columnas, filas_guardadas, filas_equipo, filas_con_serial, filas_edm180, problemas, por)
     VALUES ('F-ST-022 ficticia V3.xlsx', $1, 'Trazabilidad', 5, $2::jsonb, 9, 6, 5, 4, 4, 2, '{}'::jsonb, 'director@example.com') RETURNING id`,
    ['ab'.repeat(32), JSON.stringify(cabeceras)],
  );
  let fila = 5;
  for (const [serial, marca, fecha, clave] of filas) {
    await hub.query(`INSERT INTO portal.tmc_fst022_congelada (congelacion_id, fila, celdas, es_equipo, serial_norm, clave_equipo) VALUES ($1, $2, $3::jsonb, true, $4, $5)`, [
      rows[0].id,
      ++fila,
      JSON.stringify(['Cliente Ficticio', marca, 'Modelo ficticio', serial, fecha ? { v: fecha, t: 'fecha' } : null, 100]),
      serial.toUpperCase(),
      clave,
    ]);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;
const FOTO = `id, clave, serial, serial_norm, fecha::text AS fecha, origen, ticket, corrige_ticket, corrige_fecha::text AS corrige_fecha, estado, motivo, pasada_id, por, anulada_pasada_id, anulada_por, anulada_motivo`;
const guardadas = async () => (await hub.query(`SELECT ${FOTO} FROM portal.tmc_calibraciones ORDER BY id`)).rows as Fila[];
/** Todo lo demás del módulo que una corrección NO debe tocar, como texto. */
const loDemas = async () =>
  JSON.stringify(await Promise.all(['tmc_equipos ORDER BY clave', 'tmc_seguimiento ORDER BY clave', 'tmc_contactos ORDER BY clave', 'tmc_calibraciones_pasadas ORDER BY id', 'tmc_fst022_congelada ORDER BY fila', 'tmc_maestro_sincronizaciones ORDER BY id'].map(async (t) => (await hub.query(`SELECT * FROM portal.${t}`)).rows)));

const equipos = async () => (await request(api).get(`/api/trazabilidad/equipos?hoy=${HOY}`).set(comoLector)).body as { equipos: Fila[]; contactos: never[] };
const estadoDe = async (clave: string) => {
  const e = (await equipos()).equipos.find((x) => x.clave === clave);
  return e ? [e.ultimaCalibracion, e.estado] : null;
};
/** ¿Le tocaría aviso hoy? (con o sin destinatario: es el plan que pintan «Avisos» y su simulación). */
const enAvisos = async (clave: string) => {
  const inv = await equipos();
  const p = planAvisos(inv.equipos as never[], HOY, inv.contactos);
  return [...p.correos, ...p.sinDestinatario].some((c) => JSON.stringify(c).includes(`"clave":"${clave}"`));
};
const hoja = async () => (await request(api).get(`/api/trazabilidad/hoja?hoy=${HOY}`).set(comoLector)).body as { filas: Fila[]; fueraDeHoja: Fila[] };
const filaHoja = async (serial: string) => (await hoja()).filas.find((f) => f.serial === serial)!;
const manual = (cuerpo: Fila, quien = comoAdmin) => request(api).post('/api/trazabilidad/calibraciones/manual').set(quien).send({ motivo: 'El certificado dice otra fecha.', ...cuerpo });
const anular = (id: number, motivo: string | undefined = 'Era de otro equipo.', quien = comoAdmin) => request(api).post(`/api/trazabilidad/calibraciones/${id}/anular`).set(quien).send({ motivo });
const anularPartida = (fila: number, quien = comoAdmin) => request(api).post(`/api/trazabilidad/calibraciones/partida/${fila}/anular`).set(quien).send({ motivo: 'La hoja tenía el año mal.' });

beforeAll(async () => {
  hub = poolDePrueba();
  await asegurarDeskTickets(hub);
  const urls = await asegurarDesk2(hub);
  admin2 = createPoolFromUrl(urls.urlAdmin);
  lector = crearPoolDesk2(urls.urlLector);
  api = express();
  api.use(express.json());
  api.use('/api', createTrazabilidadRouter(hub, crearFuenteAgenda({ hub, desk2: () => lector }), undefined, desk2()));
});
afterAll(async () => {
  await hub?.query(`TRUNCATE portal.tmc_calibraciones, portal.tmc_calibraciones_pasadas RESTART IDENTITY`);
  await Promise.all([lector?.end(), admin2?.end(), hub?.end()]);
});
beforeEach(async () => {
  await hub.query(`TRUNCATE desk.tickets, portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_contactos, portal.tmc_calibraciones, portal.tmc_calibraciones_pasadas, portal.tmc_maestro_sincronizaciones, portal.tmc_fst022_congelaciones RESTART IDENTITY CASCADE`);
  await admin2.query('TRUNCATE desk.equipos, desk.tickets, desk.ticket_transitions RESTART IDENTITY');
});

describe('registrar una calibración manual', () => {
  it('un equipo vencido recibe una manual de hoy: UNA fila nueva y firmada, pasa a «Al día» y sale de los avisos; nada más cambia en la base', async () => {
    await enPortal('18A00001', 'Cliente Ficticio A', VENCE_EN_8);
    await congelar([['18A00001', 'Grimm', VENCE_EN_8, '18A00001']]);
    await traer(); // deja su fila de partida
    expect(await estadoDe('18A00001')).toEqual([VENCE_EN_8, 'VENCE_30']);
    expect(await enAvisos('18A00001')).toBe(true);
    const antes = await loDemas();

    const res = await manual({ clave: '18A00001', fecha: HOY });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ clave: '18A00001', fila: 6, ultima: HOY, estado: 'AL_DIA' });
    expect(res.body.calibraciones.map((c: Fila) => [c.origen, c.fecha, c.cuenta])).toEqual([['manual', HOY, true], ['fst022', VENCE_EN_8, false]]);
    expect((await guardadas()).map((c) => [c.clave, c.fecha, c.origen, c.estado, c.motivo, c.por, c.ticket, c.corrige_ticket, c.pasada_id])).toEqual([
      ['18A00001', VENCE_EN_8, 'fst022', 'vigente', 'F-ST-022 congelada.', 'director@example.com', null, null, '1'],
      ['18A00001', HOY, 'manual', 'vigente', 'El certificado dice otra fecha.', 'director@example.com', null, null, null],
    ]);
    expect(await estadoDe('18A00001')).toEqual([HOY, 'AL_DIA']);
    expect(await enAvisos('18A00001')).toBe(false);
    expect(await loDemas()).toBe(antes);
    // El historial de la ficha dice lo mismo: la manual es la que cuenta, con quién y por qué.
    const historial = (await request(api).get('/api/trazabilidad/equipos/18A00001/calibraciones').set(comoLector)).body;
    expect(historial.ultima).toBe(HOY);
    expect(historial.calibraciones[0]).toMatchObject({ id: res.body.id, origen: 'manual', cuenta: true, por: 'director@example.com', motivo: 'El certificado dice otra fecha.' });
  });

  it('al revés: a un equipo al día se le anula su fecha y se registra la buena, a punto de vencer: ENTRA en los avisos (que siguen sin enviar nada)', async () => {
    await enPortal('18A00002', 'Cliente Ficticio B', dia(-10));
    await traer();
    expect([await estadoDe('18A00002'), await enAvisos('18A00002')]).toEqual([[dia(-10), 'AL_DIA'], false]);
    const [partida] = await guardadas();
    expect((await anular(Number(partida.id), 'La fecha era de otro equipo.')).body).toMatchObject({ ultima: null, estado: 'SIN_FECHA' });
    expect(await estadoDe('18A00002')).toEqual([null, 'SIN_FECHA']); // con todas anuladas no vuelve la del inventario
    expect((await manual({ clave: '18A00002', fecha: VENCE_EN_8 })).status).toBe(200);
    expect([await estadoDe('18A00002'), await enAvisos('18A00002')]).toEqual([[VENCE_EN_8, 'VENCE_30'], true]);
    const tablas = (await hub.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'portal' AND table_name ~ 'outbox|envio|mensaje|correo'`)).rows.map((r: Fila) => r.table_name).filter((t: string) => t.startsWith('tmc_'));
    expect(tablas).toEqual([]);
  });

  it('un Lector no puede (403) y la base queda como estaba; un equipo que no existe es un 404; una fecha de mañana, un 400', async () => {
    await enPortal('18A00001', 'Cliente Ficticio A', VENCIDA);
    const antes = [await guardadas(), await loDemas()];
    expect((await manual({ clave: '18A00001', fecha: HOY }, comoLector)).status).toBe(403);
    expect((await anular(1, 'm', comoLector)).status).toBe(403);
    expect((await anularPartida(6, comoLector)).status).toBe(403);
    expect((await manual({ clave: 'NO-EXISTE', fecha: HOY })).status).toBe(404);
    expect((await manual({ clave: '18A00001', fecha: dia(1) })).body).toMatchObject({ error: 'invalid_input', field: 'fecha' });
    expect([await guardadas(), await loDemas()]).toEqual(antes);
  });
});

describe('anular, y la pasada de Desk 2.0 después', () => {
  it('de punta a punta: una fecha de ticket anulada a mano deja de contar, queda firmada por la persona, y la pasada NO la resucita mientras Zoho siga igual; si cambia en Zoho, entra la nueva', async () => {
    await enPortal('18A00001', 'Cliente Ficticio A', VENCIDA);
    await enDesk(1001, '18A00001', dia(-20));
    await traer();
    expect(await estadoDe('18A00001')).toEqual([dia(-20), 'AL_DIA']);
    const deTicket = (await guardadas()).find((c) => c.ticket === 1001)!;

    expect((await anular(Number(deTicket.id), undefined)).status).toBe(200);
    expect((await guardadas()).find((c) => c.ticket === 1001)).toMatchObject({ fecha: dia(-20), estado: 'anulada', anulada_por: 'director@example.com', anulada_motivo: 'Era de otro equipo.', anulada_pasada_id: null });
    expect(await estadoDe('18A00001')).toEqual([VENCIDA, 'VENCIDA']); // vuelve a valer su partida

    // La pasada: Zoho sigue diciendo lo mismo, así que no la vuelve a traer.
    expect(await plan()).toMatchObject({ noResucitan: 1, nuevas: 0, cambiadas: 0 });
    const antes = await guardadas();
    await traer();
    expect(await guardadas()).toEqual(antes);
    expect(await estadoDe('18A00001')).toEqual([VENCIDA, 'VENCIDA']);
    // Anularla otra vez es un 409: ya lo estaba.
    expect((await anular(Number(deTicket.id))).body).toMatchObject({ error: 'ya_anulada' });
    expect((await anular(999)).status).toBe(404);

    // Si alguien corrige el ticket en Zoho, la fecha nueva sí entra.
    await cambiarEnZoho(1001, dia(-15));
    await traer();
    expect((await guardadas()).filter((c) => c.ticket === 1001).map((c) => [c.fecha, c.estado])).toEqual([[dia(-20), 'anulada'], [dia(-15), 'vigente']]);
    expect(await estadoDe('18A00001')).toEqual([dia(-15), 'AL_DIA']);
  });

  it('una fila en revisión (fecha futura) se resuelve anulándola o registrando la manual que la corrige: nunca cambia de estado editándola', async () => {
    await enPortal('18A00001', 'Cliente Ficticio A', VENCIDA);
    await enDesk(1003, '18A00001', dia(90));
    await traer();
    const futura = (await guardadas()).find((c) => c.ticket === 1003)!;
    expect([futura.estado, await estadoDe('18A00001')]).toEqual(['en_revision', [VENCIDA, 'VENCIDA']]);
    expect((await manual({ clave: '18A00001', fecha: dia(-30), corrigeTicket: 1003 })).status).toBe(200);
    expect(await estadoDe('18A00001')).toEqual([dia(-30), 'AL_DIA']);
    expect((await guardadas()).find((c) => c.ticket === 1003)).toMatchObject({ fecha: dia(90), estado: 'en_revision' });
    expect((await anular(Number(futura.id))).status).toBe(200);
    expect((await guardadas()).find((c) => c.ticket === 1003)).toMatchObject({ fecha: dia(90), estado: 'anulada' });
  });
});

describe('una manual que corrige un ticket', () => {
  it('tapa la fecha de Desk —aunque sea ANTERIOR— mientras el ticket siga igual en Zoho; cuando el ticket cambia en la imitación, la corrección deja de contar (y sigue guardada)', async () => {
    await enPortal('18A00001', 'Cliente Ficticio A', VENCIDA);
    await enPortal('18A00009', 'Cliente Ficticio Z', VENCIDA);
    await enDesk(1001, '18A00001', dia(-20));
    await enDesk(1009, '18A00009', dia(-25));
    await traer();

    const res = await manual({ clave: '18A00001', fecha: dia(-50), corrigeTicket: 1001 });
    expect(res.status).toBe(200);
    expect(res.body.calibraciones.find((c: Fila) => c.cuenta)).toMatchObject({ origen: 'manual', fecha: dia(-50), corrigeTicket: 1001 });
    expect((await guardadas()).at(-1)).toMatchObject({ origen: 'manual', fecha: dia(-50), corrige_ticket: 1001, corrige_fecha: dia(-20), estado: 'vigente' });
    expect(await estadoDe('18A00001')).toEqual([dia(-50), 'AL_DIA']);

    // No se corrige dos veces el mismo ticket, ni el ticket de otro equipo.
    expect((await manual({ clave: '18A00001', fecha: dia(-51), corrigeTicket: 1001 })).body).toMatchObject({ error: 'ticket_ya_corregido' });
    expect((await manual({ clave: '18A00001', fecha: dia(-51), corrigeTicket: 1009 })).body).toMatchObject({ error: 'ticket_sin_calibracion' });
    expect((await manual({ clave: '18A00001', fecha: dia(-51), corrigeTicket: 4040 })).status).toBe(409);

    // La pasada, con Zoho igual: nada cambia y la corrección sigue mandando.
    const antes = await guardadas();
    await traer();
    expect(await guardadas()).toEqual(antes);
    expect(await estadoDe('18A00001')).toEqual([dia(-50), 'AL_DIA']);

    // El ticket cambia en Zoho: la pasada anula su fila e inserta otra, y la corrección ya no la tapa.
    await cambiarEnZoho(1001, dia(-5));
    await traer();
    expect(await estadoDe('18A00001')).toEqual([dia(-5), 'AL_DIA']);
    expect((await guardadas()).filter((c) => c.origen === 'manual')).toMatchObject([{ fecha: dia(-50), estado: 'vigente', corrige_fecha: dia(-20) }]);
    // Y ahora sí se puede volver a corregir ese ticket (la corrección vieja ya no es de su fecha).
    expect((await manual({ clave: '18A00001', fecha: dia(-6), corrigeTicket: 1001 })).status).toBe(200);
    expect(await estadoDe('18A00001')).toEqual([dia(-6), 'AL_DIA']);
  });

  it('dos correcciones del mismo ticket a la vez: entra una y la otra es un 409', async () => {
    await enPortal('18A00001', 'Cliente Ficticio A', VENCIDA);
    await enDesk(1001, '18A00001', dia(-20));
    await traer();
    const [a, b] = await Promise.all([manual({ clave: '18A00001', fecha: dia(-50), corrigeTicket: 1001 }), manual({ clave: '18A00001', fecha: dia(-60), corrigeTicket: 1001 })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await guardadas()).filter((c) => c.origen === 'manual')).toHaveLength(1);
  });
});

describe('lo que no está en seguimiento: filas sólo de la hoja y equipos enlazados', () => {
  /** Fila 6: sólo en la hoja. Fila 7: enlazada con un equipo fuera de seguimiento. Filas 8 y 9: el mismo serial dos veces. */
  const sembrar = async () => {
    await enPortal('18A00001', 'Cliente Ficticio A', dia(-10));
    await enPortal('HB-0002', 'Cliente Ficticio A', null, { marca: 'Horiba', modelo: 'APNA-370', enSeguimiento: false });
    await congelar([['HB-0001', 'Horiba', dia(-100), null], ['HB-0002', 'Horiba', dia(-500), null], ['TH-0001', 'Thermo', dia(-30), null], ['th-0001', 'Thermo', dia(-40), null]]);
  };

  it('una fila sólo de la hoja: la manual se guarda por su serial, sin clave, y la pestaña se la atribuye; su partida de la hoja se puede anular (se guarda ya anulada: la congelación no se toca)', async () => {
    await sembrar();
    const antes = await loDemas();
    expect(await filaHoja('HB-0001')).toMatchObject({ situacion: 'hoja', ultimaCalibracion: dia(-100), estado: 'AL_DIA' });

    // La fecha buena es ANTERIOR a la de la hoja: mientras la partida cuente, no manda.
    const res = await manual({ fila: 6, fecha: dia(-380) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ clave: null, fila: 6, ultima: dia(-100) });
    expect((await guardadas()).at(-1)).toMatchObject({ clave: null, serial: 'HB-0001', serial_norm: 'HB-0001', fecha: dia(-380), origen: 'manual', estado: 'vigente' });

    const partida = await anularPartida(6);
    expect(partida.status).toBe(200);
    expect(partida.body).toMatchObject({ fila: 6, ultima: dia(-380), estado: 'VENCIDA' });
    expect((await guardadas()).at(-1)).toMatchObject({ clave: null, serial: 'HB-0001', fecha: dia(-100), origen: 'fst022', estado: 'anulada', motivo: 'F-ST-022 congelada (fila 6).', anulada_por: 'director@example.com', anulada_motivo: 'La hoja tenía el año mal.', anulada_pasada_id: null });
    const f = await filaHoja('HB-0001');
    expect(f.calibraciones.map((c: Fila) => [c.origen, c.estado, c.cuenta])).toEqual([['fst022', 'anulada', false], ['manual', 'vigente', true]]);
    expect(f.calibraciones[1]).toMatchObject({ por: 'director@example.com', motivo: 'El certificado dice otra fecha.' });
    // Ya no hay partida que tomar de la hoja: otra vez es un 409.
    expect((await anularPartida(6)).body).toMatchObject({ error: 'partida_guardada' });
    expect(await loDemas()).toBe(antes);
  });

  it('con el serial repetido en la hoja no se sabría de cuál de las filas es: 409 y nada escrito; una fila que no existe, 404', async () => {
    await sembrar();
    expect((await manual({ fila: 8, fecha: HOY })).body).toMatchObject({ error: 'serial_ambiguo' });
    expect((await anularPartida(9)).body).toMatchObject({ error: 'serial_ambiguo' });
    expect((await manual({ fila: 77, fecha: HOY })).status).toBe(404);
    expect(await guardadas()).toEqual([]);
  });

  it('BLINDAJE: una manual VENCIDA en un equipo fuera de seguimiento se ve en la pestaña y NO asoma en Equipos ni en los avisos (byte a byte); lo único que la tiene fuera es `en_seguimiento`', async () => {
    await sembrar();
    const antes = JSON.stringify(await equipos());
    expect(antes).not.toContain('HB-0002');

    const res = await manual({ clave: 'HB-0002', fecha: VENCE_EN_8 }); // pediría aviso a 30 días… si estuviera en seguimiento
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ clave: 'HB-0002', fila: 7, ultima: VENCE_EN_8, estado: 'VENCE_30' });
    expect((await guardadas()).at(-1)).toMatchObject({ clave: 'HB-0002', origen: 'manual' });
    expect(await filaHoja('HB-0002')).toMatchObject({ situacion: 'enlazado', ultimaCalibracion: VENCE_EN_8, estado: 'VENCE_30' });
    expect(JSON.stringify(await equipos())).toBe(antes);
    expect(await enAvisos('HB-0002')).toBe(false);
    // Por la fila de la hoja se llega al mismo equipo: también con su clave.
    expect((await manual({ fila: 7, fecha: HOY })).body).toMatchObject({ clave: 'HB-0002', ultima: HOY });
    expect((await guardadas()).at(-1)).toMatchObject({ clave: 'HB-0002', fecha: HOY });

    // Contraprueba: con la columna a TRUE (que ningún código escribe) sí se colaría.
    await anular(Number((await guardadas()).at(-1)!.id));
    await hub.query(`UPDATE portal.tmc_equipos SET en_seguimiento = TRUE WHERE clave = 'HB-0002'`);
    expect(await enAvisos('HB-0002')).toBe(true);
  });
});
