import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { computarPendiente, confirmarEnvio } from './email.js';
import type { PoolClient } from './email.repo.js';
import { DEFAULT_CONFIG } from './config.js';
import type { EmailPendiente, SalesOrder } from './types.js';
import type { SalesOrderSource, SalesOrderFiltro } from './source.js';
import { poolDePrueba } from '../test-db/harness.js';

// El correo automático de WO-sales contra Postgres de verdad (DATA-339).
//
// /wo-sales/email/pendiente decidía a quién mandar el xlsx leyendo
// wo_sales_email_sent, pero no marcaba nada hasta /confirmado. Dos disparadores de
// n8n solapados veían a los mismos destinatarios pendientes y el archivo salía dos
// veces: el mismo fallo que la 019 y DATA-338 cerraron en el outbox de ausencias.
//
// El doble en memoria de email.test.ts no ejecuta SQL ni concurrencia, así que no
// puede ver esta carrera: hace falta el motor real.

let db: Pool;

const APP_ID = 'WO-sales';
const DOMINIO = '@wo-sales.test';
const filtro: SalesOrderFiltro = { desde: '2026-01-01', hasta: '2026-12-31' };

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  // portal.users es compartida con otros ficheros: se borran solo los usuarios de
  // este (por dominio) y las asignaciones de la app, no la tabla entera.
  await db.query('DELETE FROM portal.user_apps WHERE app_id = $1', [APP_ID]);
  await db.query('DELETE FROM portal.users WHERE email LIKE $1', [`%${DOMINIO}`]);
  await db.query(
    `TRUNCATE portal.wo_sales_email_sent, portal.wo_sales_email_frecuencia,
              portal.wo_sales_email_estado, portal.wo_sales_email_reserva`,
  );
});

/** Una OV mínima válida; `cantidad` cambia el contenido del archivo y, con él, el hash. */
function ov(cantidad = 2): SalesOrder {
  return {
    numero: 'OV-1',
    fecha: '2026-07-14',
    clienteNombre: 'ACME',
    nit: '900123',
    formaPagoZoho: '100% Anticipado',
    fechaEntrega: '2026-07-20',
    plazoPago: 30,
    moneda: 'COP',
    descuentoCabecera: 0,
    cantidadFacturada: 0,
    lineas: [
      { sku: 'S1', descripcion: 'x', cantidad, valorUnitario: 100, descuento: 0, centroCostos: '330801 X', centrosCostosCount: 1 },
    ],
  };
}

/** La réplica de Zoho no existe en el contenedor: la fuente se dobla con OV fijas. */
function fuente(cantidad = 2): SalesOrderSource {
  return {
    ordenesVivas: async () => [ov(cantidad)],
    ordenesAntiguas: async () => [],
  } as unknown as SalesOrderSource;
}

/** Un usuario del portal activo con la app asignada: eso lo hace destinatario. */
async function sembrarDestinatario(local: string): Promise<string> {
  const email = `${local}${DOMINIO}`;
  const { rows } = await db.query(
    `INSERT INTO portal.users (full_name, email, password_hash, role, status)
     VALUES ($1, $2, 'x', 'reader', 'active') RETURNING id`,
    [`Persona Ficticia ${local}`, email],
  );
  await db.query('INSERT INTO portal.user_apps (user_id, app_id) VALUES ($1, $2)', [
    (rows[0] as { id: string }).id,
    APP_ID,
  ]);
  return email;
}

const pendiente = (cantidad = 2, ahora?: Date) =>
  computarPendiente(db, fuente(cantidad), DEFAULT_CONFIG, filtro, 'a.xls', ahora);

const emailsDe = (r: EmailPendiente) => (r.enviar ? r.destinatarios.map((d) => d.email) : []);

/** Empuja la reserva al pasado, más allá de los cinco minutos. */
async function vencerReserva(email: string): Promise<void> {
  await db.query(
    "UPDATE portal.wo_sales_email_reserva SET reservado_at = now() - interval '6 minutes' WHERE email = $1",
    [email],
  );
}

async function reservas(): Promise<{ email: string; hash: string }[]> {
  const { rows } = await db.query('SELECT email, hash FROM portal.wo_sales_email_reserva ORDER BY email');
  return rows as { email: string; hash: string }[];
}

