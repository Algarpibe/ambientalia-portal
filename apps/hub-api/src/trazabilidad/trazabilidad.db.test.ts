import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import * as repo from './repo.js';
import type { FilaImportada } from './types.js';

// El SQL de verdad contra Postgres: importación, reimportación (altas, cambios,
// retiradas), seguimiento y avisos en bloque.

let db: Pool;
const actor = { userId: '00000000-0000-4000-8000-000000000001', email: 'st@ambientalia.com.co' };
const hoy = '2026-10-06';

const fila = (serial: string, cliente: string, ultimaCalibracion: string | null, extra: Partial<FilaImportada> = {}): FilaImportada => ({
  serial,
  cliente,
  marca: 'Grimm',
  modelo: 'EDM 180C',
  fechaFactura: '2019-03-04',
  hojaVida: `HV_${serial}_EDM180C`,
  ultimaEntrada: null,
  ultimaCalibracion,
  entradasSt: 1,
  calibracionesPeriodo: 2,
  correctivosPeriodo: 0,
  ...extra,
});

beforeAll(async () => {
  db = poolDePrueba();
  await asegurarDeskTickets(db);
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query('TRUNCATE portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_importaciones, desk.tickets RESTART IDENTITY');
});

describe('importar', () => {
  it('da de alta, calcula el estado y marca los seriales repetidos', async () => {
    const r = await repo.importar(
      db,
      { archivo: 'F-ST-022.xlsx', filas: [fila('18A00006', 'Cliente Cuatro', '2025-10-17'), fila('18A00004', 'Cliente Cinco', '2024-03-26'), fila('18A00004', 'Cliente Seis', '2024-03-26')] },
      actor,
      false,
    );
    expect(r).toMatchObject({ total: 3, nuevos: 3, actualizados: 0, retirados: 0, por: actor.email });

    const eq = await repo.listarEquipos(db, hoy);
    expect(eq.map((e) => e.clave).sort()).toEqual(['18A00004', '18A00004-2', '18A00006']);
    const chem = eq.find((e) => e.clave === '18A00006')!;
    expect(chem).toMatchObject({ vence: '2026-10-17', vigenciaDias: 11, estado: 'VENCE_30', serialRepetido: false, seguimiento: null });
    expect(eq.find((e) => e.clave === '18A00004-2')).toMatchObject({ cliente: 'Cliente Seis', serialRepetido: true, estado: 'FUERA_CICLO' });
    expect(await repo.ultimaImportacion(db)).toMatchObject({ archivo: 'F-ST-022.xlsx', total: 3 });
  });

  it('simular cuenta sin escribir', async () => {
    const r = await repo.importar(db, { archivo: 'x.xlsx', filas: [fila('A1', 'C', null)] }, actor, true);
    expect(r).toMatchObject({ id: null, nuevos: 1 });
    expect(await repo.listarEquipos(db, hoy)).toEqual([]);
    expect(await repo.ultimaImportacion(db)).toBeNull();
  });

  it('reimportar: actualiza lo que cambia, retira lo que falta y conserva el seguimiento', async () => {
    await repo.importar(db, { archivo: 'v1.xlsx', filas: [fila('A1', 'C1', '2025-01-01'), fila('A2', 'C2', '2025-01-01'), fila('A3', 'C3', '2025-01-01')] }, actor, false);
    await repo.guardarSeguimiento(db, 'A3', { enAmbientalia: true, avisoEnviado: '2026-09-01', servicioProgramado: null, nota: 'llamar a Ana' }, actor);

    const r2 = await repo.importar(db, { archivo: 'v2.xlsx', filas: [fila('A1', 'C1', '2025-01-01'), fila('A2', 'C2', '2026-09-30')] }, actor, false);
    expect(r2).toMatchObject({ nuevos: 0, actualizados: 1, retirados: 1 });
    expect((await repo.listarEquipos(db, hoy)).map((e) => e.clave)).toEqual(['A1', 'A2']);

    // A3 vuelve en otra importación: reaparece con su seguimiento intacto.
    const r3 = await repo.importar(db, { archivo: 'v3.xlsx', filas: [fila('A1', 'C1', '2025-01-01'), fila('A2', 'C2', '2026-09-30'), fila('A3', 'C3', '2025-01-01')] }, actor, false);
    expect(r3).toMatchObject({ nuevos: 0, actualizados: 1, retirados: 0 });
    const a3 = (await repo.listarEquipos(db, hoy)).find((e) => e.clave === 'A3')!;
    expect(a3.seguimiento).toMatchObject({ enAmbientalia: true, avisoEnviado: '2026-09-01', nota: 'llamar a Ana', actualizadoPor: actor.email });
  });
});

