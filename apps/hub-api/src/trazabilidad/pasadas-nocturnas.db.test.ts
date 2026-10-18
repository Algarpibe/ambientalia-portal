import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { crearPoolDesk2 } from '../db-desk2.js';
import { asegurarDesk2, asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import { crearLectorCalibraciones } from './calibraciones-desk2.js';
import { crearLectorMaestro } from './maestro-desk2.js';
import { ejecutarPasadasNocturnas, pasosDesk2, ultimaNocturna } from './pasadas-nocturnas-repo.js';

// Las pasadas nocturnas (lote 10) contra Postgres: la 062 y el ejecutor con los planes y los aplicadores DE VERDAD,
// contra la imitación de Desk 2.0 (con su rol de sólo lectura). Lo limpio se aplica con la firma «Pasada automática»;
// lo retenido no toca nada; un día no se repite; sin Desk 2.0 no se escribe nada. Todo ficticio.

let hub: Pool;
let admin2: Pool;
let lector: Pool;

const HOY = '2026-10-19';
const MANANA = '2026-10-20';
const SQL_062 = readFileSync(fileURLToPath(new URL('../users/migrations/062_trazabilidad_pasadas_nocturnas.sql', import.meta.url)), 'utf8');

const pasos = (hoy: string, desk2: () => Pool | null = () => lector) => pasosDesk2(crearLectorMaestro(desk2), crearLectorCalibraciones(desk2), hoy);
const ejecutar = (hoy = HOY, desk2?: () => Pool | null) => ejecutarPasadasNocturnas(hub, { hoy, pasos: pasos(hoy, desk2) });

/** Un GRIMM EDM 180 del inventario del portal, en seguimiento y sin fecha (así no nace partida). */
const enPortal = (serial: string, cliente: string) =>
  hub.query(`INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, ultima_calibracion, activo) VALUES ($1, $1, $2, 'Grimm', 'EDM 180C', NULL, TRUE)`, [serial, cliente]);
const enMaestro = (id: string, serial: string, cliente: string) =>
  admin2.query(`INSERT INTO desk.equipos (id, serial, marca, modelo, cliente_nombre, active, raw) VALUES ($1, $2, 'GRIMM', 'EDM180C', $3, TRUE, '{}')`, [id, serial, cliente]);
const conFecha = (numero: number, serial: string, equipoId: string, fecha: string) =>
  admin2.query(`INSERT INTO desk.tickets (id, number, status, status_type, tipo_servicio, serial, equipo_id, raw, custom_fields, managed_by_app, synced_at) VALUES ($1, $2, 'Finalizado', 'Closed', 'Calibración', $3, $4, $5::jsonb, '{}'::jsonb, false, now())`, [
    `t-${numero}`,
    numero,
    serial,
    equipoId,
    JSON.stringify({ subject: 'reservado', cf: { cf_fecha_de_calibracion: fecha } }),
  ]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const filas = async (sql: string): Promise<Record<string, any>[]> => (await hub.query(sql)).rows;
const nocturnas = () => filas(`SELECT fecha::text AS fecha, tipo, resultado, motivos, huella, pasada_id, termino IS NOT NULL AS termino FROM portal.tmc_pasadas_nocturnas ORDER BY id`);

beforeAll(async () => {
  hub = poolDePrueba();
  await asegurarDeskTickets(hub);
  const urls = await asegurarDesk2(hub);
  admin2 = createPoolFromUrl(urls.urlAdmin);
  lector = crearPoolDesk2(urls.urlLector);
});
const VACIAR = `TRUNCATE desk.tickets, portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_contactos, portal.tmc_calibraciones, portal.tmc_calibraciones_pasadas, portal.tmc_maestro_sincronizaciones, portal.tmc_fst022_congelaciones, portal.tmc_pasadas_nocturnas RESTART IDENTITY CASCADE`;
afterAll(async () => {
  // La base es la misma para todos los ficheros: aquí no se deja nada sembrado.
  await hub?.query(VACIAR);
  await Promise.all([lector?.end(), admin2?.end(), hub?.end()]);
});
let log: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await hub.query(VACIAR);
  await admin2.query('TRUNCATE desk.equipos, desk.tickets, desk.ticket_transitions RESTART IDENTITY');
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  return () => log.mockRestore();
});

