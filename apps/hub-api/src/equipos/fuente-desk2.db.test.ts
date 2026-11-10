import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { asegurarDesk2, poolDePrueba } from '../test-db/harness.js';
import { crearPoolDesk2 } from '../db-desk2.js';
import { fuenteDesk2, motivoDesk2 } from './fuente-desk2.js';
import { Reglas } from './nucleo/index.js';

// El SQL de la fuente de Desk 2.0 contra una imitación de su base (harness.asegurarDesk2),
// leída con un rol de solo lectura como portal_agenda_reader. Todo ficticio.
let hub: Pool;
let admin: Pool;
let lector: Pool;
/** El rol de solo lectura de la imitación (el `portal_agenda_reader` de producción). */
let rolLector: string;

beforeAll(async () => {
  hub = poolDePrueba();
  const urls = await asegurarDesk2(hub);
  admin = createPoolFromUrl(urls.urlAdmin);
  lector = crearPoolDesk2(urls.urlLector);
  rolLector = new URL(urls.urlLector).username;
});
afterAll(async () => {
  await lector.end();
  await admin.end();
  await hub.end();
});
beforeEach(async () => {
  await admin.query('TRUNCATE desk.tickets, desk.conversations');
  await admin.query(
    `INSERT INTO desk.tickets (id, number, status, status_type, created_time, tipo_servicio, fecha_remision_entrada, subject, serial, raw) VALUES
       ('900000000000000001', 1401, 'Rev./Diagnostico', 'Open', '2026-10-30T14:00:00Z', 'Calibración', '2026-10-30',
        'Servicio técnico Cliente Ficticio EDM180C', '18A90417',
        '{"webUrl":"https://desk.example/agent/x/dv/900000000000000001","modifiedTime":"2026-11-02T10:00:00Z","cf":{"cf_serial":"18A90417","cf_fecha_remision_de_salida":"2026-11-05"}}'),
       ('app-5c1d', 1402, 'En taller', 'Open', '2026-11-03T09:00:00Z', 'Mantenimiento', NULL,
        'Equipo 18A90999 de otro cliente ficticio', '18A90999', NULL)`,
  );
  await admin.query(
    `INSERT INTO desk.conversations (ticket_id, kind, author_name, author_type, is_public, content, content_type, commented_time, raw) VALUES
       ('900000000000000001', 'comment', 'Técnico Uno', 'AGENT', false, 'Equipo recogido por el cliente', 'plainText', '2026-11-06T15:00:00Z', '{"attachments":[{"name":"261106 - CLIENTE.pdf"}]}'),
       ('900000000000000001', 'thread', 'Cliente', 'END_USER', true, 'Hola, ¿ya está?', 'plainText', '2026-11-05T15:00:00Z', NULL)`,
  );
});

describe('fuenteDesk2 contra Postgres', () => {
  it('la sonda pasa con el rol lector y cuenta los tickets con raw.cf', async () => {
    expect(await fuenteDesk2(() => lector).sonda()).toEqual({ total: 2, conCf: 1 });
  });

  it('busca por el serial en las columnas y en raw.cf, del más reciente al más antiguo', async () => {
    const f = fuenteDesk2(() => lector);
    const [t] = await f.tickets('18A90417');
    const z = Reglas.tnorm(t);
    expect([z.n, z.st, z.fs, z.fe]).toEqual(['1401', 'Rev./Diagnostico', '2026-11-05', '2026-10-30']);
    const [app] = await f.tickets('18A90999');
    expect(Reglas.tnorm(app)).toMatchObject({ n: '1402', id: 'app-5c1d', srv: 'Mantenimiento' });
    expect(await f.tickets('18A00000')).toEqual([]);
  });

  it('el número exacto y los comentarios (solo los «comment»)', async () => {
    const f = fuenteDesk2(() => lector);
    const z = Reglas.tnorm((await f.ticketNumero('1401'))[0]);
    const c = await f.comentarios(z.id);
    expect(c).toEqual([{ commentedTime: '2026-11-06T15:00:00.000Z', content: 'Equipo recogido por el cliente', attachments: [{ name: '261106 - CLIENTE.pdf' }] }]);
  });

  it('sin el permiso sobre desk.conversations la sonda falla, con un motivo sin el mensaje de pg', async () => {
    await admin.query(`REVOKE SELECT ON desk.conversations FROM ${rolLector}`);
    try {
      const e = await fuenteDesk2(() => lector).sonda().catch((x) => x);
      expect(e.code).toBe('42501');
      expect(motivoDesk2(e)).toBe('consulta rechazada (permisos o esquema)');
    } finally {
      await admin.query(`GRANT SELECT ON desk.conversations TO ${rolLector}`);
    }
  });
});