describe('computarPendiente: dos disparadores a la vez (DATA-339)', () => {
  it('CANDADO: con peticiones solapadas, el destinatario se sirve una sola vez', async () => {
    // Es el incidente: dos /pendiente casi simultáneos. Antes los dos leían el
    // mismo estado sin marcar nada y los dos devolvían al destinatario.
    //
    // Determinista y no a merced del reloj: abrir una conexión nueva tarda más que
    // toda la transacción, así que sin ayuda las peticiones casi nunca se solapan y
    // el test pasaría aunque faltara el candado (comprobado quitándolo). Por eso se
    // precalientan las conexiones del pool y un trigger alarga 300 ms la escritura de
    // la reserva: es la ventana entre «leí que estaba libre» y «lo reservé» en la que
    // las demás peticiones, sin candado, leen lo mismo.
    const email = await sembrarDestinatario('ana');
    const calientes = await Promise.all([db.connect(), db.connect(), db.connect(), db.connect()]);
    calientes.forEach((c: PoolClient) => c.release());
    await db.query(`
      CREATE OR REPLACE FUNCTION portal.wo_sales_test_lenta() RETURNS trigger AS $$
      BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER wo_sales_test_lenta BEFORE INSERT ON portal.wo_sales_email_reserva
        FOR EACH ROW EXECUTE FUNCTION portal.wo_sales_test_lenta();`);
    let resultados: EmailPendiente[];
    try {
      resultados = await Promise.all([pendiente(), pendiente(), pendiente(), pendiente()]);
    } finally {
      await db.query(`
        DROP TRIGGER IF EXISTS wo_sales_test_lenta ON portal.wo_sales_email_reserva;
        DROP FUNCTION IF EXISTS portal.wo_sales_test_lenta();`);
    }
    const conEl = resultados.filter((r) => emailsDe(r).includes(email));
    expect(conEl).toHaveLength(1);
    expect(resultados.filter((r) => r.enviar)).toHaveLength(1);
  });

  it('CANDADO: una segunda petición dentro de la reserva no lo vuelve a servir', async () => {
    const email = await sembrarDestinatario('ana');
    expect(emailsDe(await pendiente())).toEqual([email]);
    expect((await pendiente()).enviar).toBe(false);
  });

  it('la reserva es por destinatario: uno nuevo se sirve aunque otro esté reservado', async () => {
    const ana = await sembrarDestinatario('ana');
    expect(emailsDe(await pendiente())).toEqual([ana]);
    const beto = await sembrarDestinatario('beto');
    expect(emailsDe(await pendiente())).toEqual([beto]);
  });

  it('una reserva de OTRO archivo no bloquea: si el contenido cambió, se manda el nuevo', async () => {
    const email = await sembrarDestinatario('ana');
    const primero = await pendiente(2);
    const segundo = await pendiente(3);
    expect(emailsDe(segundo)).toEqual([email]);
    expect(primero.enviar && segundo.enviar && primero.token !== segundo.token).toBe(true);
  });

  it('si n8n nunca confirma, la reserva vence a los cinco minutos y se reintenta', async () => {
    const email = await sembrarDestinatario('ana');
    expect(emailsDe(await pendiente())).toEqual([email]);
    await vencerReserva(email);
    expect(emailsDe(await pendiente())).toEqual([email]);
  });

  it('CANDADO: un destinatario reservado NO ve su franja sellada por la petición solapada', async () => {
    // Si la segunda petición lo tratara como «franja nueva sin envío» y sellara el
    // corte, un envío que n8n no llega a confirmar se perdería hasta la franja
    // siguiente, en vez de reintentarse al vencer la reserva.
    const email = await sembrarDestinatario('ana');
    const ayer8 = new Date('2026-09-24T08:00-05:00');
    const ahora = new Date('2026-09-25T10:00-05:00');
    await db.query(
      `INSERT INTO portal.wo_sales_email_frecuencia (email, frecuencia, hora, ultimo_corte)
       VALUES ($1, 'diario', 8, $2)`,
      [email, ayer8.toISOString()],
    );
    expect(emailsDe(await pendiente(2, ahora))).toEqual([email]);
    expect((await pendiente(2, ahora)).enviar).toBe(false);
    const { rows } = await db.query('SELECT ultimo_corte FROM portal.wo_sales_email_frecuencia WHERE email = $1', [email]);
    expect(new Date((rows[0] as { ultimo_corte: Date }).ultimo_corte).toISOString()).toBe(ayer8.toISOString());
    await vencerReserva(email);
    expect(emailsDe(await pendiente(2, ahora))).toEqual([email]);
  });
});

describe('confirmarEnvio (DATA-339)', () => {
  it('tras confirmar, el destinatario deja de estar pendiente y su reserva se borra', async () => {
    const email = await sembrarDestinatario('ana');
    const r = await pendiente();
    if (!r.enviar) throw new Error('debía haber envío');
    await confirmarEnvio(db, r.token, [email]);
    expect(await reservas()).toEqual([]);
    await vencerReserva(email); // no hay reserva que vencer: lo que manda ahora es el hash recibido
    expect((await pendiente()).enviar).toBe(false);
  });

  it('CANDADO: es atómica — si falla la última escritura, no queda nada a medias', async () => {
    // Sin transacción, marcarEnviados ya había escrito cuando guardarEstado fallaba:
    // el destinatario quedaba «recibido» sin sellar el estado global. Se fuerza el
    // fallo de la última escritura con un trigger que aborta.
    const email = await sembrarDestinatario('ana');
    const r = await pendiente();
    if (!r.enviar) throw new Error('debía haber envío');
    await db.query(`
      CREATE OR REPLACE FUNCTION portal.wo_sales_test_falla() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'fallo forzado'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER wo_sales_test_falla BEFORE INSERT OR UPDATE ON portal.wo_sales_email_estado
        FOR EACH ROW EXECUTE FUNCTION portal.wo_sales_test_falla();`);
    try {
      await expect(confirmarEnvio(db, r.token, [email])).rejects.toThrow(/fallo forzado/);
    } finally {
      await db.query(`
        DROP TRIGGER IF EXISTS wo_sales_test_falla ON portal.wo_sales_email_estado;
        DROP FUNCTION IF EXISTS portal.wo_sales_test_falla();`);
    }
    const { rows } = await db.query('SELECT 1 FROM portal.wo_sales_email_sent WHERE email = $1', [email]);
    expect(rows).toHaveLength(0);
    expect(await reservas()).toEqual([{ email, hash: r.token }]);
  });
});
