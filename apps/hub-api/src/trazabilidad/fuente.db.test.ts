import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { crearPoolDesk2 } from '../db-desk2.js';
import { asegurarDesk2, asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import { clasificarFallo, crearFuenteAgenda, type TicketTaller } from './fuente.js';

// La fuente de la agenda contra Postgres de verdad: el SQL de las dos fuentes,
// que el pool de Desk 2.0 no deja escribir, que su tope de tiempo corta, y la
// caída al respaldo con fallos reales (puerto cerrado, contraseña mal, base
// sin las tablas). La «base de Desk 2.0» es una imitación en el contenedor de
// prueba (asegurarDesk2). Datos ficticios: el repo es público.

let hub: Pool; // la base del portal, con la réplica desk.tickets
let admin2: Pool; // la imitación de Desk 2.0, como superusuario: para sembrar
let lector: Pool; // la imitación de Desk 2.0 como la ve hub-api: rol de sólo lectura + pool de db-desk2.ts
let urls: { urlLector: string; urlAdmin: string };

const AHORA = Date.UTC(2026, 9, 6, 13, 30, 0);
const fuenteCon = (desk2: Pool | null, ahora = AHORA) => crearFuenteAgenda({ hub, desk2: () => desk2, ahora: () => ahora });

beforeAll(async () => {
  hub = poolDePrueba();
  await asegurarDeskTickets(hub);
  urls = await asegurarDesk2(hub);
  admin2 = createPoolFromUrl(urls.urlAdmin);
  lector = crearPoolDesk2(urls.urlLector);
});
afterAll(async () => {
  await Promise.all([lector?.end(), admin2?.end(), hub?.end()]);
});
beforeEach(async () => {
  await hub.query('TRUNCATE desk.tickets');
  await admin2.query('TRUNCATE desk.tickets, desk.ticket_transitions, public.calendario_cierres RESTART IDENTITY');
});

/** Cuatro tickets en «Desk 2.0»: dos de Zoho abiertos, uno nacido en la app y uno cerrado. */
async function sembrarDesk2(): Promise<void> {
  await admin2.query(`
    INSERT INTO desk.tickets (id, number, status, status_type, priority, classification, created_time, tipo_servicio, fecha_creacion_ticket, fecha_remision_entrada, prioridad_en_app_at, synced_at) VALUES
      ('z-1001', 1001, 'Rev./Diagnostico', 'Open', 'High', 'Equipo Para Servicio', '2026-09-20T15:00:00Z', 'Diagnostico', '2026-09-21', '2026-09-25', NULL, '2026-10-06T12:00:00Z'),
      ('z-1002', 1002, 'Ingresado', NULL, NULL, '  ', '2026-10-01T15:00:00Z', NULL, NULL, NULL, NULL, '2026-10-01T08:00:00Z'),
      ('app-uno', 10005, 'Rev./Diagnostico', 'Open', 'Urgent', 'Equipo Nuevo', '2026-09-29T03:30:00Z', 'Calibración', NULL, '2026-09-29', '2026-09-30T10:00:00Z', NULL),
      ('z-900', 900, 'Finalizado', 'Closed', 'Low', NULL, '2026-08-01T15:00:00Z', 'Diagnostico', '2026-08-01', '2026-08-02', NULL, '2026-10-06T13:00:00Z');
    INSERT INTO desk.ticket_transitions (ticket_id, to_status, performed_at) VALUES
      ('app-uno', 'Rev./Diagnostico', '2026-09-29T14:00:00Z'),
      ('app-uno', 'Notificado', '2026-09-30T09:00:00Z'),
      ('app-uno', 'Rev./Diagnostico', '2026-09-30T16:00:00Z'),
      ('app-uno', 'Remisión creada', '2026-09-29T13:00:00Z'),
      ('z-900', 'Finalizado', '2026-10-06T13:00:00Z')`);
}

describe('fuente principal: la base de Desk 2.0', () => {
  it('lee los tickets sin cerrar, normalizados y por número', async () => {
    await sembrarDesk2();
    expect(await fuenteCon(lector).ticketsAbiertos()).toEqual<TicketTaller[]>([
      // La prioridad «High» viene de Zoho (no está fijada en la app): no cuenta. Sin transiciones: llegada desconocida.
      { numero: 1001, estado: 'Rev./Diagnostico', tipoEstado: 'Open', clasificacion: 'Equipo Para Servicio', tipoServicio: 'Diagnostico', remisionEntrada: '2026-09-25', fechaCreacion: '2026-09-21', prioridad: null, llegadaEstado: null, asunto: null, codigoServicio: null, fuente: 'principal' },
      // Sin tipo de estado sigue siendo «sin cerrar»; la fecha de creación sale de created_time, en el día de Colombia.
      { numero: 1002, estado: 'Ingresado', tipoEstado: null, clasificacion: null, tipoServicio: null, remisionEntrada: null, fechaCreacion: '2026-10-01', prioridad: null, llegadaEstado: null, asunto: null, codigoServicio: null, fuente: 'principal' },
      // Nacido en la app: prioridad fijada, y la llegada es la ÚLTIMA transición a su estado de ahora
      // (ni la primera, ni la de «Notificado»). 03:30 UTC del 29 es todavía el 28 en Colombia.
      { numero: 10005, estado: 'Rev./Diagnostico', tipoEstado: 'Open', clasificacion: 'Equipo Nuevo', tipoServicio: 'Calibración', remisionEntrada: '2026-09-29', fechaCreacion: '2026-09-28', prioridad: 'Urgent', llegadaEstado: Date.UTC(2026, 8, 30, 16, 0, 0), asunto: null, codigoServicio: null, fuente: 'principal' },
    ]);
  });

  it('la última sincronización es el máximo de toda la tabla (cerrados incluidos); el ticket de la app, sin fecha, no la altera (D13)', async () => {
    await sembrarDesk2();
    expect(await fuenteCon(lector).estadoFuente()).toEqual({
      fuente: 'principal',
      motivo: null,
      mensaje: null,
      ultimaSincronizacion: '2026-10-06T13:00:00.000Z',
      sincronizacionParada: false,
      umbralSincronizacionMs: 3_600_000,
      ultimoFalloPrincipal: null,
    });
    expect((await fuenteCon(lector, Date.UTC(2026, 9, 6, 14, 0, 1)).estadoFuente()).sincronizacionParada).toBe(true);
  });

  it('una base vacía cuenta como sincronización parada', async () => {
    expect(await fuenteCon(lector).estadoFuente()).toMatchObject({ fuente: 'principal', ultimaSincronizacion: null, sincronizacionParada: true });
    expect(await fuenteCon(lector).ticketsAbiertos()).toEqual([]);
  });

  it('cierresEmpresa devuelve los del tramo, con los dos extremos', async () => {
    await admin2.query(`INSERT INTO public.calendario_cierres (fecha) VALUES ('2026-12-23'), ('2026-12-24'), ('2026-12-31'), ('2027-01-02')`);
    expect(await fuenteCon(lector).cierresEmpresa('2026-12-24', '2026-12-31')).toEqual(['2026-12-24', '2026-12-31']);
    expect(await fuenteCon(lector).cierresEmpresa('2027-02-01', '2027-02-28')).toEqual([]);
  });
});

describe('el pool de Desk 2.0 es de sólo lectura', () => {
  const ESCRITURA = `INSERT INTO desk.tickets (id, number, status) VALUES ('z-1', 1, 'Ingresado')`;
  const cuantos = async () => Number((await admin2.query('SELECT count(*)::int AS n FROM desk.tickets')).rows[0].n);

  it('con el rol lector, una escritura falla y no deja nada', async () => {
    await expect(lector.query(ESCRITURA)).rejects.toMatchObject({ code: expect.stringMatching(/^(25006|42501)$/) });
    await expect(lector.query('TRUNCATE desk.tickets')).rejects.toMatchObject({ code: expect.stringMatching(/^(25006|42501)$/) });
    expect(await cuantos()).toBe(0);
  });

  it('y aunque la URL fuese de un rol que SÍ puede escribir, el pool lo impide: fija la transacción de sólo lectura al conectar', async () => {
    const conPermisos = crearPoolDesk2(urls.urlAdmin);
    try {
      expect((await conPermisos.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only).toBe('on');
      // 25006 = read_only_sql_transaction
      await expect(conPermisos.query(ESCRITURA)).rejects.toMatchObject({ code: '25006' });
      await expect(conPermisos.query('CREATE TABLE public.no_debe_existir (x int)')).rejects.toMatchObject({ code: '25006' });
      expect(await cuantos()).toBe(0);
    } finally {
      await conPermisos.end();
    }
  });

  it('el rol lector no ve más tablas que las suyas', async () => {
    await admin2.query('CREATE TABLE IF NOT EXISTS public.ajena_prueba (x int)');
    await expect(lector.query('SELECT * FROM public.ajena_prueba')).rejects.toMatchObject({ code: '42501' });
  });

  it('si al rol le falta el permiso de UNA tabla, tickets y estado caen juntos al respaldo: el estado no dice «principal» con tickets de la réplica', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sembrarDesk2();
    await admin2.query('REVOKE SELECT ON desk.ticket_transitions FROM agenda_lector_prueba');
    try {
      const fuente = fuenteCon(lector);
      expect(await fuente.ticketsAbiertos()).toEqual([]); // la réplica está vacía en este test
      expect(await fuente.estadoFuente()).toMatchObject({ fuente: 'respaldo', motivo: 'error_consulta', ultimoFalloPrincipal: { motivo: 'error_consulta' } });
    } finally {
      await admin2.query('GRANT SELECT ON desk.ticket_transitions TO agenda_lector_prueba');
      warn.mockRestore();
    }
    expect(await fuenteCon(lector).estadoFuente()).toMatchObject({ fuente: 'principal', motivo: null });
  });

  it('el tope de tiempo corta una consulta lenta, y eso se clasifica como «timeout»', async () => {
    const impaciente = crearPoolDesk2(urls.urlLector, { consultaMs: 200 });
    try {
      const fallo = await impaciente.query('SELECT pg_sleep(3)').then(
        () => null,
        (e: unknown) => e,
      );
      expect(fallo).toMatchObject({ code: '57014' });
      expect(clasificarFallo(fallo)).toBe('timeout');
    } finally {
      await impaciente.end();
    }
  });
});

describe('respaldo: la réplica del portal', () => {
  async function sembrarReplica(): Promise<void> {
    await hub.query(`
      INSERT INTO desk.tickets (number, subject, status, status_type, serial, codigo_servicio, tipo_servicio, created_time, fecha_creacion_ticket, synced_at) VALUES
        (884, ' Equipo Nuevo - Cliente Uno ', 'Ingresado', 'Open', '18A00001', 'HV_18A00001_EDM180C', ' Calibración ', '2026-08-03T15:00:00Z', NULL, '2026-10-06T09:00:00Z'),
        (990, 'Asunto ficticio', 'En Proceso', 'On Hold', NULL, '  ', NULL, '2026-09-01T15:00:00Z', '2026-09-02', '2026-10-06T10:00:00Z'),
        (700, 'Asunto ficticio', 'Finalizado', 'Closed', NULL, NULL, NULL, '2026-07-01T15:00:00Z', NULL, '2026-10-06T11:00:00Z')`);
  }
  // El asunto y el código de servicio sólo se leen de la réplica: con ellos se deduce el flujo en respaldo (D11).
  const DE_REPLICA: TicketTaller[] = [
    { numero: 884, estado: 'Ingresado', tipoEstado: 'Open', clasificacion: null, tipoServicio: 'Calibración', remisionEntrada: null, fechaCreacion: '2026-08-03', prioridad: null, llegadaEstado: null, asunto: 'Equipo Nuevo - Cliente Uno', codigoServicio: 'HV_18A00001_EDM180C', fuente: 'respaldo' },
    { numero: 990, estado: 'En Proceso', tipoEstado: 'On Hold', clasificacion: null, tipoServicio: null, remisionEntrada: null, fechaCreacion: '2026-09-02', prioridad: null, llegadaEstado: null, asunto: 'Asunto ficticio', codigoServicio: null, fuente: 'respaldo' },
  ];

  it('sin DESK2_DB_URL: mismos campos, con null en lo que la réplica no tiene, y cierres vacíos', async () => {
    await sembrarReplica();
    const fuente = fuenteCon(null, Date.UTC(2026, 9, 6, 11, 30, 0));
    expect(await fuente.ticketsAbiertos()).toEqual(DE_REPLICA);
    expect(await fuente.cierresEmpresa('2026-01-01', '2027-12-31')).toEqual([]);
    expect(await fuente.estadoFuente()).toMatchObject({ fuente: 'respaldo', motivo: 'sin_variable', ultimaSincronizacion: '2026-10-06T11:00:00.000Z', sincronizacionParada: false, ultimoFalloPrincipal: null });
  });

  it('si la réplica trae la clasificación y la fecha de remisión, se leen (D12); si no, no es un error', async () => {
    await sembrarReplica();
    await hub.query('ALTER TABLE desk.tickets ADD COLUMN classification text, ADD COLUMN fecha_remision_entrada date');
    try {
      await hub.query(`UPDATE desk.tickets SET classification = 'Equipo Nuevo', fecha_remision_entrada = '2026-08-04' WHERE number = 884`);
      const [t884, t990] = await fuenteCon(null).ticketsAbiertos();
      expect(t884).toMatchObject({ numero: 884, clasificacion: 'Equipo Nuevo', remisionEntrada: '2026-08-04', prioridad: null, llegadaEstado: null });
      expect(t990).toMatchObject({ numero: 990, clasificacion: null, remisionEntrada: null });
    } finally {
      // La tabla es de toda la suite: se deja como la crea asegurarDeskTickets.
      await hub.query('ALTER TABLE desk.tickets DROP COLUMN classification, DROP COLUMN fecha_remision_entrada');
    }
  });

  const CAIDAS = [
    { nombre: 'nadie escucha en ese puerto', pool: () => crearPoolDesk2('postgres://nadie:nada@127.0.0.1:1/desk', { conexionMs: 2_000 }), motivos: ['error_conexion', 'timeout'] },
    { nombre: 'la contraseña no vale', pool: () => crearPoolDesk2(conClave(urls.urlLector, 'otra-clave')), motivos: ['error_conexion'] },
    { nombre: 'la base no tiene las tablas de Desk 2.0', pool: () => crearPoolDesk2(hubComoDesk2()), motivos: ['error_consulta'] },
    { nombre: 'la variable no es una URL de Postgres', pool: () => crearPoolDesk2('esto no es una url', { conexionMs: 2_000 }), motivos: ['error_conexion', 'timeout'] },
  ];
  const conClave = (url: string, clave: string) => Object.assign(new URL(url), { password: clave }).toString();
  // La base del portal vista como si fuera Desk 2.0: su desk.tickets no tiene `id` ni las tablas de la app.
  const hubComoDesk2 = () => Object.assign(new URL(urls.urlAdmin), { pathname: new URL((hub as unknown as { options: { connectionString: string } }).options.connectionString).pathname }).toString();

  it.each(CAIDAS)('$nombre → se sirve la réplica en esa llamada, con su motivo, sin excepción y sin escribir el error crudo', async ({ pool, motivos }) => {
    await sembrarReplica();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const roto = pool();
    try {
      const fuente = fuenteCon(roto);
      expect(await fuente.ticketsAbiertos()).toEqual(DE_REPLICA);
      expect(await fuente.cierresEmpresa('2026-01-01', '2027-12-31')).toEqual([]);
      const estado = await fuente.estadoFuente();
      expect(estado.fuente).toBe('respaldo');
      expect(motivos).toContain(estado.motivo);
      expect(estado.ultimaSincronizacion).toBe('2026-10-06T11:00:00.000Z');
      const visto = JSON.stringify([estado, warn.mock.calls, error.mock.calls]);
      for (const secreto of ['127.0.0.1', 'nadie', 'otra-clave', 'agenda_lector_prueba', 'postgres://', 'esto no es una url']) expect(visto).not.toContain(secreto);
    } finally {
      warn.mockRestore();
      error.mockRestore();
      await roto.end().catch(() => {});
    }
  });
});
