import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import { seedUsersFromEnv } from './seed-from-env.js';

// DATA-335 — `initDb()` corre el seed en CADA arranque. Con `ON CONFLICT DO
// NOTHING` a secas, un usuario borrado desde el panel que siguiera en
// AUTH_USERS volvía a nacer, activo, en el siguiente despliegue: ninguna baja
// era definitiva mientras la variable estuviera puesta. El seed solo sirve para
// dar el primer admin a una base nueva, y eso es lo que se prueba aquí.

const HASH = '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234';

let db: Pool;

const correos = async () =>
  (await db.query(`SELECT email, role, status FROM portal.users ORDER BY email`)).rows as {
    email: string;
    role: string;
    status: string;
  }[];

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.query(`DELETE FROM portal.users`);
  await db?.end();
});
beforeEach(async () => {
  // Los ficheros de BD corren en serie y cada uno siembra y borra los suyos:
  // vaciar la tabla entera aquí no pisa a nadie.
  await db.query(`DELETE FROM portal.users`);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('seedUsersFromEnv', () => {
  it('con la tabla vacía da de alta a los de AUTH_USERS, el primero como admin', async () => {
    vi.stubEnv('AUTH_USERS', `jefa@seed.test:${HASH},lector@seed.test:${HASH}`);
    await seedUsersFromEnv(db);
    expect(await correos()).toEqual([
      { email: 'jefa@seed.test', role: 'admin', status: 'active' },
      { email: 'lector@seed.test', role: 'reader', status: 'active' },
    ]);
  });

  it('si ya hay algún usuario no da de alta a nadie: un usuario borrado no resucita', async () => {
    await db.query(
      `INSERT INTO portal.users (full_name, email, password_hash, role, status)
       VALUES ('Admin', 'admin@seed.test', $1, 'admin', 'active')`,
      [HASH],
    );
    // `borrado@` estuvo en AUTH_USERS, se dio de baja desde el panel y la
    // variable se quedó puesta.
    vi.stubEnv('AUTH_USERS', `admin@seed.test:${HASH},borrado@seed.test:${HASH}`);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await seedUsersFromEnv(db);
    expect((await correos()).map((u) => u.email)).toEqual(['admin@seed.test']);
  });

  it('sin AUTH_USERS no hace nada', async () => {
    vi.stubEnv('AUTH_USERS', '');
    await seedUsersFromEnv(db);
    expect(await correos()).toEqual([]);
  });
});