describe('seguimiento y avisos', () => {
  beforeEach(async () => {
    await repo.importar(db, { archivo: 'x.xlsx', filas: [fila('B1', 'C', '2025-10-01'), fila('B2', 'C', '2025-10-20')] }, actor, false);
  });

  it('guardar seguimiento de un equipo inexistente es 404', async () => {
    await expect(
      repo.guardarSeguimiento(db, 'ZZ', { enAmbientalia: false, avisoEnviado: null, servicioProgramado: null, nota: '' }, actor),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('el aviso en bloque sólo pone la fecha y respeta el resto del seguimiento', async () => {
    await repo.guardarSeguimiento(db, 'B1', { enAmbientalia: false, avisoEnviado: null, servicioProgramado: '2026-11-03', nota: 'OK' }, actor);
    const n = await repo.registrarAvisos(db, ['B1', 'B2', 'NOEXISTE'], '2026-10-06', actor);
    expect(n).toBe(2);
    const eq = await repo.listarEquipos(db, hoy);
    expect(eq.find((e) => e.clave === 'B1')!.seguimiento).toMatchObject({ avisoEnviado: '2026-10-06', servicioProgramado: '2026-11-03', nota: 'OK' });
    expect(eq.find((e) => e.clave === 'B2')!.seguimiento).toMatchObject({ avisoEnviado: '2026-10-06', enAmbientalia: false, nota: '' });
  });
});

// El cruce con Zoho Desk: la réplica desk.tickets la escribe el worker de
// zoho-hub y aquí sólo se lee. `haceHoras` fija la última sincronización
// (null = nunca sincronizado).
describe('ticket abierto en Desk', () => {
  const ticket = (numero: number, serial: string | null, statusType: string | null, estado = 'En diagnóstico', haceHoras: number | null = 1) =>
    db.query(
      `INSERT INTO desk.tickets (number, status, status_type, serial, synced_at)
       VALUES ($1, $2, $3, $4, NOW() - make_interval(hours => $5::int))`,
      [numero, estado, statusType, serial, haceHoras],
    );
  const ticketDe = async (clave: string) => (await repo.listarEquipos(db, hoy)).find((e) => e.clave === clave)!.ticket;

  beforeEach(async () => {
    await repo.importar(db, { archivo: 'x.xlsx', filas: [fila('18A00001', 'Cliente Uno', '2025-10-01'), fila('18A00002', 'Cliente Dos', '2025-10-20')] }, actor, false);
  });

  it('sin tickets, el equipo no lleva ticket', async () => {
    expect(await ticketDe('18A00001')).toBeNull();
  });

  it('un ticket abierto llega con su número y su estado de Desk', async () => {
    await ticket(962, '18A00001', 'Open');
    expect(await ticketDe('18A00001')).toEqual({ numero: 962, estado: 'En diagnóstico', sinConfirmar: false });
    expect(await ticketDe('18A00002')).toBeNull();
  });

  it('«On Hold» y un tipo de estado vacío cuentan como abiertos', async () => {
    await ticket(963, '18A00001', 'On Hold', 'Esperando repuesto');
    await ticket(964, '18A00002', null, 'Nuevo');
    expect(await ticketDe('18A00001')).toMatchObject({ numero: 963, estado: 'Esperando repuesto' });
    expect(await ticketDe('18A00002')).toMatchObject({ numero: 964 });
  });

  it('un ticket cerrado se ignora, y uno sin serial no casa con nadie', async () => {
    await ticket(965, '18A00001', 'Closed', 'Cerrado');
    await ticket(966, null, 'Open');
    await ticket(967, '   ', 'Open');
    expect(await ticketDe('18A00001')).toBeNull();
    expect(await ticketDe('18A00002')).toBeNull();
  });

  it('el serial casa sin distinguir mayúsculas ni espacios', async () => {
    await ticket(968, '  18a00001 ', 'Open');
    expect(await ticketDe('18A00001')).toMatchObject({ numero: 968 });
  });

  it('sincronizado hace más de un día, o nunca → sin confirmar', async () => {
    await ticket(969, '18A00001', 'Open', 'En diagnóstico', 30);
    await ticket(970, '18A00002', 'Open', 'En diagnóstico', null);
    expect(await ticketDe('18A00001')).toEqual({ numero: 969, estado: 'En diagnóstico', sinConfirmar: true });
    expect(await ticketDe('18A00002')).toMatchObject({ numero: 970, sinConfirmar: true });
  });

  it('con dos tickets abiertos gana el de número más alto; uno cerrado posterior no cuenta', async () => {
    await ticket(971, '18A00001', 'Open', 'En diagnóstico', 30);
    await ticket(972, '18A00001', 'On Hold', 'Esperando repuesto');
    await ticket(973, '18A00001', 'Closed', 'Cerrado');
    expect(await ticketDe('18A00001')).toEqual({ numero: 972, estado: 'Esperando repuesto', sinConfirmar: false });
  });

  it('no multiplica filas: un equipo con varios tickets sale una sola vez', async () => {
    await ticket(974, '18A00001', 'Open');
    await ticket(975, '18A00001', 'Open');
    expect((await repo.listarEquipos(db, hoy)).map((e) => e.clave)).toEqual(['18A00002', '18A00001']);
  });
});
