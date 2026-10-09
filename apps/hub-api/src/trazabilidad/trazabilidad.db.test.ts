import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { aplicarMigraciones } from '../db.js';
import { asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import { hoyEnColombia } from '../ausencias/saldo.js';
import { claveEstadoDesk, type RolEstado } from './dominio.js';
import { ROLES_APP } from './roles.js';
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

// Los plazos llevan semilla (migraciones 043 y 045): los tests que la editan la
// dejan como recién migrada vaciando la tabla y volviendo a ejecutar esos ficheros.
const SQL_043 = readFileSync(fileURLToPath(new URL('../users/migrations/043_trazabilidad_plazos.sql', import.meta.url)), 'utf8');
const SQL_044 = readFileSync(fileURLToPath(new URL('../users/migrations/044_trazabilidad_servicios_tipo.sql', import.meta.url)), 'utf8');
const SQL_045 = readFileSync(fileURLToPath(new URL('../users/migrations/045_trazabilidad_tipo_combinado.sql', import.meta.url)), 'utf8');
const SQL_046 = readFileSync(fileURLToPath(new URL('../users/migrations/046_trazabilidad_estados_desk.sql', import.meta.url)), 'utf8');
const SQL_047 = readFileSync(fileURLToPath(new URL('../users/migrations/047_trazabilidad_estados_historial.sql', import.meta.url)), 'utf8');
const SQL_048 = readFileSync(fileURLToPath(new URL('../users/migrations/048_trazabilidad_contactos.sql', import.meta.url)), 'utf8');
const SQL_049 = readFileSync(fileURLToPath(new URL('../users/migrations/049_trazabilidad_roles.sql', import.meta.url)), 'utf8');
async function resembrarPlazos(): Promise<void> {
  await db.query('TRUNCATE portal.tmc_plazos');
  await db.query(SQL_043);
  await db.query(SQL_045);
}

beforeAll(async () => {
  db = poolDePrueba();
  await asegurarDeskTickets(db);
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query('TRUNCATE portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_importaciones, portal.tmc_servicios_tipo, portal.tmc_estados_desk, portal.tmc_estados_historial, portal.tmc_contactos, desk.tickets RESTART IDENTITY');
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

// A quién iría el aviso de cada equipo: el contacto del ticket de Desk más
// reciente con un correo que valga, o el puesto a mano a su cliente
// (portal.tmc_contactos), que gana. Sólo se guarda y se lee: nada se envía.
describe('contacto de cada equipo', () => {
  interface C {
    numero: number;
    serial?: string | null;
    email?: string | null;
    contacto?: Record<string, unknown> | null;
    statusType?: string;
  }
  const ticket = (t: C) =>
    db.query(
      `INSERT INTO desk.tickets (number, status, status_type, serial, synced_at, raw)
       VALUES ($1, 'Cerrado', $2, $3, NOW(), $4::jsonb)`,
      [t.numero, t.statusType ?? 'Closed', t.serial === undefined ? '18A00001' : t.serial, JSON.stringify({ email: t.email === undefined ? null : t.email, contact: t.contacto === undefined ? null : t.contacto })],
    );
  const persona = (firstName: string | null, lastName: string | null, email: string | null = null) => ({ id: '7', type: null, email, phone: null, mobile: null, account: null, lastName, firstName });
  const equipo = async (clave: string) => (await repo.listarEquipos(db, hoy)).find((e) => e.clave === clave)!;
  const contactoDe = async (clave: string) => (await equipo(clave)).contacto;
  const filas = async () =>
    (await db.query(`SELECT clave, cliente, emails, nombre, actualizado_por_id::text AS por_id, actualizado_por, actualizado_en FROM portal.tmc_contactos ORDER BY clave`)).rows;

  beforeEach(async () => {
    await repo.importar(
      db,
      { archivo: 'x.xlsx', filas: [fila('18A00001', 'Cliente Uno', '2025-10-17'), fila('18A00002', 'Cliente  Uno', '2025-10-20'), fila('18A00003', 'Cliente Dos', '2025-10-20')] },
      actor,
      false,
    );
  });

  it('sin tickets, o sin ninguno con correo, el equipo no lleva contacto', async () => {
    expect(await contactoDe('18A00001')).toBeNull();
    await ticket({ numero: 900, email: null, contacto: persona('Ana', 'Pérez') });
    await ticket({ numero: 901, email: '   ' });
    expect(await contactoDe('18A00001')).toBeNull();
  });

  it('el del ticket más reciente (número más alto), abierto o cerrado, con el correo en minúsculas y el nombre completo', async () => {
    await ticket({ numero: 900, email: 'viejo@cliente-uno.example', contacto: persona('Luis', 'Gómez') });
    await ticket({ numero: 950, email: '  Compras@Cliente-Uno.Example ', contacto: persona(' Ana ', ' Pérez  ') });
    await ticket({ numero: 920, email: 'medio@cliente-uno.example', statusType: 'Open' });
    expect(await contactoDe('18A00001')).toEqual({ nombre: 'Ana Pérez', email: 'compras@cliente-uno.example', origen: 'desk', ticket: 950 });
    expect(await contactoDe('18A00002')).toBeNull();
  });

  it('el nombre puede venir vacío, y el serial casa sin mayúsculas ni espacios', async () => {
    await ticket({ numero: 900, serial: '  18a00001 ', email: 'compras@cliente-uno.example', contacto: persona(null, null) });
    expect(await contactoDe('18A00001')).toEqual({ nombre: '', email: 'compras@cliente-uno.example', origen: 'desk', ticket: 900 });
  });

  it('si el ticket no trae `email` arriba, vale el de su contacto', async () => {
    await ticket({ numero: 900, email: null, contacto: persona('Ana', 'Pérez', 'Ana@Cliente-Uno.example') });
    expect(await contactoDe('18A00001')).toEqual({ nombre: 'Ana Pérez', email: 'ana@cliente-uno.example', origen: 'desk', ticket: 900 });
  });

  it('salta los correos internos y los mal escritos, y retrocede a un ticket más antiguo', async () => {
    await ticket({ numero: 990, email: 'Alguien@Ambientalia.com.co', contacto: persona('Persona', 'Interna') });
    await ticket({ numero: 980, email: 'no-es-un-correo' });
    await ticket({ numero: 970, email: 'compras@cliente-uno' });
    await ticket({ numero: 960, email: 'compras@cliente-uno.example', contacto: persona('Ana', 'Pérez') });
    await ticket({ numero: 950, email: 'otro@cliente-uno.example' });
    expect(await contactoDe('18A00001')).toEqual({ nombre: 'Ana Pérez', email: 'compras@cliente-uno.example', origen: 'desk', ticket: 960 });
  });

  it('si todos los tickets del equipo son internos o no valen → null', async () => {
    await ticket({ numero: 990, email: 'alguien@ambientalia.com.co' });
    await ticket({ numero: 980, email: 'otra.persona@ambientalia.com.co' });
    await ticket({ numero: 970, email: 'roto@' });
    expect(await contactoDe('18A00001')).toBeNull();
  });

  it('un ticket sin serial, o de otro serial, no le da contacto a nadie más', async () => {
    await ticket({ numero: 900, serial: null, email: 'compras@cliente-uno.example' });
    await ticket({ numero: 901, serial: '  ', email: 'compras@cliente-uno.example' });
    await ticket({ numero: 902, serial: '18A00003', email: 'taller@example.com' });
    expect(await contactoDe('18A00001')).toBeNull();
    expect(await contactoDe('18A00003')).toMatchObject({ email: 'taller@example.com', ticket: 902 });
  });

  it('no multiplica filas ni toca el ticket abierto del equipo', async () => {
    await ticket({ numero: 900, email: 'a@cliente-uno.example' });
    await ticket({ numero: 901, email: 'b@cliente-uno.example', statusType: 'Open' });
    const eq = await repo.listarEquipos(db, hoy);
    expect(eq.map((e) => e.clave).sort()).toEqual(['18A00001', '18A00002', '18A00003']);
    expect(eq.find((e) => e.clave === '18A00001')).toMatchObject({ ticket: { numero: 901 }, contacto: { email: 'b@cliente-uno.example', ticket: 901 } });
  });

  describe('puesto a mano al cliente', () => {
    it('se guarda firmado y sustituye al de Desk en TODOS los equipos del cliente (el nombre casa normalizado)', async () => {
      await ticket({ numero: 900, email: 'compras@cliente-uno.example', contacto: persona('Ana', 'Pérez') });
      await ticket({ numero: 902, serial: '18A00003', email: 'taller@example.com' });
      await repo.guardarContacto(db, { cliente: ' CLIENTE  uno ', emails: ['jefe@cliente-uno.example', 'copia@example.com'], nombre: 'Luis Gómez' }, actor);

      const manual = { nombre: 'Luis Gómez', email: 'jefe@cliente-uno.example', origen: 'manual', ticket: null };
      expect(await contactoDe('18A00001')).toEqual(manual); // «Cliente Uno», con ticket en Desk
      expect(await contactoDe('18A00002')).toEqual(manual); // «Cliente  Uno» (dos espacios), sin ticket
      expect(await contactoDe('18A00003')).toMatchObject({ origen: 'desk', email: 'taller@example.com' }); // otro cliente

      const f = await filas();
      expect(f).toHaveLength(1);
      expect(f[0]).toMatchObject({ clave: 'cliente uno', cliente: ' CLIENTE  uno ', emails: ['jefe@cliente-uno.example', 'copia@example.com'], nombre: 'Luis Gómez', por_id: actor.userId, actualizado_por: actor.email });
      expect(f[0].actualizado_en).toBeInstanceOf(Date);
    });

    it('listarContactos los devuelve con sus internos señalados, y un interno puesto a mano SÍ vale como contacto', async () => {
      await repo.guardarContacto(db, { cliente: 'Cliente Uno', emails: ['alguien@ambientalia.com.co', 'jefe@cliente-uno.example'], nombre: '' }, actor);
      expect(await repo.listarContactos(db)).toEqual([
        {
          clave: 'cliente uno',
          cliente: 'Cliente Uno',
          nombre: '',
          emails: ['alguien@ambientalia.com.co', 'jefe@cliente-uno.example'],
          internos: ['alguien@ambientalia.com.co'],
          actualizadoPor: actor.email,
          actualizadoEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2} /),
        },
      ]);
      expect(await contactoDe('18A00001')).toEqual({ nombre: '', email: 'alguien@ambientalia.com.co', origen: 'manual', ticket: null });
    });

    it('guardar otra vez sustituye la fila (una por cliente) y vuelve a firmarla', async () => {
      await repo.guardarContacto(db, { cliente: 'Cliente Uno', emails: ['a@cliente-uno.example'], nombre: 'Ana' }, actor);
      const otro = { userId: '00000000-0000-4000-8000-000000000002', email: 'otra@example.com' };
      await repo.guardarContacto(db, { cliente: 'cliente uno', emails: ['b@cliente-uno.example'], nombre: '' }, otro);
      const f = await filas();
      expect(f).toHaveLength(1);
      expect(f[0]).toMatchObject({ clave: 'cliente uno', cliente: 'cliente uno', emails: ['b@cliente-uno.example'], nombre: '', por_id: otro.userId, actualizado_por: otro.email });
    });

    it('con la lista vacía se quita: se borra la fila y vuelve a valer el de Desk (o ninguno)', async () => {
      await ticket({ numero: 900, email: 'compras@cliente-uno.example' });
      await repo.guardarContacto(db, { cliente: 'Cliente Uno', emails: ['jefe@cliente-uno.example'], nombre: '' }, actor);
      await repo.guardarContacto(db, { cliente: 'CLIENTE UNO', emails: [], nombre: '' }, actor);
      expect(await filas()).toEqual([]);
      expect(await contactoDe('18A00001')).toMatchObject({ origen: 'desk', email: 'compras@cliente-uno.example', ticket: 900 });
      expect(await contactoDe('18A00002')).toBeNull();
      // Quitar lo que no existe no es un error.
      await expect(repo.guardarContacto(db, { cliente: 'Cliente Sin Contacto', emails: [], nombre: '' }, actor)).resolves.toBeUndefined();
    });

    it('se puede poner contacto a un cliente que aún no está en el inventario', async () => {
      await repo.guardarContacto(db, { cliente: 'Cliente Tres', emails: ['compras@example.com'], nombre: '' }, actor);
      expect((await repo.listarContactos(db)).map((c) => c.clave)).toEqual(['cliente tres']);
    });

    it('la tabla no admite una fila sin correos ni con más de cinco', async () => {
      const ins = (emails: string[]) => db.query(`INSERT INTO portal.tmc_contactos (clave, cliente, emails, actualizado_por) VALUES ('x', 'X', $1::text[], 'alguien@example.com')`, [emails]);
      await expect(ins([])).rejects.toThrow(/check/i);
      await expect(ins(Array.from({ length: 6 }, (_, i) => `c${i}@example.com`))).rejects.toThrow(/check/i);
    });

    it('volver a ejecutar la migración 048 (cada arranque) no toca lo guardado', async () => {
      await repo.guardarContacto(db, { cliente: 'Cliente Uno', emails: ['jefe@cliente-uno.example'], nombre: 'Luis Gómez' }, actor);
      const antes = await filas();
      await db.query(SQL_048);
      await db.query(SQL_048);
      expect(await filas()).toEqual(antes);
      expect(await contactoDe('18A00001')).toMatchObject({ origen: 'manual', email: 'jefe@cliente-uno.example' });
    });

    it('ninguna tabla del módulo guarda mensajes ni envíos: el aviso automático es sólo una simulación', async () => {
      const { rows } = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'portal' AND table_name LIKE 'tmc\\_%' ORDER BY 1`);
      expect(rows.map((r: { table_name: string }) => r.table_name)).toEqual([
        'tmc_agenda_asignaciones',
        'tmc_agenda_duraciones',
        'tmc_agenda_etapas',
        'tmc_agenda_flujo',
        'tmc_agenda_historial',
        'tmc_contactos',
        'tmc_equipos',
        'tmc_estados_desk',
        'tmc_estados_historial',
        'tmc_fst022_congelada',
        'tmc_fst022_congelaciones',
        'tmc_importaciones',
        'tmc_plazos',
        'tmc_seguimiento',
        'tmc_servicios_tipo',
        'tmc_user_roles',
      ]);
    });
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
    expect(await servicio(1060)).toMatchObject({ modelo: 'EDM180C', cliente: 'Cliente Uno S.A.S.', clienteOrigen: 'cuenta', clienteDeAsunto: false });
    expect(await servicio(1061)).toMatchObject({ modelo: 'EDM180C', cliente: 'Servicio Técnico Cliente Uno Monitor de Partículas', clienteOrigen: 'asunto', clienteDeAsunto: true });
    expect(await servicio(1062)).toMatchObject({ modelo: '', cliente: '', clienteOrigen: 'asunto', clienteDeAsunto: true, asunto: '' });
  });

  // El cliente de un servicio, por orden: (a) el del equipo del inventario con
  // ese serial, (b) la cuenta de Desk, (c) el nombre del contacto del ticket y
  // (d) el asunto sin el código de servicio.
  describe('cliente del servicio: de dónde sale', () => {
    const asunto = 'Servicio Técnico Monitor de Partículas MT_18A00001_EDM180C_260916';
    const codigo = 'MT_18A00001_EDM180C_260916';
    const cuenta = { accountName: 'Cuenta de Desk S.A.S.', id: '1' };
    const contacto = (account: unknown = null) => ({ id: '9', firstName: ' Ana ', lastName: 'Pérez', email: 'compras@cliente-uno.example', account });

    it('(a) gana el cliente del equipo del inventario con ese serial, sin mayúsculas ni espacios', async () => {
      await repo.importar(db, { archivo: 'x.xlsx', filas: [fila('18A00001', 'Cliente Uno', '2025-10-01')] }, actor, false);
      await ticket({ numero: 1080, serial: ' 18a00001 ', asunto, codigo, raw: { contact: contacto(cuenta) } });
      expect(await servicio(1080)).toMatchObject({ cliente: 'Cliente Uno', clienteOrigen: 'equipo', clienteDeAsunto: false });
    });

    it('(a) con el serial repetido en el inventario, el equipo activo gana al retirado; si no queda ninguno activo, vale el retirado', async () => {
      // Dos filas con el mismo serial: claves «18A00001» (Cliente Viejo) y «18A00001-2» (Cliente Uno).
      await repo.importar(db, { archivo: 'v1.xlsx', filas: [fila('18A00001', 'Cliente Viejo', '2025-10-01'), fila('18A00001', 'Cliente Uno', '2025-10-01')] }, actor, false);
      await db.query(`UPDATE portal.tmc_equipos SET activo = FALSE WHERE clave = '18A00001'`);
      await ticket({ numero: 1081, serial: '18A00001', asunto, codigo });
      expect(await servicio(1081)).toMatchObject({ cliente: 'Cliente Uno', clienteOrigen: 'equipo' });
      // Ninguno activo: vale uno retirado (el de clave más baja, para que no baile).
      await db.query(`UPDATE portal.tmc_equipos SET activo = FALSE`);
      expect(await servicio(1081)).toMatchObject({ cliente: 'Cliente Viejo', clienteOrigen: 'equipo', clienteDeAsunto: false });
    });

    it('(b) sin equipo con ese serial, la cuenta de Desk', async () => {
      await repo.importar(db, { archivo: 'x.xlsx', filas: [fila('18A00002', 'Cliente Dos', '2025-10-01')] }, actor, false);
      await ticket({ numero: 1082, serial: '18A00001', asunto, codigo, raw: { contact: contacto(cuenta) } });
      await ticket({ numero: 1083, serial: null, asunto, codigo, raw: { contact: contacto(cuenta) } });
      expect(await servicio(1082)).toMatchObject({ cliente: 'Cuenta de Desk S.A.S.', clienteOrigen: 'cuenta', clienteDeAsunto: false });
      expect(await servicio(1083)).toMatchObject({ cliente: 'Cuenta de Desk S.A.S.', clienteOrigen: 'cuenta' });
    });

    it('(c) sin equipo ni cuenta (lo habitual: `account` llega null), el nombre del contacto del ticket', async () => {
      await ticket({ numero: 1084, serial: '18A00001', asunto, codigo, raw: { email: 'compras@cliente-uno.example', contact: contacto(null) } });
      await ticket({ numero: 1085, asunto, codigo, raw: { contact: { firstName: null, lastName: ' Gómez ', account: { accountName: '  ' } } } });
      expect(await servicio(1084)).toMatchObject({ cliente: 'Ana Pérez', clienteOrigen: 'contacto', clienteDeAsunto: false });
      expect(await servicio(1085)).toMatchObject({ cliente: 'Gómez', clienteOrigen: 'contacto', clienteDeAsunto: false });
    });

    it('(d) sin nada de lo anterior, el asunto sin el código de servicio, marcado como «del asunto»', async () => {
      await ticket({ numero: 1086, serial: '18A00001', asunto, codigo, raw: { contact: { firstName: ' ', lastName: null, account: null } } });
      await ticket({ numero: 1087, serial: '18A00001', asunto, codigo, raw: null });
      for (const n of [1086, 1087]) {
        expect(await servicio(n)).toMatchObject({ cliente: 'Servicio Técnico Monitor de Partículas', clienteOrigen: 'asunto', clienteDeAsunto: true });
      }
    });

    it('un equipo del inventario con varios tickets no multiplica los servicios', async () => {
      await repo.importar(db, { archivo: 'x.xlsx', filas: [fila('18A00001', 'Cliente Uno', '2025-10-01'), fila('18A00001', 'Cliente Uno Bis', '2025-10-01')] }, actor, false);
      await ticket({ numero: 1088, serial: '18A00001' });
      await ticket({ numero: 1089, serial: '18A00001' });
      const s = await repo.listarServicios(db, hoy);
      expect(s.map((x) => x.numero)).toEqual([1089, 1088]);
      expect(new Set(s.map((x) => x.cliente))).toEqual(new Set(['Cliente Uno']));
    });
  });

  it('el tipo que viene de Desk se marca con su origen, y sin tipo no hay origen', async () => {
    await ticket({ numero: 1070, tipo: ' Diagnostico ' });
    await ticket({ numero: 1071 });
    expect(await servicio(1070)).toMatchObject({ tipoServicio: 'Diagnostico', tipoOrigen: 'desk', tipoDesk: 'Diagnostico', tipoManual: null });
    expect(await servicio(1071)).toMatchObject({ tipoServicio: '', tipoOrigen: null, tipoDesk: '', tipoManual: null });
  });
});

// El tipo de servicio puesto a mano por ticket (portal.tmc_servicios_tipo):
// manda sobre el que traiga Desk y es el que decide el plazo.
describe('tipo de servicio puesto a mano', () => {
  const ticket = (numero: number, tipo: string | null = null, fechaTicket = '2026-10-05', statusType = 'Open') =>
    db.query(
      `INSERT INTO desk.tickets (number, status, status_type, serial, tipo_servicio, fecha_creacion_ticket, synced_at)
       VALUES ($1, 'En diagnóstico', $2, '18A00001', $3, $4::date, NOW())`,
      [numero, statusType, tipo, fechaTicket],
    );
  const servicio = async (numero: number) => (await repo.listarServicios(db, hoy)).find((s) => s.numero === numero)!;
  const filas = async () =>
    (
      await db.query(
        `SELECT numero, clave, etiqueta, actualizado_por_id::text AS por_id, actualizado_por, actualizado_en
           FROM portal.tmc_servicios_tipo ORDER BY numero`,
      )
    ).rows;

  beforeEach(async () => {
    await resembrarPlazos();
  });

  it('con Desk vacío (como llega hoy), el tipo puesto a mano le da plazo y fecha límite', async () => {
    await ticket(3001);
    expect(await servicio(3001)).toMatchObject({ tipoServicio: '', estadoPlazo: 'SIN_PLAZO' });
    await repo.fijarTipoServicio(db, 3001, 'Diagnóstico', actor);
    const s = await servicio(3001);
    expect(s).toMatchObject({
      tipoServicio: 'Diagnóstico',
      tipoOrigen: 'manual',
      tipoDesk: '',
      plazoDias: 3,
      fechaLimite: '2026-10-08',
      diasHabiles: 2,
      estadoPlazo: 'EN_PLAZO',
    });
    expect(s.tipoManual).toMatchObject({ clave: 'diagnostico', por: actor.email });
    expect(s.tipoManual!.en).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('el puesto a mano gana a un tipo distinto de Desk, que se sigue viendo', async () => {
    await ticket(3002, 'Diagnóstico');
    expect(await servicio(3002)).toMatchObject({ tipoServicio: 'Diagnóstico', tipoOrigen: 'desk', plazoDias: 3, fechaLimite: '2026-10-08' });
    await repo.fijarTipoServicio(db, 3002, 'Calibración', actor);
    expect(await servicio(3002)).toMatchObject({
      tipoServicio: 'Calibración',
      tipoOrigen: 'manual',
      tipoDesk: 'Diagnóstico',
      plazoDias: 4,
      fechaLimite: '2026-10-09',
    });
  });

  it('quitarlo (null) vuelve al de Desk o, si no hay, a «sin tipo»', async () => {
    await ticket(3003, 'Diagnóstico');
    await ticket(3004);
    await repo.fijarTipoServicio(db, 3003, 'Calibración', actor);
    await repo.fijarTipoServicio(db, 3004, 'Calibración', actor);
    await repo.fijarTipoServicio(db, 3003, null, actor);
    await repo.fijarTipoServicio(db, 3004, null, actor);
    expect(await servicio(3003)).toMatchObject({ tipoServicio: 'Diagnóstico', tipoOrigen: 'desk', tipoManual: null, plazoDias: 3, fechaLimite: '2026-10-08' });
    expect(await servicio(3004)).toMatchObject({ tipoServicio: '', tipoOrigen: null, tipoManual: null, plazoDias: null, estadoPlazo: 'SIN_PLAZO' });
    expect(await filas()).toEqual([]);
    // Quitar lo que no estaba puesto no es un error.
    await expect(repo.fijarTipoServicio(db, 3004, null, actor)).resolves.toBeUndefined();
  });

  it('casa por clave normalizada y guarda la etiqueta de Configuración, firmada con id y correo', async () => {
    await ticket(3005);
    await repo.fijarTipoServicio(db, 3005, '  CALIBRACION ', actor);
    const f = await filas();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ numero: 3005, clave: 'calibracion', etiqueta: 'Calibración', por_id: actor.userId, actualizado_por: actor.email });
    expect(f[0].actualizado_en).toBeInstanceOf(Date);
    expect(await servicio(3005)).toMatchObject({ tipoServicio: 'Calibración', plazoDias: 4 });
  });

  it('cambiarlo otra vez reemplaza el anterior y vuelve a firmar', async () => {
    await ticket(3006);
    await repo.fijarTipoServicio(db, 3006, 'Diagnóstico', actor);
    await repo.fijarTipoServicio(db, 3006, 'Calibración', { userId: null, email: 'otra@ambientalia.com.co' });
    expect(await filas()).toMatchObject([{ numero: 3006, clave: 'calibracion', por_id: null, actualizado_por: 'otra@ambientalia.com.co' }]);
  });

  it('un tipo sin plazo configurado se puede elegir y sale «sin plazo»; al ponerle plazo, lo coge', async () => {
    await ticket(3007);
    await repo.fijarTipoServicio(db, 3007, 'Mantenimiento', actor);
    expect(await servicio(3007)).toMatchObject({ tipoServicio: 'Mantenimiento', tipoOrigen: 'manual', plazoDias: null, fechaLimite: null, estadoPlazo: 'SIN_PLAZO' });
    await repo.guardarPlazo(db, { tipo: 'Mantenimiento', dias: 1 }, actor);
    expect(await servicio(3007)).toMatchObject({ plazoDias: 1, fechaLimite: '2026-10-06', estadoPlazo: 'VENCE_HOY' });
  });

  it('un tipo que no está en Configuración → 400 y no se guarda nada', async () => {
    await ticket(3008, 'Instalación');
    for (const tipo of ['Instalación', 'Reparación', 'diagnostic']) {
      await expect(repo.fijarTipoServicio(db, 3008, tipo, actor)).rejects.toMatchObject({ status: 400, field: 'tipo' });
    }
    expect(await filas()).toEqual([]);
  });

  it('un ticket que no existe en Desk → 404, también al quitar', async () => {
    await expect(repo.fijarTipoServicio(db, 9999, 'Diagnóstico', actor)).rejects.toMatchObject({ status: 404 });
    await expect(repo.fijarTipoServicio(db, 9999, null, actor)).rejects.toMatchObject({ status: 404 });
    expect(await filas()).toEqual([]);
  });

  it('lo puesto a mano sobrevive a volver a ejecutar la migración', async () => {
    await ticket(3009);
    await repo.fijarTipoServicio(db, 3009, 'Diagnóstico', actor);
    await db.query(SQL_044);
    await aplicarMigraciones(db);
    expect(await filas()).toMatchObject([{ numero: 3009, clave: 'diagnostico', actualizado_por: actor.email }]);
    expect(await servicio(3009)).toMatchObject({ tipoServicio: 'Diagnóstico', tipoOrigen: 'manual' });
  });

  it('la tabla rechaza un número de ticket que no sea positivo y una clave vacía', async () => {
    const ins = (numero: number, clave: string) =>
      db.query(`INSERT INTO portal.tmc_servicios_tipo (numero, clave, etiqueta, actualizado_por) VALUES ($1, $2, 'x', 'st@ambientalia.com.co')`, [numero, clave]);
    await expect(ins(0, 'diagnostico')).rejects.toThrow();
    await expect(ins(1, '')).rejects.toThrow();
  });

  it('los tipos que se pueden elegir son las filas de Configuración, en su mismo orden', async () => {
    await ticket(3010, 'Instalación');
    expect(await repo.listarTiposServicio(db)).toEqual([
      { clave: 'calibracion', etiqueta: 'Calibración', dias: 4 },
      { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3 },
      { clave: 'diagnostico + calibracion', etiqueta: 'Diagnóstico + Calibración', dias: 7 },
      { clave: 'garantia', etiqueta: 'Garantía', dias: null },
      { clave: 'mantenimiento', etiqueta: 'Mantenimiento', dias: null },
      { clave: 'no aplica', etiqueta: 'No aplica', dias: null },
      { clave: 'otro', etiqueta: 'Otro', dias: null },
    ]);
  });

  it('Configuración cuenta los tickets abiertos por su tipo efectivo', async () => {
    await ticket(3011);
    await ticket(3012, 'Diagnóstico');
    await ticket(3013, 'Diagnóstico');
    await ticket(3014, null, '2026-10-05', 'Closed');
    await repo.fijarTipoServicio(db, 3011, 'Calibración', actor);
    await repo.fijarTipoServicio(db, 3012, 'Calibración', actor);
    await repo.fijarTipoServicio(db, 3014, 'Calibración', actor);
    const p = await repo.listarPlazos(db);
    expect(p.find((x) => x.clave === 'calibracion')!.ticketsAbiertos).toBe(2);
    expect(p.find((x) => x.clave === 'diagnostico')!.ticketsAbiertos).toBe(1);
  });
});

// Bloque «Estados de Desk» de Configuración: el rol de cada estado en el reloj
// del plazo (cuenta / standby / terminado) y lo que eso deja en cada ticket de
// «Servicios». El cálculo con historial va más abajo.
describe('estados de Desk y su rol', () => {
  const ticket = (numero: number, estado: string, statusType: string | null = 'Open', tipo: string | null = null) =>
    db.query(
      `INSERT INTO desk.tickets (number, status, status_type, serial, tipo_servicio, fecha_creacion_ticket, synced_at)
       VALUES ($1, $2, $3, '18A00001', $4, '2026-10-05', NOW())`,
      [numero, estado, statusType, tipo],
    );
  const estado = async (clave: string) => (await repo.listarEstadosDesk(db)).find((e) => e.clave === clave);
  const marcar = (e: string, rol: RolEstado, quien: { userId: string | null; email: string } = actor) => repo.guardarEstadoDesk(db, { estado: e, rol }, quien);
  const servicio = async (numero: number) => (await repo.listarServicios(db, hoy)).find((s) => s.numero === numero)!;
  const filas = async () =>
    (
      await db.query(
        `SELECT clave, etiqueta, rol, actualizado_por_id::text AS por_id, actualizado_por, actualizado_en
           FROM portal.tmc_estados_desk ORDER BY clave`,
      )
    ).rows;

  /** La categoría en la agenda de un estado que nadie ha clasificado: la de la propuesta (o ninguna), sin firma. */
  const propuesta = (categoria: string | null) => ({ categoria, etapa: null, categoriaPor: null, categoriaEn: null });

  beforeEach(async () => {
    await resembrarPlazos();
  });

  it('sin tickets ni nada guardado, la lista está vacía', async () => {
    expect(await repo.listarEstadosDesk(db)).toEqual([]);
  });

  it('lista todos los estados que existen en Desk, cerrados incluidos, con su tipo y sus tickets abiertos; todos nacen en «cuenta»', async () => {
    await ticket(5001, 'Ingresado');
    await ticket(5002, 'Ingresado');
    await ticket(5003, 'Por Facturar', 'On Hold');
    await ticket(5004, 'Finalizado', 'Closed');
    await ticket(5005, 'Finalizado', 'Closed');
    expect(await repo.listarEstadosDesk(db)).toEqual([
      { clave: 'ingresado', etiqueta: 'Ingresado', tipoDesk: 'Open', ticketsAbiertos: 2, rol: 'cuenta', actualizadoPor: null, actualizadoEn: null, ...propuesta('entrada') },
      { clave: 'por facturar', etiqueta: 'Por Facturar', tipoDesk: 'On Hold', ticketsAbiertos: 1, rol: 'cuenta', actualizadoPor: null, actualizadoEn: null, ...propuesta('fin') },
      { clave: 'finalizado', etiqueta: 'Finalizado', tipoDesk: 'Closed', ticketsAbiertos: 0, rol: 'cuenta', actualizadoPor: null, actualizadoEn: null, ...propuesta('fin') },
    ]);
    // Listar no escribe: sólo hay fila para lo que alguien ha tocado.
    expect(await filas()).toEqual([]);
  });

  it('las grafías del mismo estado (mayúsculas, tildes, espacios repetidos o sobrantes) son una sola fila', async () => {
    await ticket(5010, 'Notificación  Comercial', 'On Hold');
    await ticket(5011, 'Notificación  Comercial', 'On Hold');
    await ticket(5012, ' notificacion comercial ', 'On Hold');
    await ticket(5013, 'NOTIFICACIÓN COMERCIAL', 'Closed');
    const e = await repo.listarEstadosDesk(db);
    expect(e).toHaveLength(1);
    // La etiqueta es la grafía más usada, sin espacios de más; el tipo, el de la mayoría de sus tickets.
    expect(e[0]).toMatchObject({ clave: 'notificacion comercial', etiqueta: 'Notificación Comercial', tipoDesk: 'On Hold', ticketsAbiertos: 3 });
  });

  it('un estado vacío no sale, y uno sin tipo en Desk cuenta sus tickets como abiertos', async () => {
    await ticket(5020, '   ');
    await ticket(5021, 'Nuevo', null);
    expect(await repo.listarEstadosDesk(db)).toEqual([
      { clave: 'nuevo', etiqueta: 'Nuevo', tipoDesk: null, ticketsAbiertos: 1, rol: 'cuenta', actualizadoPor: null, actualizadoEn: null, ...propuesta(null) },
    ]);
  });

  it('elegir «standby» persiste y queda firmado con id, correo y fecha', async () => {
    await ticket(5030, 'Servicio externo', 'On Hold');
    await marcar('Servicio externo', 'standby');
    const e = (await estado('servicio externo'))!;
    expect(e).toMatchObject({ etiqueta: 'Servicio externo', tipoDesk: 'On Hold', ticketsAbiertos: 1, rol: 'standby', actualizadoPor: actor.email });
    expect(e.actualizadoEn).toMatch(/^\d{4}-\d{2}-\d{2}/);
    const f = await filas();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ clave: 'servicio externo', etiqueta: 'Servicio externo', rol: 'standby', por_id: actor.userId, actualizado_por: actor.email });
    expect(f[0].actualizado_en).toBeInstanceOf(Date);
    expect(await servicio(5030)).toMatchObject({ rolEstado: 'standby', enPausa: true });
  });

  it('los tres roles son excluyentes: elegir otro sustituye al anterior en la misma fila', async () => {
    await ticket(5033, 'Por Facturar', 'On Hold');
    await marcar('Por Facturar', 'standby');
    await marcar('Por Facturar', 'terminado');
    expect(await filas()).toMatchObject([{ clave: 'por facturar', rol: 'terminado' }]);
    expect(await estado('por facturar')).toMatchObject({ rol: 'terminado' });
    expect(await servicio(5033)).toMatchObject({ rolEstado: 'terminado', enPausa: false });
  });

  it('volver a «cuenta» conserva la fila y vuelve a firmar con quien lo hizo', async () => {
    await ticket(5031, 'Servicio externo', 'On Hold');
    await marcar('Servicio externo', 'standby');
    await marcar('Servicio externo', 'cuenta', { userId: null, email: 'otra@ambientalia.com.co' });
    expect(await estado('servicio externo')).toMatchObject({ rol: 'cuenta', actualizadoPor: 'otra@ambientalia.com.co' });
    expect(await filas()).toMatchObject([{ clave: 'servicio externo', rol: 'cuenta', por_id: null, actualizado_por: 'otra@ambientalia.com.co' }]);
    expect(await servicio(5031)).toMatchObject({ rolEstado: 'cuenta', enPausa: false });
  });

  it('elegir con otra grafía toca el mismo estado: una sola fila, con su etiqueta limpia', async () => {
    await ticket(5032, 'Notificación  Comercial', 'On Hold');
    await marcar('  notificacion   COMERCIAL ', 'terminado');
    await marcar('Notificación  Comercial', 'standby');
    expect(await filas()).toMatchObject([{ clave: 'notificacion comercial', etiqueta: 'Notificación Comercial', rol: 'standby' }]);
    expect(await repo.listarEstadosDesk(db)).toHaveLength(1);
    expect((await servicio(5032)).enPausa).toBe(true);
  });

  it('un estado guardado que ningún ticket tiene sigue en la lista, con su etiqueta guardada', async () => {
    await ticket(5040, 'Ingresado');
    await marcar('Notificación cliente', 'standby');
    expect(await repo.listarEstadosDesk(db)).toEqual([
      { clave: 'ingresado', etiqueta: 'Ingresado', tipoDesk: 'Open', ticketsAbiertos: 1, rol: 'cuenta', actualizadoPor: null, actualizadoEn: null, ...propuesta('entrada') },
      {
        clave: 'notificacion cliente',
        etiqueta: 'Notificación cliente',
        tipoDesk: null,
        ticketsAbiertos: 0,
        rol: 'standby',
        actualizadoPor: actor.email,
        actualizadoEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}/),
        // Guardar el rol no guarda categoría: sigue valiendo la de la propuesta, sin firma.
        ...propuesta('standby'),
      },
    ]);
    // Cuando un ticket llega a ese estado, coge el tipo de Desk y el rol ya elegido.
    await ticket(5041, 'Notificación Cliente', 'On Hold');
    expect(await estado('notificacion cliente')).toMatchObject({ etiqueta: 'Notificación Cliente', tipoDesk: 'On Hold', ticketsAbiertos: 1, rol: 'standby' });
    expect((await servicio(5041)).enPausa).toBe(true);
  });

  it('orden: tipo abierto, en espera y cerrado; dentro, más tickets abiertos primero y después alfabético', async () => {
    await ticket(5050, 'Finalizado', 'Closed');
    await ticket(5051, 'Servicio externo', 'On Hold');
    await ticket(5052, 'Por Facturar', 'On Hold');
    await ticket(5053, 'Por Facturar', 'On Hold');
    await ticket(5054, 'Ingresado');
    await ticket(5055, 'En Proceso');
    await ticket(5056, 'Por Entregar');
    await ticket(5057, 'Por Entregar');
    await ticket(5058, 'OV asignada', 'On Hold');
    await marcar('Estado sin tickets', 'cuenta');
    expect((await repo.listarEstadosDesk(db)).map((e) => [e.etiqueta, e.ticketsAbiertos])).toEqual([
      ['Por Entregar', 2],
      ['En Proceso', 1],
      ['Ingresado', 1],
      ['Por Facturar', 2],
      ['OV asignada', 1],
      ['Servicio externo', 1],
      ['Finalizado', 0],
      ['Estado sin tickets', 0],
    ]);
  });

  it('los tickets cerrados no cuentan como abiertos aunque su estado esté en standby', async () => {
    await ticket(5060, 'Servicio externo', 'On Hold');
    await ticket(5061, 'Servicio externo', 'Closed');
    await marcar('Servicio externo', 'standby');
    expect(await estado('servicio externo')).toMatchObject({ ticketsAbiertos: 1, rol: 'standby' });
    expect((await repo.listarServicios(db, hoy)).map((s) => s.numero)).toEqual([5060]);
  });

  it('servicios: cada ticket lleva el rol de su estado de ahora; «en pausa» sólo los de standby', async () => {
    await ticket(5070, 'Servicio externo', 'On Hold');
    await ticket(5071, ' servicio  EXTERNO ', 'On Hold');
    await ticket(5072, 'Por Facturar', 'On Hold');
    await ticket(5073, 'En Proceso');
    expect((await repo.listarServicios(db, hoy)).map((s) => [s.rolEstado, s.enPausa])).toEqual(Array(4).fill(['cuenta', false]));
    await marcar('Servicio externo', 'standby');
    await marcar('Por Facturar', 'terminado');
    await marcar('En Proceso', 'standby');
    await marcar('En Proceso', 'cuenta');
    const s = await repo.listarServicios(db, hoy);
    expect(s.map((x) => [x.numero, x.rolEstado, x.enPausa])).toEqual([
      [5073, 'cuenta', false],
      [5072, 'terminado', false],
      [5071, 'standby', true],
      [5070, 'standby', true],
    ]);
    // El estado se sigue enseñando tal como lo escribe Desk.
    expect(s.find((x) => x.numero === 5071)!.estado).toBe(' servicio  EXTERNO ');
    // El booleano de antes ya no viaja: lo dicen `rolEstado` y `enPausa`.
    expect(s.every((x) => !('standby' in x))).toBe(true);
  });

  it('servicios: al cambiar el ticket de estado en Desk, el rol sigue al estado nuevo', async () => {
    await ticket(5075, 'Notificación cliente', 'On Hold');
    await marcar('Notificación cliente', 'standby');
    expect((await servicio(5075)).enPausa).toBe(true);
    await db.query(`UPDATE desk.tickets SET status = 'En Proceso', status_type = 'Open' WHERE number = 5075`);
    expect(await servicio(5075)).toMatchObject({ rolEstado: 'cuenta', enPausa: false });
  });

  it('el rol no cambia los recuentos de Configuración, y sin plazo el ticket sigue «sin plazo»', async () => {
    await ticket(5080, 'Servicio externo', 'On Hold', 'Diagnóstico');
    await ticket(5082, 'Servicio externo', 'On Hold');
    const plazosAntes = await repo.listarPlazos(db);
    await marcar('Servicio externo', 'standby');
    expect(await repo.listarPlazos(db)).toEqual(plazosAntes);
    expect(await servicio(5082)).toMatchObject({ enPausa: true, plazoDias: null, fechaLimite: null, fechaLimiteBase: null, diasHabiles: null, estadoPlazo: 'SIN_PLAZO', tramos: null });
    // Con plazo, el de su tipo no cambia; lo que se corre es la fecha (ver «plazo con el reloj en pausa»).
    expect(await servicio(5080)).toMatchObject({ enPausa: true, plazoDias: 3, fechaLimiteBase: '2026-10-08' });
  });

  it('lo elegido sobrevive a volver a ejecutar la migración', async () => {
    await ticket(5090, 'Servicio externo', 'On Hold');
    await marcar('Servicio externo', 'standby');
    await marcar('Por Facturar', 'terminado');
    await marcar('Ingresado', 'cuenta');
    await db.query(SQL_046);
    await db.query(SQL_046);
    await aplicarMigraciones(db);
    // La 050 siembra además la categoría de agenda de los estados de la propuesta: las filas que crea
    // llevan el rol por defecto y NADIE firma ese rol (la semilla firma la categoría, en sus columnas).
    // A las tres elegidas no les cambia ni el rol ni la firma.
    const todas = await filas();
    const sembradas = todas.filter((f: { actualizado_por: string | null }) => f.actualizado_por !== actor.email);
    expect(sembradas.length).toBeGreaterThan(0);
    for (const f of sembradas) expect(f).toMatchObject({ rol: 'cuenta', por_id: null, actualizado_por: null, actualizado_en: null });
    expect(todas.filter((f: { actualizado_por: string | null }) => f.actualizado_por === actor.email)).toMatchObject([
      { clave: 'ingresado', rol: 'cuenta', actualizado_por: actor.email },
      { clave: 'por facturar', rol: 'terminado', actualizado_por: actor.email },
      { clave: 'servicio externo', rol: 'standby', actualizado_por: actor.email },
    ]);
    expect((await servicio(5090)).enPausa).toBe(true);
  });

  it('la tabla nace sin filas, pone el rol en «cuenta» por defecto y rechaza una clave vacía o un rol que no sea de los tres', async () => {
    expect(await filas()).toEqual([]);
    await db.query(`INSERT INTO portal.tmc_estados_desk (clave, etiqueta, actualizado_por) VALUES ('en proceso', 'En Proceso', 'st@ambientalia.com.co')`);
    expect(await filas()).toMatchObject([{ clave: 'en proceso', rol: 'cuenta' }]);
    await expect(db.query(`INSERT INTO portal.tmc_estados_desk (clave, etiqueta, actualizado_por) VALUES ('', 'x', 'st@ambientalia.com.co')`)).rejects.toThrow();
    for (const rol of ['pausa', 'Standby', '', 'true']) {
      await expect(db.query(`INSERT INTO portal.tmc_estados_desk (clave, etiqueta, rol, actualizado_por) VALUES ('otro', 'Otro', $1, 'st@ambientalia.com.co')`, [rol])).rejects.toThrow();
    }
    // Y lo mismo si alguien se salta la validación de entrada y llega al repo.
    await expect(repo.guardarEstadoDesk(db, { estado: 'Otro', rol: 'pausa' as RolEstado }, actor)).rejects.toThrow();
    expect(await filas()).toHaveLength(1);
    // La columna del booleano de antes no existe. `categoria`, `etapa` y la firma de la categoría son de la agenda (migración 050).
    const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'portal' AND table_name = 'tmc_estados_desk' `);
    expect(cols.rows.map((r: { column_name: string }) => r.column_name).sort()).toEqual(['actualizado_en','actualizado_por', 'actualizado_por_id', 'categoria', 'categoria_en', 'categoria_por', 'categoria_por_id', 'clave', 'etapa', 'etiqueta', 'rol']);
  });
});

// El historial de estados: la réplica sólo trae el estado de ahora, así que
// hub-api apunta los cambios que ve (`registrarEstados`) en
// portal.tmc_estados_historial. Un tramo por estado y, como mucho, uno abierto
// por ticket.
describe('historial de estados: registrarEstados', () => {
  const ticket = (numero: number | null, estado: string, statusType: string | null = 'Open') =>
    db.query(`INSERT INTO desk.tickets (number, status, status_type, serial, fecha_creacion_ticket, synced_at) VALUES ($1, $2, $3, '18A00001', '2026-10-05', NOW())`, [numero, estado, statusType]);
  const cambiar = (numero: number, estado: string, statusType = 'Open') => db.query(`UPDATE desk.tickets SET status = $2, status_type = $3 WHERE number = $1`, [numero, estado, statusType]);
  interface Fila {
    id: string;
    numero: number;
    clave: string;
    etiqueta: string;
    desde: Date;
    hasta: Date | null;
    desde_real: boolean;
  }
  const historial = async (): Promise<Fila[]> =>
    (await db.query(`SELECT id::text AS id, numero, clave, etiqueta, desde, hasta, desde_real FROM portal.tmc_estados_historial ORDER BY numero, desde, id`)).rows as Fila[];
  const abiertos = async () => (await historial()).filter((f) => f.hasta === null).map((f) => [f.numero, f.clave]);

  it('primera observación: un tramo abierto por ticket sin cerrar, marcado como «no se vio empezar»', async () => {
    const antes = Date.now();
    await ticket(7001, 'En Proceso');
    await ticket(7002, ' Notificación  Cliente ', 'On Hold');
    await ticket(7003, 'Nuevo', null);
    await ticket(7004, 'Finalizado', 'Closed');
    expect(await repo.registrarEstados(db)).toEqual({ abiertos: 3, cerrados: 0 });
    const h = await historial();
    expect(h.map((f) => [f.numero, f.clave, f.etiqueta, f.hasta, f.desde_real])).toEqual([
      [7001, 'en proceso', 'En Proceso', null, false],
      [7002, 'notificacion cliente', 'Notificación Cliente', null, false],
      [7003, 'nuevo', 'Nuevo', null, false],
    ]);
    // `desde` es el instante en que se vio, no la creación del ticket.
    for (const f of h) {
      expect(f.desde.getTime()).toBeGreaterThanOrEqual(antes - 5_000);
      expect(f.desde.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
    }
  });

  it('sin cambios no hace nada: es idempotente', async () => {
    await ticket(7010, 'En Proceso');
    await ticket(7011, 'Por Facturar', 'On Hold');
    await repo.registrarEstados(db);
    const antes = await historial();
    expect(await repo.registrarEstados(db)).toEqual({ abiertos: 0, cerrados: 0 });
    expect(await repo.registrarEstados(db)).toEqual({ abiertos: 0, cerrados: 0 });
    expect(await historial()).toEqual(antes);
  });

  it('un cambio de estado cierra el tramo abierto y abre otro en el mismo instante, ya como cambio visto', async () => {
    await ticket(7020, 'En Proceso');
    await ticket(7021, 'En Proceso');
    await repo.registrarEstados(db);
    await cambiar(7020, 'Notificación cliente', 'On Hold');
    expect(await repo.registrarEstados(db)).toEqual({ abiertos: 1, cerrados: 1 });
    const h = await historial();
    expect(h.map((f) => [f.numero, f.clave, f.hasta === null, f.desde_real])).toEqual([
      [7020, 'en proceso', false, false],
      [7020, 'notificacion cliente', true, true],
      [7021, 'en proceso', true, false],
    ]);
    // Sin hueco ni solape entre los dos tramos.
    expect(h[0].hasta!.getTime()).toBe(h[1].desde.getTime());
    expect(h[0].hasta!.getTime()).toBeGreaterThanOrEqual(h[0].desde.getTime());
    // Y otro cambio más encadena igual.
    await cambiar(7020, 'En Proceso');
    await repo.registrarEstados(db);
    const h2 = (await historial()).filter((f) => f.numero === 7020);
    expect(h2.map((f) => [f.clave, f.hasta === null, f.desde_real])).toEqual([
      ['en proceso', false, false],
      ['notificacion cliente', false, true],
      ['en proceso', true, true],
    ]);
    expect(h2[1].hasta!.getTime()).toBe(h2[2].desde.getTime());
  });

  it('otra grafía del mismo estado (espacios, mayúsculas, tildes) NO es un cambio', async () => {
    await ticket(7030, 'Notificación  Cliente', 'On Hold');
    await repo.registrarEstados(db);
    const antes = await historial();
    for (const grafia of ['Notificación Cliente', '  notificacion   cliente ', 'NOTIFICACIÓN CLIENTE', 'Notificacion\tCliente']) {
      await cambiar(7030, grafia, 'On Hold');
      expect(await repo.registrarEstados(db)).toEqual({ abiertos: 0, cerrados: 0 });
    }
    expect(await historial()).toEqual(antes);
    // Tampoco lo es que cambie sólo el tipo de estado de Desk.
    await cambiar(7030, 'Notificación Cliente', 'Open');
    expect(await repo.registrarEstados(db)).toEqual({ abiertos: 0, cerrados: 0 });
  });

  it('un ticket que se cierra en Desk, o que desaparece de la réplica, cierra su tramo y no abre otro', async () => {
    await ticket(7040, 'Por Entregar');
    await ticket(7041, 'Por Entregar');
    await ticket(7042, 'En Proceso');
    await repo.registrarEstados(db);
    await cambiar(7040, 'Finalizado', 'Closed');
    await db.query(`DELETE FROM desk.tickets WHERE number = 7041`);
    expect(await repo.registrarEstados(db)).toEqual({ abiertos: 0, cerrados: 2 });
    const h = await historial();
    expect(h.map((f) => [f.numero, f.clave, f.hasta === null])).toEqual([
      [7040, 'por entregar', false],
      [7041, 'por entregar', false],
      [7042, 'en proceso', true],
    ]);
    expect(await repo.registrarEstados(db)).toEqual({ abiertos: 0, cerrados: 0 });
  });

  it('si un ticket cerrado se reabre, es otra primera observación: no se sabe cuándo volvió', async () => {
    await ticket(7050, 'En Proceso');
    await repo.registrarEstados(db);
    await cambiar(7050, 'Finalizado', 'Closed');
    await repo.registrarEstados(db);
    await cambiar(7050, 'En Proceso');
    expect(await repo.registrarEstados(db)).toEqual({ abiertos: 1, cerrados: 0 });
    expect((await historial()).map((f) => [f.clave, f.hasta === null, f.desde_real])).toEqual([
      ['en proceso', false, false],
      ['en proceso', true, false],
    ]);
  });

  it('un ticket sin número no se apunta, y uno con el estado en blanco sí (con clave vacía)', async () => {
    await ticket(null, 'En Proceso');
    await ticket(7060, '   ');
    expect(await repo.registrarEstados(db)).toEqual({ abiertos: 1, cerrados: 0 });
    expect((await historial()).map((f) => [f.numero, f.clave, f.etiqueta])).toEqual([[7060, '', '']]);
  });

  it('dos (o más) llamadas a la vez dejan un solo tramo abierto por ticket, sin duplicar nada', async () => {
    for (let n = 7100; n < 7120; n++) await ticket(n, n % 2 ? 'En Proceso' : 'Notificación cliente');
    const r1 = await Promise.all([repo.registrarEstados(db), repo.registrarEstados(db), repo.registrarEstados(db), repo.registrarEstados(db)]);
    expect(r1.reduce((n, r) => n + r.abiertos, 0)).toBe(20);
    expect(await historial()).toHaveLength(20);
    expect(await abiertos()).toHaveLength(20);

    // Ahora con cambios de por medio: la mitad cambia de estado y dos se cierran.
    for (let n = 7100; n < 7110; n++) await cambiar(n, 'Por Facturar', 'On Hold');
    await cambiar(7118, 'Finalizado', 'Closed');
    await cambiar(7119, 'Finalizado', 'Closed');
    const r2 = await Promise.all([repo.registrarEstados(db), repo.registrarEstados(db), repo.registrarEstados(db), repo.registrarEstados(db)]);
    expect(r2.reduce((n, r) => n + r.abiertos, 0)).toBe(10);
    expect(r2.reduce((n, r) => n + r.cerrados, 0)).toBe(12);
    const h = await historial();
    expect(h).toHaveLength(30);
    const porTicket = new Map<number, Fila[]>();
    for (const f of h) porTicket.set(f.numero, [...(porTicket.get(f.numero) ?? []), f]);
    for (const [numero, fs] of porTicket) {
      const abiertosDe = fs.filter((f) => f.hasta === null);
      expect(abiertosDe).toHaveLength(numero >= 7118 ? 0 : 1);
      if (numero < 7110) expect(fs.map((f) => [f.clave, f.hasta === null, f.desde_real])).toEqual([[numero % 2 ? 'en proceso' : 'notificacion cliente', false, false], ['por facturar', true, true]]);
    }
  });

  it('la tabla no admite dos tramos abiertos del mismo ticket, ni uno que acabe antes de empezar', async () => {
    const ins = (numero: number, desde: string, hasta: string | null) =>
      db.query(`INSERT INTO portal.tmc_estados_historial (numero, clave, etiqueta, desde, hasta, desde_real) VALUES ($1, 'en proceso', 'En Proceso', $2::timestamptz, $3::timestamptz, TRUE)`, [numero, desde, hasta]);
    await ins(7200, '2026-10-05 10:00:00-05', null);
    await expect(ins(7200, '2026-10-06 10:00:00-05', null)).rejects.toThrow(/tmc_estados_historial_abierto_uq/);
    // Cerrados puede haber los que hagan falta, y otro ticket tiene su propio abierto.
    await ins(7200, '2026-10-01 10:00:00-05', '2026-10-02 10:00:00-05');
    await ins(7200, '2026-10-02 10:00:00-05', '2026-10-05 10:00:00-05');
    await ins(7201, '2026-10-06 10:00:00-05', null);
    await expect(ins(7202, '2026-10-06 10:00:00-05', '2026-10-05 10:00:00-05')).rejects.toThrow();
    await expect(ins(0, '2026-10-06 10:00:00-05', null)).rejects.toThrow();
    expect(await historial()).toHaveLength(4);
  });

  it('el historial sobrevive a volver a ejecutar la migración', async () => {
    await ticket(7300, 'En Proceso');
    await repo.registrarEstados(db);
    await cambiar(7300, 'Notificación cliente', 'On Hold');
    await repo.registrarEstados(db);
    const antes = await historial();
    expect(antes).toHaveLength(2);
    await db.query(SQL_047);
    await db.query(SQL_047);
    await aplicarMigraciones(db);
    expect(await historial()).toEqual(antes);
    expect(await repo.registrarEstados(db)).toEqual({ abiertos: 0, cerrados: 0 });
  });

  it('el rol no se copia al historial: la tabla sólo guarda el estado', async () => {
    const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'portal' AND table_name = 'tmc_estados_historial' `);
    expect(cols.rows.map((r: { column_name: string }) => r.column_name).sort()).toEqual(['clave','desde', 'desde_real', 'etiqueta', 'hasta', 'id', 'numero']);
  });
});

// De punta a punta: tickets, roles y un historial sembrado con instantes
// concretos (hora de Bogotá), leído con `hoy` fijo. Calendario: lun 5 … vie 9
// de octubre de 2026; el lunes 12 es festivo.
describe('servicios: plazo con el reloj en pausa y trabajo terminado', () => {
  const HOY = '2026-10-09';
  const ticket = (numero: number, estado: string, tipo: string | null = 'Diagnóstico', ingreso = '2026-10-05') =>
    db.query(
      `INSERT INTO desk.tickets (number, subject, status, status_type, serial, tipo_servicio, fecha_creacion_ticket, synced_at)
       VALUES ($1, 'Servicio Técnico Cliente Uno', $2, 'Open', '18A00001', $3, $4::date, NOW())`,
      [numero, estado, tipo, ingreso],
    );
  /** Tramos encadenados de un ticket: [estado, desde]; el último queda abierto y el primero es la primera observación. */
  const historia = async (numero: number, ...pasos: [estado: string, desde: string][]) => {
    for (const [i, [estado, desde]] of pasos.entries()) {
      await db.query(
        `INSERT INTO portal.tmc_estados_historial (numero, clave, etiqueta, desde, hasta, desde_real)
         VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6)`,
        [numero, claveEstadoDesk(estado), estado, `${desde}:00-05`, i + 1 < pasos.length ? `${pasos[i + 1][1]}:00-05` : null, i > 0],
      );
    }
  };
  const servicio = async (numero: number, hoyDe = HOY) => (await repo.listarServicios(db, hoyDe)).find((s) => s.numero === numero)!;

  beforeEach(async () => {
    await resembrarPlazos();
    await repo.guardarEstadoDesk(db, { estado: 'Notificación cliente', rol: 'standby' }, actor);
    await repo.guardarEstadoDesk(db, { estado: 'Por Facturar', rol: 'terminado' }, actor);
    await repo.guardarEstadoDesk(db, { estado: 'Por Entregar', rol: 'terminado' }, actor);
  });

  it('sin historial todo cuenta: el plazo de siempre, sin pausas y sin fecha de medida', async () => {
    await ticket(6000, 'En Proceso');
    expect(await servicio(6000)).toMatchObject({
      rolEstado: 'cuenta',
      enPausa: false,
      diasPausados: 0,
      pausas: [],
      terminadoEl: null,
      medidoDesde: null,
      plazoDias: 3,
      fechaLimite: '2026-10-08',
      fechaLimiteBase: '2026-10-08',
      diasHabiles: -1,
      estadoPlazo: 'VENCIDO',
      tramos: null,
    });
  });

  it('una pausa en medio corre la fecha límite los días hábiles que duró', async () => {
    await ticket(6001, 'En Proceso');
    await historia(6001, ['En Proceso', '2026-10-05 12:00'], ['Notificación cliente', '2026-10-06 10:00'], ['En Proceso', '2026-10-08 09:00']);
    expect(await servicio(6001)).toMatchObject({
      rolEstado: 'cuenta',
      enPausa: false,
      diasPausados: 2,
      pausas: [{ desde: '2026-10-06', hasta: '2026-10-07' }],
      medidoDesde: '2026-10-05',
      plazoDias: 3,
      fechaLimiteBase: '2026-10-08',
      fechaLimite: '2026-10-13',
      diasHabiles: 1,
      estadoPlazo: 'EN_PLAZO',
      terminadoEl: null,
    });
  });

  it('en standby ahora: en pausa, y la fecha proyectada se corre con cada día hábil', async () => {
    await ticket(6002, 'Notificación  Cliente');
    await historia(6002, ['En Proceso', '2026-10-05 12:00'], ['Notificación cliente', '2026-10-06 10:00']);
    expect(await servicio(6002, '2026-10-06')).toMatchObject({ enPausa: true, diasPausados: 1, fechaLimite: '2026-10-09', estadoPlazo: 'EN_PLAZO', diasHabiles: 3 });
    expect(await servicio(6002, '2026-10-07')).toMatchObject({ enPausa: true, diasPausados: 2, fechaLimite: '2026-10-13', diasHabiles: 3 });
    expect(await servicio(6002)).toMatchObject({ rolEstado: 'standby', enPausa: true, diasPausados: 4, pausas: [{ desde: '2026-10-06', hasta: '2026-10-09' }], fechaLimiteBase: '2026-10-08', fechaLimite: '2026-10-15' });
  });

  it('trabajo terminado a tiempo → CUMPLIDO; tarde → INCUMPLIDO; visto ya terminado → TERMINADO', async () => {
    await ticket(6003, 'Por Facturar');
    await historia(6003, ['En Proceso', '2026-10-05 12:00'], ['Por Facturar', '2026-10-07 15:00']);
    await ticket(6004, 'Por Entregar');
    await historia(6004, ['En Proceso', '2026-10-05 12:00'], ['Por Entregar', '2026-10-09 08:00']);
    await ticket(6005, 'Por Facturar');
    await historia(6005, ['Por Facturar', '2026-10-06 10:00']);
    expect(await servicio(6003)).toMatchObject({ rolEstado: 'terminado', enPausa: false, terminadoEl: '2026-10-07', fechaLimite: '2026-10-08', diasHabiles: 1, estadoPlazo: 'CUMPLIDO', diasPausados: 0, pausas: [] });
    expect(await servicio(6004)).toMatchObject({ rolEstado: 'terminado', terminadoEl: '2026-10-09', fechaLimite: '2026-10-08', diasHabiles: -1, estadoPlazo: 'INCUMPLIDO' });
    expect(await servicio(6005)).toMatchObject({ rolEstado: 'terminado', terminadoEl: '2026-10-06', fechaLimite: '2026-10-08', estadoPlazo: 'TERMINADO', medidoDesde: '2026-10-06' });
    // Semanas después siguen igual: el reloj está parado.
    expect(await servicio(6003, '2026-11-20')).toMatchObject({ terminadoEl: '2026-10-07', fechaLimite: '2026-10-08', diasHabiles: 1, estadoPlazo: 'CUMPLIDO' });
    expect(await servicio(6004, '2026-11-20')).toMatchObject({ fechaLimite: '2026-10-08', diasHabiles: -1, estadoPlazo: 'INCUMPLIDO' });
  });

  it('sin tipo de servicio: «sin plazo», pero con su rol, sus pausas y cuándo se terminó', async () => {
    await ticket(6006, 'En Proceso', null);
    await historia(6006, ['En Proceso', '2026-10-05 12:00'], ['Notificación cliente', '2026-10-06 10:00'], ['En Proceso', '2026-10-08 09:00']);
    await ticket(6016, 'Por Facturar', null);
    await historia(6016, ['En Proceso', '2026-10-05 12:00'], ['Por Facturar', '2026-10-07 15:00']);
    expect(await servicio(6006)).toMatchObject({ estadoPlazo: 'SIN_PLAZO', fechaLimite: null, fechaLimiteBase: null, diasHabiles: null, diasPausados: 2, pausas: [{ desde: '2026-10-06', hasta: '2026-10-07' }], medidoDesde: '2026-10-05' });
    expect(await servicio(6016)).toMatchObject({ estadoPlazo: 'SIN_PLAZO', rolEstado: 'terminado', terminadoEl: '2026-10-07', fechaLimite: null });
  });

  it('tipo compuesto: los dos tramos se corren con la pausa', async () => {
    await ticket(6007, 'En Proceso', 'Diagnóstico + Calibración');
    await historia(6007, ['En Proceso', '2026-10-05 12:00'], ['Notificación cliente', '2026-10-06 10:00'], ['En Proceso', '2026-10-07 08:00']);
    const s = await servicio(6007, '2026-10-08');
    expect(s).toMatchObject({ plazoDias: 7, diasPausados: 1, fechaLimiteBase: '2026-10-15', fechaLimite: '2026-10-16' });
    expect(s.tramos).toEqual([
      { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3, hasta: '2026-10-09' },
      { clave: 'calibracion', etiqueta: 'Calibración', dias: 4, hasta: '2026-10-16' },
    ]);
  });

  it('cambiar el rol de un estado reevalúa el mismo historial, hacia atrás', async () => {
    await ticket(6008, 'En Proceso');
    await historia(6008, ['En Proceso', '2026-10-05 12:00'], ['Notificación cliente', '2026-10-06 10:00'], ['En Proceso', '2026-10-08 09:00']);
    expect(await servicio(6008)).toMatchObject({ fechaLimite: '2026-10-13', diasPausados: 2 });
    await repo.guardarEstadoDesk(db, { estado: 'Notificación cliente', rol: 'cuenta' }, actor);
    expect(await servicio(6008)).toMatchObject({ fechaLimite: '2026-10-08', diasPausados: 0, pausas: [], estadoPlazo: 'VENCIDO' });
    // El historial no ha cambiado: sólo se lee con otro rol.
    await repo.guardarEstadoDesk(db, { estado: 'Notificación cliente', rol: 'terminado' }, actor);
    expect(await servicio(6008)).toMatchObject({ fechaLimite: '2026-10-13', diasPausados: 2, terminadoEl: null });
    const n = await db.query(`SELECT count(*)::int AS n FROM portal.tmc_estados_historial WHERE numero = 6008`);
    expect(n.rows[0].n).toBe(3);
  });

  it('el historial de un ticket no se mezcla con el de otro, ni el de uno ya cerrado estorba', async () => {
    await ticket(6009, 'En Proceso');
    await ticket(6010, 'En Proceso');
    await historia(6010, ['En Proceso', '2026-10-05 12:00'], ['Notificación cliente', '2026-10-06 10:00'], ['En Proceso', '2026-10-08 09:00']);
    await historia(6999, ['Notificación cliente', '2026-10-01 10:00']);
    expect(await servicio(6009)).toMatchObject({ diasPausados: 0, fechaLimite: '2026-10-08', medidoDesde: null });
    expect(await servicio(6010)).toMatchObject({ diasPausados: 2, fechaLimite: '2026-10-13' });
  });

  it('con `registrarEstados` de verdad: lo que apunta es lo que lee, y lo anterior a ese momento cuenta como activo', async () => {
    const hoyReal = hoyEnColombia();
    await ticket(6020, 'Notificación cliente', 'Diagnóstico', '2020-01-06');
    await ticket(6021, 'Por Facturar', 'Diagnóstico', '2020-01-06');
    await repo.registrarEstados(db);
    const s = await repo.listarServicios(db, hoyReal);
    const standby = s.find((x) => x.numero === 6020)!;
    // Ingresó en 2020 y se ve hoy por primera vez: el plazo se consumió entero antes de la primera observación.
    expect(standby).toMatchObject({ rolEstado: 'standby', enPausa: true, medidoDesde: hoyReal, fechaLimite: '2020-01-09', fechaLimiteBase: '2020-01-09', estadoPlazo: 'VENCIDO', terminadoEl: null });
    expect(standby.diasPausados).toBeLessThanOrEqual(1);
    expect(s.find((x) => x.numero === 6021)).toMatchObject({ rolEstado: 'terminado', terminadoEl: hoyReal, medidoDesde: hoyReal, estadoPlazo: 'TERMINADO', fechaLimite: '2020-01-09' });
    // Sale de standby: el cambio queda apuntado y el ticket deja de estar en pausa.
    await db.query(`UPDATE desk.tickets SET status = 'En Proceso' WHERE number = 6020`);
    await repo.registrarEstados(db);
    expect((await repo.listarServicios(db, hoyReal)).find((x) => x.numero === 6020)).toMatchObject({ rolEstado: 'cuenta', enPausa: false, diasPausados: 0 });
  });
});

// El tipo compuesto «Diagnóstico + Calibración»: su plazo no se guarda, es la
// suma en vivo de los de sus partes (TIPOS_COMPUESTOS en dominio.ts).
describe('tipo compuesto «Diagnóstico + Calibración»', () => {
  const COMBINADO = 'diagnostico + calibracion';
  const ticket = (numero: number, tipo: string | null = null, fechaTicket = '2026-10-01', statusType = 'Open') =>
    db.query(
      `INSERT INTO desk.tickets (number, status, status_type, serial, tipo_servicio, fecha_creacion_ticket, synced_at)
       VALUES ($1, 'En diagnóstico', $2, '18A00001', $3, $4::date, NOW())`,
      [numero, statusType, tipo, fechaTicket],
    );
  const servicio = async (numero: number) => (await repo.listarServicios(db, hoy)).find((s) => s.numero === numero)!;
  const plazo = async (clave: string) => (await repo.listarPlazos(db)).find((p) => p.clave === clave)!;
  const opcion = async (clave: string) => (await repo.listarTiposServicio(db)).find((t) => t.clave === clave)!;
  const filaCombinada = async () =>
    (await db.query(`SELECT clave, etiqueta, dias_habiles, actualizado_por FROM portal.tmc_plazos WHERE clave LIKE '%+%' ORDER BY clave`)).rows;

  beforeEach(async () => {
    await resembrarPlazos();
  });

  it('se elige a mano como cualquier otro y su plazo es la suma de sus partes, con la fecha intermedia', async () => {
    await ticket(4001);
    await repo.fijarTipoServicio(db, 4001, 'Diagnóstico + Calibración', actor);
    // jue 1 + 3 → vie 2, lun 5, mar 6; + 4 → mié 7, jue 8, vie 9, (lun 12 festivo), mar 13
    expect(await servicio(4001)).toMatchObject({
      tipoServicio: 'Diagnóstico + Calibración',
      tipoOrigen: 'manual',
      plazoDias: 7,
      fechaLimite: '2026-10-13',
      diasHabiles: 4,
      estadoPlazo: 'EN_PLAZO',
      tramos: [
        { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3, hasta: '2026-10-06' },
        { clave: 'calibracion', etiqueta: 'Calibración', dias: 4, hasta: '2026-10-13' },
      ],
    });
    expect((await servicio(4001)).tipoManual).toMatchObject({ clave: COMBINADO, por: actor.email });
  });

  it('también vale si es Desk quien lo trae, con cualquier grafía', async () => {
    await ticket(4002, ' DIAGNOSTICO  +  calibración ');
    expect(await servicio(4002)).toMatchObject({ tipoOrigen: 'desk', plazoDias: 7, fechaLimite: '2026-10-13' });
    expect((await servicio(4002)).tramos).toHaveLength(2);
  });

  it('cambiar el plazo de una parte cambia el del compuesto, sin tocar su fila', async () => {
    await ticket(4003);
    await repo.fijarTipoServicio(db, 4003, 'Diagnóstico + Calibración', actor);
    await repo.guardarPlazo(db, { tipo: 'Diagnóstico', dias: 5 }, actor);
    // jue 1 + 5 → jue 8; + 4 → vie 9, mar 13, mié 14, jue 15
    const s = await servicio(4003);
    expect(s).toMatchObject({ plazoDias: 9, fechaLimite: '2026-10-15' });
    expect(s.tramos!.map((t) => [t.dias, t.hasta])).toEqual([
      [5, '2026-10-08'],
      [4, '2026-10-15'],
    ]);
    expect((await opcion(COMBINADO)).dias).toBe(9);
    expect((await plazo(COMBINADO)).dias).toBe(9);
    expect(await filaCombinada()).toEqual([{ clave: COMBINADO, etiqueta: 'Diagnóstico + Calibración', dias_habiles: null, actualizado_por: null }]);
  });

  it('si a una parte le falta el plazo, el compuesto queda sin plazo y sin tramos', async () => {
    await ticket(4004);
    await repo.fijarTipoServicio(db, 4004, 'Diagnóstico + Calibración', actor);
    await repo.guardarPlazo(db, { tipo: 'Calibración', dias: null }, actor);
    expect(await servicio(4004)).toMatchObject({ plazoDias: null, fechaLimite: null, diasHabiles: null, estadoPlazo: 'SIN_PLAZO', tramos: null });
    expect((await opcion(COMBINADO)).dias).toBeNull();
    expect(await plazo(COMBINADO)).toMatchObject({
      dias: null,
      derivadoDe: [
        { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3 },
        { clave: 'calibracion', etiqueta: 'Calibración', dias: null },
      ],
    });
  });

  it('un tipo simple no lleva tramos', async () => {
    await ticket(4005, 'Diagnóstico');
    await ticket(4006);
    expect(await servicio(4005)).toMatchObject({ plazoDias: 3, tramos: null });
    expect(await servicio(4006)).toMatchObject({ plazoDias: null, tramos: null });
  });

  it('Configuración lo enseña con sus días calculados y de qué partes salen; los demás no son derivados', async () => {
    const p = await repo.listarPlazos(db);
    expect(p.find((x) => x.clave === COMBINADO)).toEqual({
      clave: COMBINADO,
      etiqueta: 'Diagnóstico + Calibración',
      dias: 7,
      derivadoDe: [
        { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3 },
        { clave: 'calibracion', etiqueta: 'Calibración', dias: 4 },
      ],
      ticketsAbiertos: 0,
      actualizadoPor: null,
      actualizadoEn: null,
    });
    expect(p.filter((x) => x.derivadoDe !== null).map((x) => x.clave)).toEqual([COMBINADO]);
    // Con plazo, va en el grupo de los que tienen plazo, por orden alfabético.
    expect(p.map((x) => x.clave).slice(0, 3)).toEqual(['calibracion', 'diagnostico', COMBINADO]);
  });

  it('los tickets del tipo compuesto cuentan en SU fila, no en las de sus partes', async () => {
    await ticket(4010);
    await ticket(4011, 'Diagnóstico');
    await ticket(4012, 'diagnostico + calibracion');
    await ticket(4013, 'Calibración');
    await ticket(4014, null, '2026-10-01', 'Closed');
    await repo.fijarTipoServicio(db, 4010, 'Diagnóstico + Calibración', actor);
    await repo.fijarTipoServicio(db, 4011, 'Diagnóstico + Calibración', actor);
    await repo.fijarTipoServicio(db, 4014, 'Diagnóstico + Calibración', actor);
    const p = await repo.listarPlazos(db);
    expect(p.find((x) => x.clave === COMBINADO)!.ticketsAbiertos).toBe(3);
    expect(p.find((x) => x.clave === 'diagnostico')!.ticketsAbiertos).toBe(0);
    expect(p.find((x) => x.clave === 'calibracion')!.ticketsAbiertos).toBe(1);
  });

  it('su plazo no se puede guardar: 400 y la fila queda como estaba', async () => {
    for (const c of [
      { tipo: 'Diagnóstico + Calibración', dias: 9 },
      { tipo: ' DIAGNOSTICO + CALIBRACION ', dias: null },
    ]) {
      await expect(repo.guardarPlazo(db, c, actor)).rejects.toMatchObject({ status: 400, code: 'invalid_input', field: 'tipo' });
    }
    expect(await filaCombinada()).toEqual([{ clave: COMBINADO, etiqueta: 'Diagnóstico + Calibración', dias_habiles: null, actualizado_por: null }]);
    expect((await plazo(COMBINADO)).dias).toBe(7);
  });

  it('unos días escritos en su fila por fuera de la app no cuentan: manda la suma', async () => {
    await db.query(`UPDATE portal.tmc_plazos SET dias_habiles = 30 WHERE clave = $1`, [COMBINADO]);
    await ticket(4020);
    await repo.fijarTipoServicio(db, 4020, 'Diagnóstico + Calibración', actor);
    expect(await servicio(4020)).toMatchObject({ plazoDias: 7, fechaLimite: '2026-10-13' });
    expect((await plazo(COMBINADO)).dias).toBe(7);
    expect((await opcion(COMBINADO)).dias).toBe(7);
  });

  it('volver a ejecutar la 045 ni duplica la fila ni pisa lo que tuviera', async () => {
    await db.query(`UPDATE portal.tmc_plazos SET etiqueta = 'Diagnóstico + Calibración (revisada)', actualizado_por = 'st@ambientalia.com.co' WHERE clave = $1`, [COMBINADO]);
    await db.query(SQL_045);
    await db.query(SQL_045);
    await aplicarMigraciones(db);
    expect(await filaCombinada()).toEqual([
      { clave: COMBINADO, etiqueta: 'Diagnóstico + Calibración (revisada)', dias_habiles: null, actualizado_por: 'st@ambientalia.com.co' },
    ]);
    expect(await repo.listarPlazos(db)).toHaveLength(7);
  });

  it('la 045 sobre una tabla sin la fila la crea, sin tocar los plazos editados de las partes', async () => {
    await repo.guardarPlazo(db, { tipo: 'Diagnóstico', dias: 6 }, actor);
    await db.query(`DELETE FROM portal.tmc_plazos WHERE clave = $1`, [COMBINADO]);
    await db.query(SQL_045);
    expect(await filaCombinada()).toEqual([{ clave: COMBINADO, etiqueta: 'Diagnóstico + Calibración', dias_habiles: null, actualizado_por: null }]);
    expect(await plazo('diagnostico')).toMatchObject({ dias: 6, actualizadoPor: actor.email });
    expect((await plazo(COMBINADO)).dias).toBe(10);
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
      ['Diagnóstico + Calibración', 7],
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
      derivadoDe: null,
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
    expect(await repo.listarPlazos(db)).toHaveLength(7);
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

// Roles de la app (portal.tmc_user_roles, migración 049): el rol de cada
// persona, que reparten los administradores del portal. Sin fila se es LECTOR.
describe('roles de la app', () => {
  const APP = 'trazabilidad-mantenimientos';
  const admin = { userId: null, email: 'admin@roles-tmc.example' };
  const NADIE = '00000000-0000-4000-8000-00000000dead';

  /** Un usuario del portal, con la app asignada o sin ella. */
  async function usuario(nombre: string, opts: { app?: boolean; role?: 'admin' | 'reader' } = {}): Promise<string> {
    const email = `${nombre.toLowerCase().replace(/\s+/g, '.')}@roles-tmc.example`;
    const { rows } = await db.query(`INSERT INTO portal.users (full_name, email, password_hash, role, status) VALUES ($1, $2, 'x', $3, 'active') RETURNING id`, [nombre, email, opts.role ?? 'reader']);
    if (opts.app !== false) await db.query(`INSERT INTO portal.user_apps (user_id, app_id) VALUES ($1, $2)`, [rows[0].id, APP]);
    return rows[0].id as string;
  }
  const filas = async () => (await db.query(`SELECT user_id, role, actualizado_por, actualizado_en FROM portal.tmc_user_roles ORDER BY user_id`)).rows;

  beforeEach(async () => {
    // Al borrar los usuarios se van sus roles (ON DELETE CASCADE) y sus apps.
    await db.query(`DELETE FROM portal.users WHERE email LIKE '%@roles-tmc.example'`);
  });

  it('quien no tiene fila no tiene rol guardado: el dominio lo resuelve a LECTOR', async () => {
    const id = await usuario('Ana Uno');
    expect(await repo.rolDeUsuario(db, id)).toBeNull();
  });

  it.each([...ROLES_APP])('guarda el rol %s, firmado, y lo devuelve', async (rol) => {
    const id = await usuario('Ana Uno');
    await repo.guardarRol(db, id, rol, { userId: actor.userId, email: admin.email });
    expect(await repo.rolDeUsuario(db, id)).toBe(rol);
    const { rows } = await db.query(`SELECT role, actualizado_por_id::text AS por_id, actualizado_por, actualizado_en FROM portal.tmc_user_roles WHERE user_id = $1`, [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: rol, por_id: actor.userId, actualizado_por: admin.email });
    expect(rows[0].actualizado_en).toBeInstanceOf(Date);
  });

  it('cambiar el rol reescribe la misma fila: una por usuario', async () => {
    const id = await usuario('Ana Uno');
    await repo.guardarRol(db, id, 'COMERCIAL', admin);
    await repo.guardarRol(db, id, 'DIRECTOR_TECNICO', admin);
    await repo.guardarRol(db, id, 'LECTOR', admin);
    expect(await repo.rolDeUsuario(db, id)).toBe('LECTOR');
    expect(await filas()).toHaveLength(1);
  });

  it('la tabla rechaza un rol que no está en la matriz, y un usuario que no existe', async () => {
    const id = await usuario('Ana Uno');
    const ins = (userId: string, role: string) => db.query(`INSERT INTO portal.tmc_user_roles (user_id, role, actualizado_por) VALUES ($1, $2, 'alguien@example.com')`, [userId, role]);
    await expect(ins(id, 'ADMIN')).rejects.toMatchObject({ code: '23514' });
    await expect(ins(id, 'lector')).rejects.toMatchObject({ code: '23514' });
    await expect(ins(NADIE, 'TECNICO')).rejects.toMatchObject({ code: '23503' });
    expect(await filas()).toEqual([]);
  });

  it('usuarioPortal distingue al que está del que no, y dice si es administrador del portal', async () => {
    const id = await usuario('Ana Uno');
    const jefe = await usuario('Ana Admin', { app: false, role: 'admin' });
    expect(await repo.usuarioPortal(db, id)).toEqual({ admin: false });
    expect(await repo.usuarioPortal(db, jefe)).toEqual({ admin: true });
    expect(await repo.usuarioPortal(db, NADIE)).toBeNull();
  });

  it('borrar al usuario se lleva su rol', async () => {
    const id = await usuario('Ana Uno');
    await repo.guardarRol(db, id, 'TECNICO', admin);
    await db.query(`DELETE FROM portal.users WHERE id = $1`, [id]);
    expect(await repo.rolDeUsuario(db, id)).toBeNull();
  });

  it('la lista trae a quien tiene la app, a quien tiene rol guardado y a los administradores, por nombre; sin fila, LECTOR', async () => {
    const conApp = await usuario('Berta Dos');
    const conRol = await usuario('Carlos Tres');
    const sinApp = await usuario('Dora Cuatro', { app: false });
    const jefe = await usuario('Ana Admin', { app: false, role: 'admin' });
    await usuario('Zoe Fuera', { app: false });
    await repo.guardarRol(db, conRol, 'DIRECTOR_TECNICO', admin);
    await repo.guardarRol(db, sinApp, 'COMERCIAL', admin);

    const lista = (await repo.listarUsuariosRol(db, APP)).filter((u) => u.email.endsWith('@roles-tmc.example'));
    expect(lista).toEqual([
      { userId: jefe, fullName: 'Ana Admin', email: 'ana.admin@roles-tmc.example', status: 'active', admin: true, role: 'LECTOR' },
      { userId: conApp, fullName: 'Berta Dos', email: 'berta.dos@roles-tmc.example', status: 'active', admin: false, role: 'LECTOR' },
      { userId: conRol, fullName: 'Carlos Tres', email: 'carlos.tres@roles-tmc.example', status: 'active', admin: false, role: 'DIRECTOR_TECNICO' },
      { userId: sinApp, fullName: 'Dora Cuatro', email: 'dora.cuatro@roles-tmc.example', status: 'active', admin: false, role: 'COMERCIAL' },
    ]);
  });

  it('volver a ejecutar la migración 049 (cada arranque) no toca los roles repartidos', async () => {
    const id = await usuario('Ana Uno');
    await repo.guardarRol(db, id, 'DIRECTOR_TECNICO', admin);
    const antes = await filas();
    expect(antes).toHaveLength(1);
    await db.query(SQL_049);
    await db.query(SQL_049);
    await aplicarMigraciones(db);
    expect(await filas()).toEqual(antes);
    expect(await repo.rolDeUsuario(db, id)).toBe('DIRECTOR_TECNICO');
  });

  it('sin semilla: tras migrar no hay ningún rol repartido, y las columnas son las de la 049', async () => {
    await aplicarMigraciones(db);
    expect(await filas()).toEqual([]);
    const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'portal' AND table_name = 'tmc_user_roles' `);
    expect(cols.rows.map((r: { column_name: string }) => r.column_name).sort()).toEqual(['actualizado_en', 'actualizado_por', 'actualizado_por_id', 'role', 'user_id']);
  });
});
