import { describe, it, expect, afterEach } from 'vitest';
import { inject } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { crearPoolHub, crearPoolMigraciones } from './db.js';

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
