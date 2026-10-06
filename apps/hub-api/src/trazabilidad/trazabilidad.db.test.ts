import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { aplicarMigraciones } from '../db.js';
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

// Los plazos llevan semilla (migración 043): los tests que la editan la dejan
// como recién migrada vaciando la tabla y volviendo a ejecutar ese fichero.
const SQL_043 = readFileSync(fileURLToPath(new URL('../users/migrations/043_trazabilidad_plazos.sql', import.meta.url)), 'utf8');
async function resembrarPlazos(): Promise<void> {
  await db.query('TRUNCATE portal.tmc_plazos');
  await db.query(SQL_043);
}

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

// Pestaña «Servicios»: todos los tickets de Desk que no están cerrados, con su
// fecha límite según el plazo configurado para su tipo de servicio.
describe('servicios abiertos en Desk', () => {
  interface T {
    numero: number;
    statusType?: string | null;
    estado?: string;
    serial?: string | null;
    asunto?: string | null;
    codigo?: string | null;
    tipo?: string | null;
    creado?: string | null;
    fechaTicket?: string | null;
    haceHoras?: number | null;
    raw?: unknown;
  }
  const ticket = (t: T) =>
    db.query(
      `INSERT INTO desk.tickets (number, subject, status, status_type, serial, codigo_servicio, tipo_servicio,
                                 created_time, fecha_creacion_ticket, synced_at, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::date, NOW() - make_interval(hours => $10::int), $11::jsonb)`,
      [
        t.numero,
        t.asunto ?? null,
        t.estado ?? 'En diagnóstico',
        t.statusType === undefined ? 'Open' : t.statusType,
        t.serial ?? null,
        t.codigo ?? null,
        t.tipo ?? null,
        t.creado === undefined ? '2026-10-05T15:00:00Z' : t.creado,
        t.fechaTicket ?? null,
        t.haceHoras === undefined ? 1 : t.haceHoras,
        t.raw === undefined ? null : JSON.stringify(t.raw),
      ],
    );
  const servicio = async (numero: number) => (await repo.listarServicios(db, hoy)).find((s) => s.numero === numero)!;

  beforeEach(async () => {
    await resembrarPlazos();
  });

  it('lista los abiertos de cualquier marca, con o sin serial, y deja fuera los cerrados', async () => {
    await ticket({ numero: 1001, serial: '18A00001' });
    await ticket({ numero: 1002, serial: null, statusType: 'On Hold', estado: 'Esperando repuesto' });
    await ticket({ numero: 1003, serial: '   ', statusType: null, estado: 'Nuevo' });
    await ticket({ numero: 1004, serial: '18A00002', statusType: 'Closed', estado: 'Cerrado' });
    const s = await repo.listarServicios(db, hoy);
    expect(s.map((x) => x.numero)).toEqual([1003, 1002, 1001]);
    expect(s.map((x) => x.estado)).toEqual(['Nuevo', 'Esperando repuesto', 'En diagnóstico']);
    expect(s.map((x) => x.serial)).toEqual(['', '', '18A00001']);
  });

  it('sin tipo de servicio (como llega hoy de Desk): sin plazo, y el ingreso sale de created_time en hora de Colombia', async () => {
    // 03:00 UTC del día 6 son las 22:00 del día 5 en Bogotá.
    await ticket({ numero: 1010, creado: '2026-10-06T03:00:00Z' });
    expect(await servicio(1010)).toMatchObject({
      tipoServicio: '',
      ingreso: '2026-10-05',
      plazoDias: null,
      fechaLimite: null,
      diasHabiles: null,
      estadoPlazo: 'SIN_PLAZO',
    });
  });

  it('la fecha de creación del ticket manda sobre created_time', async () => {
    await ticket({ numero: 1011, creado: '2026-10-05T15:00:00Z', fechaTicket: '2026-10-01', tipo: 'Diagnóstico' });
    expect(await servicio(1011)).toMatchObject({ ingreso: '2026-10-01', plazoDias: 3, fechaLimite: '2026-10-06', diasHabiles: 0, estadoPlazo: 'VENCE_HOY' });
  });

  it('el tipo casa sin mayúsculas, tildes ni espacios', async () => {
    await ticket({ numero: 1020, tipo: 'Diagnostico', fechaTicket: '2026-10-05' });
    await ticket({ numero: 1021, tipo: '  CALIBRACIÓN ', fechaTicket: '2026-10-05' });
    expect(await servicio(1020)).toMatchObject({ tipoServicio: 'Diagnostico', plazoDias: 3, fechaLimite: '2026-10-08', diasHabiles: 2, estadoPlazo: 'EN_PLAZO' });
    expect(await servicio(1021)).toMatchObject({ tipoServicio: 'CALIBRACIÓN', plazoDias: 4, fechaLimite: '2026-10-09', diasHabiles: 3, estadoPlazo: 'EN_PLAZO' });
  });

  it('el plazo cruza el fin de semana y el festivo, y el atraso se cuenta en días hábiles', async () => {
    await ticket({ numero: 1030, tipo: 'Diagnóstico', fechaTicket: '2026-10-08' }); // jue → vie 9, mar 13, mié 14 (lun 12 festivo)
    await ticket({ numero: 1031, tipo: 'Calibración', fechaTicket: '2026-09-28' }); // lun → vie 2
    expect(await servicio(1030)).toMatchObject({ fechaLimite: '2026-10-14', estadoPlazo: 'EN_PLAZO' });
    expect(await servicio(1031)).toMatchObject({ fechaLimite: '2026-10-02', diasHabiles: -2, estadoPlazo: 'VENCIDO' });
  });

  it('un tipo sin plazo configurado no tiene fecha límite', async () => {
    await ticket({ numero: 1040, tipo: 'Mantenimiento', fechaTicket: '2026-10-01' });
    await ticket({ numero: 1041, tipo: 'Instalación', fechaTicket: '2026-10-01' });
    expect(await servicio(1040)).toMatchObject({ tipoServicio: 'Mantenimiento', plazoDias: null, fechaLimite: null, estadoPlazo: 'SIN_PLAZO' });
    expect(await servicio(1041)).toMatchObject({ plazoDias: null, estadoPlazo: 'SIN_PLAZO' });
  });

  it('sincronizado hace más de un día, o nunca → sin confirmar', async () => {
    await ticket({ numero: 1050 });
    await ticket({ numero: 1051, haceHoras: 30 });
    await ticket({ numero: 1052, haceHoras: null });
    expect((await servicio(1050)).sinConfirmar).toBe(false);
    expect((await servicio(1051)).sinConfirmar).toBe(true);
    expect((await servicio(1052)).sinConfirmar).toBe(true);
  });

  it('modelo del código de servicio; cliente de la cuenta de Desk o, si no viene, del asunto', async () => {
    const asunto = 'Servicio Técnico Cliente Uno Monitor de Partículas MT_18A00001_EDM180C_260916';
    await ticket({ numero: 1060, asunto, codigo: 'MT_18A00001_EDM180C_260916', raw: { contact: { account: { accountName: 'Cliente Uno S.A.S.' } } } });
    await ticket({ numero: 1061, asunto, codigo: 'MT_18A00001_EDM180C_260916', raw: { contact: null } });
    await ticket({ numero: 1062 });
    expect(await servicio(1060)).toMatchObject({ modelo: 'EDM180C', cliente: 'Cliente Uno S.A.S.', clienteDeAsunto: false });
    expect(await servicio(1061)).toMatchObject({ modelo: 'EDM180C', cliente: 'Servicio Técnico Cliente Uno Monitor de Partículas', clienteDeAsunto: true });
    expect(await servicio(1062)).toMatchObject({ modelo: '', cliente: '', clienteDeAsunto: true, asunto: '' });
  });
});