describe('migración 062', () => {
  it('ejecutarla otra vez (cada arranque) no toca lo apuntado', async () => {
    await hub.query(`INSERT INTO portal.tmc_pasadas_nocturnas (fecha, tipo, resultado, motivos, termino) VALUES ($1, 'maestro', 'retenida', '["x: 1"]', NOW())`, [HOY]);
    await hub.query(SQL_062);
    await hub.query(SQL_062);
    expect(await nocturnas()).toEqual([{ fecha: HOY, tipo: 'maestro', resultado: 'retenida', motivos: ['x: 1'], huella: null, pasada_id: null, termino: true }]);
  });

  it('un día y un tipo, una fila; tipo y resultado cerrados; en curso si y sólo si no ha terminado; motivos, una lista', async () => {
    await hub.query(`INSERT INTO portal.tmc_pasadas_nocturnas (fecha, tipo, resultado) VALUES ($1, 'maestro', 'en_curso')`, [HOY]);
    await expect(hub.query(`INSERT INTO portal.tmc_pasadas_nocturnas (fecha, tipo, resultado) VALUES ($1, 'maestro', 'en_curso')`, [HOY])).rejects.toThrow(/tmc_pasadas_nocturnas_dia_uq/);
    await expect(hub.query(`INSERT INTO portal.tmc_pasadas_nocturnas (fecha, tipo, resultado) VALUES ($1, 'avisos', 'en_curso')`, [HOY])).rejects.toThrow(/check/i);
    await expect(hub.query(`INSERT INTO portal.tmc_pasadas_nocturnas (fecha, tipo, resultado) VALUES ($1, 'calibraciones', 'enviada')`, [HOY])).rejects.toThrow(/check/i);
    await expect(hub.query(`INSERT INTO portal.tmc_pasadas_nocturnas (fecha, tipo, resultado) VALUES ($1, 'calibraciones', 'aplicada')`, [HOY])).rejects.toThrow(/tmc_pasadas_nocturnas_termino/);
    await expect(hub.query(`INSERT INTO portal.tmc_pasadas_nocturnas (fecha, tipo, resultado, termino) VALUES ($1, 'calibraciones', 'en_curso', NOW())`, [HOY])).rejects.toThrow(/tmc_pasadas_nocturnas_termino/);
    await expect(hub.query(`INSERT INTO portal.tmc_pasadas_nocturnas (fecha, tipo, resultado, motivos, termino) VALUES ($1, 'calibraciones', 'retenida', '{"x": 1}', NOW())`, [HOY])).rejects.toThrow(/check/i);
  });
});

