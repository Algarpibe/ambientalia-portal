import { describe, expect, it } from 'vitest';
import { fuenteDesk2, motivoDesk2, SinDesk2 } from './fuente-desk2.js';
import { Reglas } from './nucleo/index.js';
import type { DbLectura } from '../trazabilidad/fuente.js';

// La fuente de Desk 2.0 con una base FALSA: qué SQL lanza, cómo traduce las filas a la
// forma de la API de Zoho que espera el núcleo y que un fallo sube sin respaldo. El SQL
// contra Postgres de verdad: fuente-desk2.db.test.ts. Todo ficticio.
function baseFalsa(responder: (sql: string, p: unknown[]) => Record<string, unknown>[]) {
  const consultas: { sql: string; p: unknown[] }[] = [];
  const db: DbLectura = { query: async (sql, p = []) => { consultas.push({ sql, p }); return { rows: responder(sql, p) }; } };
  return { db, consultas };
}
const FILA = {
  id: '900000000000000001',
  number: 1401,
  serial: '18A90417',
  tipo_servicio: 'Calibración',
  fecha_remision_entrada: '2026-10-30',
  subject: 'Servicio técnico Cliente Ficticio EDM180C 18A90417',
  status: 'Rev./Diagnostico',
  status_type: 'Open',
  created_time: new Date('2026-10-30T14:00:00.000Z'),
  raw: {
    webUrl: 'https://desk.example/agent/x/dv/900000000000000001',
    modifiedTime: '2026-11-02T10:00:00.000Z',
    closedTime: null,
    cf: { cf_serial: '18A90417', cf_fecha_remision_de_salida: '2026-11-05', cf_encargado: 'Técnico Uno', cf_equipo_1: 'EDM180C' },
  },
};

describe('tickets(serial)', () => {
  it('trae los cf_* de raw y el número, estado y asunto de las columnas, con la forma de Zoho', async () => {
    const { db, consultas } = baseFalsa(() => [FILA]);
    const [t] = await fuenteDesk2(() => db).tickets('18A90417');
    expect(consultas[0].sql).toMatch(/FROM desk\.tickets t/);
    expect(consultas[0].sql).toMatch(/LIMIT 10/);
    expect(consultas[0].p).toEqual(['18A90417']);
    expect(t).toMatchObject({ ticketNumber: '1401', status: 'Rev./Diagnostico', statusType: 'Open', createdTime: '2026-10-30T14:00:00.000Z', modifiedTime: '2026-11-02T10:00:00.000Z' });
    const z = Reglas.tnorm(t);
    expect([z.n, z.id, z.fs, z.enc, z.eq, z.fe]).toEqual(['1401', '900000000000000001', '2026-11-05', 'Técnico Uno', 'EDM180C', '2026-10-30']);
    expect(z.tk).toContain(Reglas.cls('18A90417'));
  });

  it('un ticket sin raw.cf (no releído al detalle) se completa con las columnas promovidas', async () => {
    const { db } = baseFalsa(() => [{ ...FILA, raw: { webUrl: '' } }]);
    const z = Reglas.tnorm((await fuenteDesk2(() => db).tickets('18A90417'))[0]);
    expect([z.fe, z.srv, z.tk.includes(Reglas.cls('18A90417'))]).toEqual(['2026-10-30', 'Calibración', true]);
  });

  it('escapa los comodines de ILIKE y no consulta con un serial vacío', async () => {
    const { db, consultas } = baseFalsa(() => []);
    const f = fuenteDesk2(() => db);
    await f.tickets('18A_9%');
    expect(consultas[0].p).toEqual(['18A\\_9\\%']);
    expect(await f.tickets('  ')).toEqual([]);
    expect(consultas).toHaveLength(1);
  });
});

describe('ticketNumero', () => {
  it('busca por número exacto y rechaza lo que no es un número', async () => {
    const { db, consultas } = baseFalsa(() => [FILA]);
    const f = fuenteDesk2(() => db);
    expect((await f.ticketNumero('1401'))[0].ticketNumber).toBe('1401');
    expect(consultas[0].p).toEqual(['1401']);
    expect(await f.ticketNumero('14; DROP')).toEqual([]);
    expect(consultas).toHaveLength(1);
  });
});

describe('comentarios', () => {
  it('lee los comentarios de la fila del ticket (aunque el núcleo lo nombre por el id de su URL) con la forma de Zoho', async () => {
    const { db, consultas } = baseFalsa((sql) =>
      sql.includes('desk.conversations')
        ? [{ ticket_id: 'fila-7', kind: 'comment', content: '<p>Equipo recogido por el cliente</p>', commented_time: new Date('2026-11-06T15:00:00.000Z'), raw: { attachments: [{ name: '261106 - CLIENTE.pdf' }, { otro: 1 }] } }]
        : [{ ...FILA, id: 'fila-7', raw: { ...FILA.raw, webUrl: 'https://desk.example/agent/x/dv/555' } }],
    );
    const f = fuenteDesk2(() => db);
    const z = Reglas.tnorm((await f.tickets('18A90417'))[0]);
    expect(z.id).toBe('555');
    const c = await f.comentarios(z.id);
    expect(consultas[1].sql).toMatch(/c\.kind = 'comment'/);
    expect(consultas[1].sql).toMatch(/LIMIT 15/);
    expect(consultas[1].p).toEqual(['fila-7']);
    expect(c).toEqual([{ commentedTime: '2026-11-06T15:00:00.000Z', content: '<p>Equipo recogido por el cliente</p>', attachments: [{ name: '261106 - CLIENTE.pdf' }] }]);
    expect(Reglas.cmtList(c)).toHaveLength(1);
  });
});

describe('sonda y fallos', () => {
  it('la sonda nombra tickets y comentarios y cuenta los tickets con raw.cf', async () => {
    const { db, consultas } = baseFalsa(() => [{ total: 12, con_cf: 9 }]);
    expect(await fuenteDesk2(() => db).sonda()).toEqual({ total: 12, conCf: 9 });
    expect(consultas[0].sql).toMatch(/desk\.conversations c WHERE false/);
    expect(consultas[0].sql).toMatch(/desk\.tickets t WHERE false/);
  });

  it('sin DESK2_DB_URL lanza SinDesk2 («sin configurar»)', async () => {
    await expect(fuenteDesk2(() => null).sonda()).rejects.toBeInstanceOf(SinDesk2);
    expect(motivoDesk2(new SinDesk2())).toBe('sin configurar');
  });

  it('un error de la base sube tal cual, sin respaldo, y su motivo no lleva el mensaje de pg', async () => {
    const e = Object.assign(new Error('permission denied for table conversations (host secreto.internal)'), { code: '42501' });
    const db: DbLectura = { query: async () => { throw e; } };
    await expect(fuenteDesk2(() => db).tickets('18A90417')).rejects.toBe(e);
    expect(motivoDesk2(e)).toBe('consulta rechazada (permisos o esquema)');
    expect(motivoDesk2(Object.assign(new Error('x'), { code: '57014' }))).toBe('tiempo agotado');
    expect(motivoDesk2(Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' }))).toBe('sin conexión');
  });
});