describe('plazos por tipo de servicio', () => {
  beforeEach(async () => {
    await resembrarPlazos();
  });
  const plazo = async (clave: string) => (await repo.listarPlazos(db)).find((p) => p.clave === clave);

  it('la semilla: Diagnóstico = 3, Calibración = 4 y el resto de tipos de Zoho sin plazo ni firma', async () => {
    const p = await repo.listarPlazos(db);
    expect(p.map((x) => [x.etiqueta, x.dias])).toEqual([
      ['Calibración', 4],
      ['Diagnóstico', 3],
      ['Garantía', null],
      ['Mantenimiento', null],
      ['No aplica', null],
      ['Otro', null],
    ]);
    expect(p.every((x) => x.actualizadoPor === null && x.actualizadoEn === null && x.ticketsAbiertos === 0)).toBe(true);
  });

  it('un tipo que sólo existe en los tickets abiertos aparece sin plazo, con su recuento', async () => {
    const ins = (n: number, tipo: string | null, st = 'Open') =>
      db.query(`INSERT INTO desk.tickets (number, status, status_type, tipo_servicio) VALUES ($1, 'x', $2, $3)`, [n, st, tipo]);
    await ins(1, 'Instalación');
    await ins(2, ' instalacion ');
    await ins(3, 'Diagnostico');
    await ins(4, 'Verificación', 'Closed');
    await ins(5, null);
    const p = await repo.listarPlazos(db);
    expect(p.find((x) => x.clave === 'instalacion')).toEqual({
      clave: 'instalacion',
      etiqueta: 'Instalación',
      dias: null,
      ticketsAbiertos: 2,
      actualizadoPor: null,
      actualizadoEn: null,
    });
    expect(p.find((x) => x.clave === 'diagnostico')).toMatchObject({ etiqueta: 'Diagnóstico', dias: 3, ticketsAbiertos: 1 });
    expect(p.find((x) => x.clave === 'verificacion')).toBeUndefined();
    expect(p.find((x) => x.clave === '')).toBeUndefined();
  });

  it('editar persiste, firma con el correo y conserva la etiqueta; vaciar deja «sin plazo»', async () => {
    await repo.guardarPlazo(db, { tipo: 'DIAGNOSTICO', dias: 5 }, actor);
    expect(await plazo('diagnostico')).toMatchObject({ etiqueta: 'Diagnóstico', dias: 5, actualizadoPor: actor.email });
    expect((await plazo('diagnostico'))!.actualizadoEn).toMatch(/^\d{4}-\d{2}-\d{2}/);

    await repo.guardarPlazo(db, { tipo: 'Calibración', dias: null }, actor);
    expect(await plazo('calibracion')).toMatchObject({ dias: null, actualizadoPor: actor.email });

    await repo.guardarPlazo(db, { tipo: ' Instalación ', dias: 10 }, actor);
    expect(await plazo('instalacion')).toMatchObject({ etiqueta: 'Instalación', dias: 10 });
  });

  it('la edición sobrevive a volver a ejecutar la migración', async () => {
    await repo.guardarPlazo(db, { tipo: 'Diagnóstico', dias: 7 }, actor);
    await repo.guardarPlazo(db, { tipo: 'Calibración', dias: null }, actor);
    await db.query(SQL_043);
    await aplicarMigraciones(db);
    expect(await plazo('diagnostico')).toMatchObject({ dias: 7, actualizadoPor: actor.email });
    expect(await plazo('calibracion')).toMatchObject({ dias: null });
    expect(await repo.listarPlazos(db)).toHaveLength(6);
  });

  it('el plazo editado cambia la fecha límite de los servicios', async () => {
    await db.query(
      `INSERT INTO desk.tickets (number, status, status_type, tipo_servicio, fecha_creacion_ticket, synced_at)
       VALUES (2001, 'En proceso', 'Open', 'Mantenimiento', '2026-10-05', NOW())`,
    );
    expect((await repo.listarServicios(db, hoy))[0]).toMatchObject({ estadoPlazo: 'SIN_PLAZO' });
    await repo.guardarPlazo(db, { tipo: 'Mantenimiento', dias: 1 }, actor);
    expect((await repo.listarServicios(db, hoy))[0]).toMatchObject({ plazoDias: 1, fechaLimite: '2026-10-06', estadoPlazo: 'VENCE_HOY' });
  });

  it('la tabla rechaza un plazo fuera de 1..365 aunque alguien se salte la validación', async () => {
    await expect(db.query(`UPDATE portal.tmc_plazos SET dias_habiles = 0 WHERE clave = 'diagnostico'`)).rejects.toThrow();
    await expect(db.query(`UPDATE portal.tmc_plazos SET dias_habiles = 366 WHERE clave = 'diagnostico'`)).rejects.toThrow();
  });
});