describe('el ejecutor, de punta a punta', () => {
  it('LIMPIO: el maestro enlaza y las calibraciones traen la nueva, firmadas «Pasada automática» y sin usuario; cada apunte, con su auditoría', async () => {
    await enPortal('18A00001', 'Cliente Ficticio A');
    await enMaestro('eq-1', '18A00001', 'Cliente Ficticio A');
    await conFecha(1001, '18A00001', 'eq-1', '2026-09-20');
    expect(await ejecutar()).toEqual({ maestro: 'aplicada', calibraciones: 'aplicada' });

    const [sinc] = await filas(`SELECT id, por, por_id FROM portal.tmc_maestro_sincronizaciones`);
    const [pasada] = await filas(`SELECT id, por, por_id FROM portal.tmc_calibraciones_pasadas`);
    expect([sinc.por, sinc.por_id, pasada.por, pasada.por_id]).toEqual(['Pasada automática', null, 'Pasada automática', null]);
    expect(await filas(`SELECT desk_id, origen FROM portal.tmc_equipos`)).toEqual([{ desk_id: 'eq-1', origen: 'desk' }]);
    expect(await filas(`SELECT clave, fecha::text AS fecha, origen, ticket, estado, por, por_id FROM portal.tmc_calibraciones`)).toEqual([{ clave: '18A00001', fecha: '2026-09-20', origen: 'desk', ticket: 1001, estado: 'vigente', por: 'Pasada automática', por_id: null }]);
    const apuntes = await nocturnas();
    expect(apuntes.map((a) => [a.fecha, a.tipo, a.resultado, a.motivos, Number(a.pasada_id), a.termino])).toEqual([[HOY, 'maestro', 'aplicada', [], Number(sinc.id), true], [HOY, 'calibraciones', 'aplicada', [], Number(pasada.id), true]]);
    expect(apuntes.every((a) => /^[0-9a-f]{64}$/.test(a.huella))).toBe(true);
    expect(await ultimaNocturna(hub, 'calibraciones')).toMatchObject({ fecha: HOY, resultado: 'aplicada', motivos: [] });
  });

  it('el mismo día otra vez (la recuperación, otra instancia): no hace NADA; al día siguiente, sin nada que escribir, «sin cambios» y sin auditoría nueva', async () => {
    await enPortal('18A00001', 'Cliente Ficticio A');
    await enMaestro('eq-1', '18A00001', 'Cliente Ficticio A');
    await conFecha(1001, '18A00001', 'eq-1', '2026-09-20');
    await ejecutar();
    expect(await ejecutar()).toEqual({ maestro: null, calibraciones: null });
    expect(await ejecutar(MANANA)).toEqual({ maestro: 'sin_cambios', calibraciones: 'sin_cambios' });
    expect(await filas(`SELECT count(*)::int AS n FROM portal.tmc_maestro_sincronizaciones`)).toEqual([{ n: 1 }]);
    expect(await filas(`SELECT count(*)::int AS n FROM portal.tmc_calibraciones_pasadas`)).toEqual([{ n: 1 }]);
    expect((await nocturnas()).map((a) => [a.fecha, a.tipo, a.resultado])).toEqual([[HOY, 'maestro', 'aplicada'], [HOY, 'calibraciones', 'aplicada'], [MANANA, 'maestro', 'sin_cambios'], [MANANA, 'calibraciones', 'sin_cambios']]);
  });

  it('RETENIDA: un alta en el maestro no toca el inventario (ni deja auditoría) y se apunta con su motivo; las calibraciones, independientes, se aplican', async () => {
    await enPortal('18A00001', 'Cliente Ficticio A');
    await enMaestro('eq-1', '18A00001', 'Cliente Ficticio A');
    await enMaestro('eq-2', '18A00002', 'Cliente Ficticio B'); // un alta
    await conFecha(1001, '18A00001', 'eq-1', '2026-09-20');
    const antes = await filas(`SELECT * FROM portal.tmc_equipos ORDER BY clave`);
    expect(await ejecutar()).toEqual({ maestro: 'retenida', calibraciones: 'aplicada' });
    expect(await filas(`SELECT * FROM portal.tmc_equipos ORDER BY clave`)).toEqual(antes);
    expect(await filas(`SELECT count(*)::int AS n FROM portal.tmc_maestro_sincronizaciones`)).toEqual([{ n: 0 }]);
    const [maestro] = await nocturnas();
    expect(maestro).toMatchObject({ tipo: 'maestro', resultado: 'retenida', motivos: ['Equipos nuevos que se darían de alta (GRIMM EDM 180): 1'], pasada_id: null });
    // Con el serial en el ticket y sin enlace todavía, la calibración entra igual por serial.
    expect(await filas(`SELECT clave, por FROM portal.tmc_calibraciones`)).toEqual([{ clave: '18A00001', por: 'Pasada automática' }]);
  });

  it('SIN Desk 2.0 (sin la variable): «no disponible» en los dos, y no se escribe nada más que los dos apuntes', async () => {
    await enPortal('18A00001', 'Cliente Ficticio A');
    await enMaestro('eq-1', '18A00001', 'Cliente Ficticio A');
    expect(await ejecutar(HOY, () => null)).toEqual({ maestro: 'no_disponible', calibraciones: 'no_disponible' });
    expect(await filas(`SELECT desk_id FROM portal.tmc_equipos`)).toEqual([{ desk_id: null }]);
    expect(await filas(`SELECT count(*)::int AS n FROM portal.tmc_calibraciones`)).toEqual([{ n: 0 }]);
    const apuntes = await nocturnas();
    expect(apuntes.map((a) => [a.resultado, a.huella, a.termino])).toEqual([['no_disponible', null, true], ['no_disponible', null, true]]);
    expect(apuntes[0].motivos[0]).toMatch(/Desk 2\.0/);
  });

  it('más de 30 calibraciones nuevas en una noche: se retienen y no se trae ninguna', async () => {
    for (let i = 1; i <= 31; i++) {
      const serial = `18A${String(i).padStart(5, '0')}`;
      await enPortal(serial, 'Cliente Ficticio A');
      await conFecha(2000 + i, serial, `eq-${i}`, '2026-09-20');
    }
    expect((await ejecutar()).calibraciones).toBe('retenida');
    expect(await filas(`SELECT count(*)::int AS n FROM portal.tmc_calibraciones`)).toEqual([{ n: 0 }]);
    expect((await nocturnas())[1].motivos).toEqual(['Calibraciones nuevas: 31 (más de 30)']);
  });
});
