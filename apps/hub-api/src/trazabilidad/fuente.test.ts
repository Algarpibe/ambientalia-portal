import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UMBRAL_SINCRONIZACION_PARADA_MS, clasificarFallo, crearFuenteAgenda, normalizarTicket, recuentoPorEstado, type DbLectura, type TicketTaller } from './fuente.js';

// La fuente de la agenda con bases de mentira: la normalización de las dos
// fuentes y la caída al respaldo (sin variable, error, timeout). El SQL de
// verdad lo cubre fuente.db.test.ts. Datos ficticios: el repo es público.

type Fila = Record<string, unknown>;

/** Una base que responde según el texto de la consulta y apunta lo que le piden. */
function baseFalsa(responder: (sql: string, params: unknown[]) => Fila[]) {
  const consultas: { sql: string; params: unknown[] }[] = [];
  const db: DbLectura = {
    query: async (sql: string, params: unknown[] = []) => {
      consultas.push({ sql, params });
      return { rows: responder(sql, params) };
    },
  };
  return { db, consultas };
}

/** Una base que falla siempre con ese error. */
function baseRota(error: unknown) {
  let veces = 0;
  const db: DbLectura = {
    query: async () => {
      veces++;
      throw error;
    },
  };
  return { db, veces: () => veces };
}

const errorPg = (code: string, message = 'fallo') => Object.assign(new Error(message), { code });

const FILA_DESK2: Fila = {
  numero: 10005,
  estado: 'Rev./Diagnostico',
  tipo_estado: 'Open',
  clasificacion: ' Equipo Para Servicio ',
  tipo_servicio: 'Diagnostico',
  remision_entrada: '2026-09-29',
  fecha_creacion: '2026-09-28',
  prioridad: 'High',
  llegada_ms: '1790000000000',
};
const FILA_REPLICA: Fila = { numero: '884', estado: 'Ingresado', tipo_estado: 'Open', clasificacion: null, tipo_servicio: '', remision_entrada: null, fecha_creacion: '2026-08-03', prioridad: null, llegada_ms: null };

const SINC_DESK2 = Date.UTC(2026, 9, 6, 12, 0, 0);
const SINC_REPLICA = Date.UTC(2026, 9, 6, 9, 0, 0);

const desk2Sana = () =>
  baseFalsa((sql) => {
    if (sql.includes('calendario_cierres')) return [{ fecha: '2026-12-24' }, { fecha: '2026-12-31' }];
    if (sql.includes('max(synced_at)')) return [{ ms: SINC_DESK2 }];
    return [FILA_DESK2];
  });
const replicaSana = () => baseFalsa((sql) => (sql.includes('max(synced_at)') ? [{ ms: SINC_REPLICA }] : [FILA_REPLICA]));

afterEach(() => vi.restoreAllMocks());

describe('normalizarTicket', () => {
  it('una fila de Desk 2.0: mismos campos, textos sin espacios de más y la llegada en milisegundos', () => {
    expect(normalizarTicket(FILA_DESK2, 'principal')).toEqual<TicketTaller>({
      numero: 10005,
      estado: 'Rev./Diagnostico',
      tipoEstado: 'Open',
      clasificacion: 'Equipo Para Servicio',
      tipoServicio: 'Diagnostico',
      remisionEntrada: '2026-09-29',
      fechaCreacion: '2026-09-28',
      prioridad: 'High',
      llegadaEstado: 1790000000000,
      fuente: 'principal',
    });
  });

  it('una fila de la réplica: el mismo tipo, con null en lo que la réplica no tiene', () => {
    expect(normalizarTicket(FILA_REPLICA, 'respaldo')).toEqual<TicketTaller>({
      numero: 884,
      estado: 'Ingresado',
      tipoEstado: 'Open',
      clasificacion: null,
      tipoServicio: null,
      remisionEntrada: null,
      fechaCreacion: '2026-08-03',
      prioridad: null,
      llegadaEstado: null,
      fuente: 'respaldo',
    });
  });

  it('las dos fuentes dan exactamente las mismas claves, y ninguna es una marca «sin confirmar» (D13)', () => {
    const a = Object.keys(normalizarTicket(FILA_DESK2, 'principal')).sort();
    const b = Object.keys(normalizarTicket(FILA_REPLICA, 'respaldo')).sort();
    expect(a).toEqual(b);
    expect(a.join(' ')).not.toMatch(/confirm/i);
  });

  it('el estado se deja como lo escribe Desk: quien lo use lo casa por su clave', () => {
    expect(normalizarTicket({ ...FILA_DESK2, estado: 'Notificación  Comercial' }, 'principal').estado).toBe('Notificación  Comercial');
  });
});

