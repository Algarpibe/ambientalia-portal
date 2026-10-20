import { describe, it, expect, afterEach } from 'vitest';
import { inject } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { aplicarMigraciones, crearPoolHub, crearPoolMigraciones } from './db.js';

// DATA-331 contra un Postgres de verdad: el tope del pool principal lo aplica el
// propio servidor (statement_timeout) y corta la consulta; el de las migraciones
// no tiene tope. db.test.ts sólo mira la configuración; esto mira el efecto.

let pool: Pool | null = null;
afterEach(async () => {
  await pool?.end();
  pool = null;
});

describe('statement_timeout', () => {
  it('el pool principal cancela una consulta que pasa del tope', async () => {
    pool = crearPoolHub(inject('urlBd'), { consultaMs: 200 });
    // 57014 = query_canceled: lo cortó Postgres, no un timeout del cliente.
    await expect(pool.query('SELECT pg_sleep(1)')).rejects.toMatchObject({ code: '57014' });
  });

  it('el pool de las migraciones deja terminar una consulta lenta', async () => {
    pool = crearPoolMigraciones(inject('urlBd'));
    await expect(pool.query('SELECT pg_sleep(0.3)')).resolves.toBeDefined();
  });
});

// DATA-340: las migraciones se re-ejecutan en cada arranque, y un
// `ALTER TABLE … ADD COLUMN IF NOT EXISTS` pide ACCESS EXCLUSIVE ANTES de mirar si
// la columna existe. Si otra transacción tiene la tabla abierta, el ALTER espera;
// y mientras espera, todo lo que llega detrás a esa tabla (el login del contenedor
// viejo, en un despliegue) se pone en cola tras él.
describe('lock_timeout de las migraciones', () => {
  it('una migración que no consigue el candado se rinde en vez de colgar el arranque', async () => {
    const bloqueador = crearPoolHub(inject('urlBd'));
    const tx = await bloqueador.connect();
    try {
      // Lo que tendría abierto un contenedor viejo a mitad de una petición, o un
      // pg_dump: un ACCESS SHARE sobre portal.users, que la 002 tiene que alterar.
      await tx.query('BEGIN');
      await tx.query('SELECT 1 FROM portal.users LIMIT 1');

      pool = crearPoolMigraciones(inject('urlBd'), { esperaCandadoMs: 200 });
      const resultado = await Promise.race([
        aplicarMigraciones(pool).then(
          () => 'aplicadas',
          (e: unknown) => e
        ),
        new Promise((r) => setTimeout(() => r('colgada'), 3_000)),
      ]);
      // 55P03 = lock_not_available: Postgres dejó de esperar el candado.
      expect(resultado).toMatchObject({ code: '55P03' });
    } finally {
      await tx.query('ROLLBACK');
      tx.release();
      await bloqueador.end();
    }
  });
});
