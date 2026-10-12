import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import { planAvisos } from './dominio.js';

// BLINDAJE de «en seguimiento» (lote 9d-2a, migración 058) contra Postgres, con
// las rutas de verdad (sólo la sesión es un doble): equipos de otras marcas
// dados de alta FUERA de seguimiento —con fechas que pedirían aviso, clientes
// con contacto puesto a mano y tickets abiertos con su serial— no cambian ni un
// byte de lo que alimenta Resumen, Equipos, Calendario, Avisos, su simulación,
// los contactos y Servicios. Resumen, Calendario y la simulación se calculan en
// el navegador con lo que da GET /equipos: si esa respuesta es idéntica, lo son.
// Clientes y seriales inventados (el repo es público).

const SECRET = 'test-secret-seguimiento';
process.env.JWT_SECRET = SECRET;
vi.mock('../db.js', () => ({
  getHubPool: () => ({ query: async () => ({ rows: [{ role: 'admin', status: 'active', apps: ['trazabilidad-mantenimientos'], token_version: 0 }], rowCount: 1 }), on: () => {} }),
}));
const { createTrazabilidadRouter } = await import('./router.js');

let db: Pool;
let api: express.Express;
const HOY = '2026-10-12';
const admin = { Authorization: `Bearer ${jwt.sign({ sub: 'admin@example.com', user_id: '00000000-0000-4000-8000-0000000000a1', token_version: 0 }, SECRET, { algorithm: 'HS256' })}` };
const SQL_058 = readFileSync(fileURLToPath(new URL('../users/migrations/058_trazabilidad_en_seguimiento.sql', import.meta.url)), 'utf8');
const caido = (): never => {
  throw new Error('Desk 2.0 no contesta');
};

const equipo = (clave: string, serial: string, cliente: string, marca: string, modelo: string, calibracion: string | null, enSeguimiento: boolean) =>
  db.query(
    `INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, ultima_calibracion, en_seguimiento, desk_id, origen, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'desk', '2026-10-01T00:00:00Z')`,
    [clave, serial, cliente, marca, modelo, calibracion, enSeguimiento, `eq-${clave}`],
  );
const ticket = (numero: number, serial: string, estado: 'Open' | 'Closed', contacto: Record<string, unknown>) =>
  db.query(
    `INSERT INTO desk.tickets (number, subject, status, status_type, serial, codigo_servicio, tipo_servicio, created_time, fecha_creacion_ticket, synced_at, raw)
     VALUES ($1, $2, $3, $4, $5, $6, 'Calibración', '2026-10-01T15:00:00Z', '2026-10-01', NOW(), $7::jsonb)`,
    [numero, `CAL_${serial} asunto ficticio`, estado === 'Open' ? 'En proceso' : 'Finalizado', estado, serial, `CAL_${serial}`, JSON.stringify(contacto)],
  );

/** Lo que hay ANTES de traer otras marcas: tres GRIMM EDM 180 en seguimiento, su seguimiento, contactos y los tickets (también los de otras marcas, que ya existían). */
async function sembrar(): Promise<void> {
  await equipo('18A00001', '18A00001', 'Cliente Ficticio A', 'GRIMM', 'EDM 180C', '2025-10-20', true); // vence en 8 días
  await equipo('18A00002', '18A00002', 'Cliente Ficticio B', 'GRIMM', 'EDM 180C', '2025-06-01', true); // vencida
  await equipo('18A00003', '18A00003', 'Cliente Ficticio C', 'GRIMM', 'EDM 180D', '2026-06-01', true); // al día
  await db.query(`INSERT INTO portal.tmc_seguimiento (clave, aviso_enviado, nota, actualizado_por, actualizado_en) VALUES ('18A00002', '2026-09-01', 'nota ficticia', 'tecnico@example.com', '2026-09-01T00:00:00Z')`);
  await db.query(
    `INSERT INTO portal.tmc_contactos (clave, cliente, emails, nombre, actualizado_por, actualizado_en)
     VALUES ('cliente ficticio a', 'Cliente Ficticio A', '{compras@cliente-a.example}', 'Ana Ficticia', 'comercial@example.com', '2026-09-01T00:00:00Z'),
            ('cliente ficticio h s.a.s.', 'Cliente Ficticio H S.A.S.', '{calidad@cliente-h.example}', '', 'comercial@example.com', '2026-09-01T00:00:00Z')`,
  );
  await ticket(501, '18a00001', 'Closed', { email: 'planta@cliente-a.example', contact: { firstName: 'Luis', lastName: 'Ficticio' } });
  await ticket(502, '18A00002', 'Closed', { email: 'taller@cliente-b.example' });
  await ticket(601, 'HB-0001', 'Open', { email: 'laboratorio@cliente-a.example', contact: { firstName: 'Eva', lastName: 'Ficticia', account: { accountName: 'Cuenta Ficticia A' } } });
  await ticket(602, 'hb-0002', 'Open', { contact: { firstName: 'Noa', lastName: 'Ficticia', email: 'noa@cliente-h.example' } });
  await ticket(603, '18A00003', 'Open', { contact: { firstName: 'Teo', lastName: 'Ficticio' } });
}