describe('sin DESK2_DB_URL', () => {
  it('lee la réplica, lo dice y no hay error', async () => {
    const replica = replicaSana();
    const fuente = crearFuenteAgenda({ hub: replica.db, desk2: () => null, ahora: () => SINC_REPLICA + 60_000 });
    const tickets = await fuente.ticketsAbiertos();
    expect(tickets.map((t) => [t.numero, t.fuente])).toEqual([[884, 'respaldo']]);
    expect(await fuente.estadoFuente()).toEqual({
      fuente: 'respaldo',
      motivo: 'sin_variable',
      mensaje: expect.stringContaining('DESK2_DB_URL'),
      ultimaSincronizacion: new Date(SINC_REPLICA).toISOString(),
      sincronizacionParada: false,
      umbralSincronizacionMs: UMBRAL_SINCRONIZACION_PARADA_MS,
      ultimoFalloPrincipal: null,
    });
  });

  it('los cierres de empresa van vacíos, sin consultar nada', async () => {
    const replica = replicaSana();
    const fuente = crearFuenteAgenda({ hub: replica.db, desk2: () => null });
    expect(await fuente.cierresEmpresa('2026-10-01', '2026-12-31')).toEqual([]);
    expect(replica.consultas).toEqual([]);
  });
});

describe('con la principal sana', () => {
  it('los tickets salen de Desk 2.0 y la réplica ni se toca', async () => {
    const desk2 = desk2Sana();
    const replica = replicaSana();
    const fuente = crearFuenteAgenda({ hub: replica.db, desk2: () => desk2.db, ahora: () => SINC_DESK2 + 45_000 });
    expect((await fuente.ticketsAbiertos()).map((t) => [t.numero, t.fuente])).toEqual([[10005, 'principal']]);
    expect(await fuente.estadoFuente()).toMatchObject({ fuente: 'principal', motivo: null, mensaje: null, ultimaSincronizacion: new Date(SINC_DESK2).toISOString(), sincronizacionParada: false, ultimoFalloPrincipal: null });
    expect(replica.consultas).toEqual([]);
  });

  it('cierresEmpresa pide el tramo con parámetros y devuelve las fechas', async () => {
    const desk2 = desk2Sana();
    const fuente = crearFuenteAgenda({ hub: replicaSana().db, desk2: () => desk2.db });
    expect(await fuente.cierresEmpresa('2026-12-01', '2026-12-31')).toEqual(['2026-12-24', '2026-12-31']);
    expect(desk2.consultas).toHaveLength(1);
    expect(desk2.consultas[0].params).toEqual(['2026-12-01', '2026-12-31']);
    expect(desk2.consultas[0].sql).not.toContain('2026-12-01');
  });
});

describe('caída al respaldo', () => {
  const CASOS = [
    { nombre: 'conexión rechazada', error: errorPg('ECONNREFUSED'), motivo: 'error_conexion' },
    { nombre: 'contraseña mal', error: errorPg('28P01'), motivo: 'error_conexion' },
    { nombre: 'la consulta caduca (statement_timeout)', error: errorPg('57014'), motivo: 'timeout' },
    { nombre: 'la conexión no llega a tiempo', error: new Error('timeout exceeded when trying to connect'), motivo: 'timeout' },
    { nombre: 'al rol le falta un permiso', error: errorPg('42501'), motivo: 'error_consulta' },
  ] as const;

  it.each(CASOS)('$nombre → réplica en esa llamada, motivo «$motivo», sin excepción y sin reintento', async ({ error, motivo }) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const desk2 = baseRota(error);
    const replica = replicaSana();
    const fuente = crearFuenteAgenda({ hub: replica.db, desk2: () => desk2.db, ahora: () => SINC_REPLICA + 1_000 });

    const tickets = await fuente.ticketsAbiertos();
    expect(tickets.map((t) => [t.numero, t.fuente])).toEqual([[884, 'respaldo']]);
    expect(desk2.veces()).toBe(1);

    const estado = await fuente.estadoFuente();
    expect(desk2.veces()).toBe(2); // una vez por llamada, no en bucle
    expect(estado).toMatchObject({ fuente: 'respaldo', motivo, ultimaSincronizacion: new Date(SINC_REPLICA).toISOString() });
    expect(estado.mensaje).toBeTruthy();
    expect(estado.ultimoFalloPrincipal?.motivo).toBe(motivo);

    expect(await fuente.cierresEmpresa('2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('cuando la principal vuelve se usa otra vez, y queda dicho cuál fue su último fallo', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let rota = true;
    const sana = desk2Sana();
    const desk2: DbLectura = { query: async (sql, params) => (rota ? Promise.reject(errorPg('ECONNREFUSED')) : sana.db.query(sql, params)) };
    const fuente = crearFuenteAgenda({ hub: replicaSana().db, desk2: () => desk2, ahora: () => SINC_DESK2 + 5_000 });

    expect((await fuente.ticketsAbiertos())[0].fuente).toBe('respaldo');
    rota = false;
    expect((await fuente.ticketsAbiertos())[0].fuente).toBe('principal');
    const estado = await fuente.estadoFuente();
    expect(estado).toMatchObject({ fuente: 'principal', motivo: null });
    expect(estado.ultimoFalloPrincipal).toEqual({ motivo: 'error_conexion', en: new Date(SINC_DESK2 + 5_000).toISOString() });
  });

  it('ni el aviso del registro ni el estado arrastran el mensaje crudo del error (host, usuario, URL)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const crudo = 'connect ECONNREFUSED desk-ficticio.invalid:5432 postgres://lector_ficticio:clave-ficticia@desk-ficticio.invalid:5432/desk';
    const fuente = crearFuenteAgenda({ hub: replicaSana().db, desk2: () => baseRota(errorPg('ECONNREFUSED', crudo)).db });
    await fuente.ticketsAbiertos();
    const visto = JSON.stringify([warn.mock.calls, await fuente.estadoFuente()]);
    expect(warn).toHaveBeenCalled();
    for (const secreto of ['desk-ficticio', 'lector_ficticio', 'clave-ficticia', 'postgres://']) expect(visto).not.toContain(secreto);
  });

  it('el aviso del registro no se repite mientras el motivo sea el mismo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fuente = crearFuenteAgenda({ hub: replicaSana().db, desk2: () => baseRota(errorPg('ECONNREFUSED')).db });
    await fuente.ticketsAbiertos();
    await fuente.ticketsAbiertos();
    await fuente.estadoFuente();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('si también falla la réplica, eso sí es un error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fuente = crearFuenteAgenda({ hub: baseRota(new Error('hub caído')).db, desk2: () => baseRota(errorPg('ECONNREFUSED')).db });
    await expect(fuente.ticketsAbiertos()).rejects.toThrow('hub caído');
  });
});