/** Las otras marcas que trae el maestro, fuera de seguimiento: con todo lo que haría ruido si se colaran. */
async function traerOtrasMarcas(): Promise<void> {
  await equipo('HB-0001', 'HB-0001', 'Cliente Ficticio A', 'Horiba', 'APNA-370', '2025-10-20', false); // misma fecha «a 8 días» y cliente con contacto a mano
  await equipo('HB-0002', 'HB-0002', 'Cliente Ficticio H S.A.S.', 'Horiba', 'APSA-370', '2024-01-01', false); // vencida, con contacto a mano y ticket abierto
  await equipo('KN-0001', 'KN-0001', 'Cliente Ficticio A', 'Kunak', 'AIR Pro', '2025-10-22', false); // sin ticket: iría en el correo de ese cliente
  await equipo('18A00003-2', '18a00003', 'Cliente Ficticio Z', 'GRIMM', 'EDM 280', '2025-10-25', false); // un GRIMM de otro modelo con el serial de uno en seguimiento
}

const pedir = (ruta: string) => request(api).get(`/api/trazabilidad/${ruta}?hoy=${HOY}`).set(admin);
/** Todo lo que la app enseña del inventario y de los tickets, como texto: equipos y contactos, el plan de avisos (lo que usan «Avisos» y su simulación) y servicios. */
async function foto(): Promise<Record<string, string>> {
  const [equipos, servicios] = await Promise.all([pedir('equipos'), pedir('servicios')]);
  expect([equipos.status, servicios.status]).toEqual([200, 200]);
  return {
    equipos: JSON.stringify(equipos.body),
    avisos: JSON.stringify(planAvisos(equipos.body.equipos, HOY, equipos.body.contactos)),
    servicios: JSON.stringify(servicios.body),
    seguimiento: JSON.stringify((await db.query(`SELECT * FROM portal.tmc_seguimiento ORDER BY clave`)).rows),
  };
}

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
  await db.query('TRUNCATE portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_contactos, portal.tmc_calibraciones, portal.tmc_estados_historial, portal.tmc_servicios_tipo, desk.tickets RESTART IDENTITY');
});

describe('migración 058', () => {
  it('lo que ya había (y lo que se inserte sin decirlo) queda en seguimiento; ejecutarla otra vez, en cada arranque, no cambia a nadie', async () => {
    await db.query(`INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo) VALUES ('18A00009', '18A00009', 'Cliente Ficticio A', 'GRIMM', 'EDM 180C')`);
    await equipo('HB-0009', 'HB-0009', 'Cliente Ficticio H', 'Horiba', 'APNA-370', null, false);
    const antes = (await db.query(`SELECT * FROM portal.tmc_equipos ORDER BY clave`)).rows as Record<string, unknown>[];
    expect(antes.map((e) => [e.clave, e.en_seguimiento])).toEqual([['18A00009', true], ['HB-0009', false]]);
    await db.query(SQL_058);
    await db.query(SQL_058);
    expect((await db.query(`SELECT * FROM portal.tmc_equipos ORDER BY clave`)).rows).toEqual(antes);
    await expect(db.query(`UPDATE portal.tmc_equipos SET en_seguimiento = NULL`)).rejects.toThrow(/not-null|null value/i);
  });
});

describe('las otras marcas, fuera de seguimiento, no asoman en nada de lo que ya había', () => {
  it('GET /equipos (y con él Resumen, Calendario y contactos), el plan de avisos y su simulación, y GET /servicios son IDÉNTICOS byte a byte antes y después de darlas de alta', async () => {
    await sembrar();
    await pedir('servicios'); // la primera lectura apunta el historial de estados: la foto se hace con él ya apuntado
    const antes = await foto();
    // La foto no es trivial: tres equipos, un aviso que saldría y el contacto de un ticket.
    const equipos = JSON.parse(antes.equipos).equipos as { clave: string; estado: string; contacto: { email: string } | null }[];
    expect(equipos.map((e) => [e.clave, e.estado, e.contacto?.email ?? null])).toEqual([['18A00001', 'VENCE_30', 'compras@cliente-a.example'], ['18A00002', 'VENCIDA', 'taller@cliente-b.example'], ['18A00003', 'AL_DIA', null]]);
    expect(JSON.parse(antes.avisos).correos).toHaveLength(1);
    expect((JSON.parse(antes.servicios).servicios as { numero: number; cliente: string }[]).map((s) => [s.numero, s.cliente])).toEqual([[603, 'Cliente Ficticio C'], [602, 'Noa Ficticia'], [601, 'Cuenta Ficticia A']]);

    await traerOtrasMarcas();
    expect(await foto()).toEqual(antes);

    // Contraprueba: lo único que las tiene fuera es `en_seguimiento`. Con la columna a TRUE se colarían en todo.
    await db.query(`UPDATE portal.tmc_equipos SET en_seguimiento = TRUE`);
    const colados = await foto();
    for (const k of ['equipos', 'avisos', 'servicios'] as const) expect(colados[k], k).not.toBe(antes[k]);
  });

  it('no se les puede guardar seguimiento ni marcar un aviso: para la app ese equipo no está en el inventario', async () => {
    await sembrar();
    await traerOtrasMarcas();
    const antes = (await foto()).seguimiento;
    const seguimiento = await request(api).put('/api/trazabilidad/seguimiento/HB-0001').set(admin).send({ enAmbientalia: true, avisoEnviado: '2026-10-12', servicioProgramado: null, nota: '' });
    expect([seguimiento.status, seguimiento.body.error]).toEqual([404, 'not_found']);
    const avisos = await request(api).post('/api/trazabilidad/avisos').set(admin).send({ claves: ['HB-0001', 'HB-0002', '18A00003-2', '18A00001'], fecha: '2026-10-12' });
    expect([avisos.status, avisos.body]).toEqual([200, { actualizados: 1 }]);
    expect((await db.query(`SELECT clave FROM portal.tmc_seguimiento ORDER BY clave`)).rows).toEqual([{ clave: '18A00001' }, { clave: '18A00002' }]);
    expect(antes).not.toContain('HB-0001');
  });
});