describe('sincronización parada (D13)', () => {
  const estadoA = (ms: number | null, ahora: number) =>
    crearFuenteAgenda({ hub: baseFalsa(() => [{ ms }]).db, desk2: () => null, ahora: () => ahora }).estadoFuente();

  it('el umbral es una hora', () => {
    expect(UMBRAL_SINCRONIZACION_PARADA_MS).toBe(60 * 60 * 1000);
  });

  it('justo en el umbral todavía no; un milisegundo después, sí', async () => {
    expect((await estadoA(SINC_REPLICA, SINC_REPLICA + UMBRAL_SINCRONIZACION_PARADA_MS)).sincronizacionParada).toBe(false);
    expect((await estadoA(SINC_REPLICA, SINC_REPLICA + UMBRAL_SINCRONIZACION_PARADA_MS + 1)).sincronizacionParada).toBe(true);
  });

  it('una base que nunca se ha sincronizado cuenta como parada', async () => {
    expect(await estadoA(null, SINC_REPLICA)).toMatchObject({ ultimaSincronizacion: null, sincronizacionParada: true });
  });
});

describe('clasificarFallo', () => {
  it.each([
    [errorPg('57014'), 'timeout'],
    [errorPg('ETIMEDOUT'), 'timeout'],
    [new Error('Connection terminated due to connection timeout'), 'timeout'],
    [errorPg('ENOTFOUND'), 'error_conexion'],
    [errorPg('3D000'), 'error_conexion'],
    [errorPg('08006'), 'error_conexion'],
    [errorPg('ERR_INVALID_URL'), 'error_conexion'],
    [errorPg('EPIPE'), 'error_conexion'],
    [errorPg('42P01'), 'error_consulta'],
    [errorPg('42703'), 'error_consulta'],
    ['un texto suelto', 'error_conexion'],
    [null, 'error_conexion'],
  ] as const)('%o → %s', (error, motivo) => {
    expect(clasificarFallo(error)).toBe(motivo);
  });
});

describe('recuentoPorEstado', () => {
  it('cuenta por estado normalizado, de más a menos tickets y después alfabético', () => {
    const t = (numero: number, estado: string) => normalizarTicket({ ...FILA_REPLICA, numero, estado }, 'respaldo');
    expect(recuentoPorEstado([t(1, 'Ingresado'), t(2, 'En Proceso'), t(3, 'Notificación  Comercial'), t(4, 'notificacion comercial'), t(5, 'En Proceso'), t(6, 'Notificación Comercial')])).toEqual([
      { estado: 'Notificación Comercial', tickets: 3 },
      { estado: 'En Proceso', tickets: 2 },
      { estado: 'Ingresado', tickets: 1 },
    ]);
  });
});

describe('guardas', () => {
  const FICHEROS = ['./fuente.ts', './fuente-desk2.ts', './fuente-replica.ts', '../db-desk2.ts'];
  const leer = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

  it('la fuente sólo lee: ninguna sentencia de escritura, ni contra Desk 2.0 ni contra la réplica', () => {
    for (const f of FICHEROS) expect(leer(f), f).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s)/i);
  });

  it('no hay marca «sin confirmar» por ticket (D13) ni llamadas a la red', () => {
    for (const f of FICHEROS) {
      expect(leer(f), f).not.toMatch(/sin_?confirmar/i);
      expect(leer(f), f).not.toMatch(/\bfetch\s*\(|n8n|webhook|nodemailer|smtp|sendMail|outbox/i);
    }
  });
});
