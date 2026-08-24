import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar } from './test-db/harness.js';

// La consulta que `requireAuth` lanza en CADA petición, contra un Postgres de
// verdad.
//
// Existe por un incidente concreto: el 2026-08-23 se añadió `u.token_version`
// al SELECT sin añadirla al GROUP BY. PostgreSQL rechaza eso, `requireAuth`
// cayó a su rama de error y devolvió 401 a TODO EL MUNDO — el portal entero,
// caído. Y los 1011 tests estaban en verde, porque todos los mocks de pool que
// usa la suite (`users.integration`, `auth.middleware`, los routers) devuelven
// una fila fija **sin mirar el SQL**: pueden pasar con una consulta que la base
// de datos ni siquiera acepta.
//
// Este fichero es el único sitio donde ese SQL se ejecuta de verdad. Si alguien
// toca la consulta de `requireAuth`, que la copie aquí y la vea correr.
const SQL_REQUIRE_AUTH = `SELECT u.role,
              u.status,
              u.token_version,
              ARRAY(
                SELECT ua.app_id
                  FROM portal.user_apps ua
                 WHERE ua.user_id = u.id
                 ORDER BY ua.app_id
              ) AS apps
         FROM portal.users u
        WHERE u.id = $1`;

// La consulta de `getSelfProfile` (GET /api/users/me), copiada aqui por el mismo
// motivo que la de arriba: es la que da las apps con las que el portal decide
// que iconos pinta, y ningun test unitario la ejecuta de verdad.
const SQL_PERFIL_PROPIO = `SELECT id, full_name, email, role, status, created_at,
              avatar,
              ARRAY(
                SELECT ua.app_id
                  FROM portal.user_apps ua
                 WHERE ua.user_id = u.id
                 ORDER BY ua.app_id
              ) AS apps
         FROM portal.users u
        WHERE u.id = $1`;

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
const DOMINIO = '@requireauth.test';
beforeEach(async () => {
  await limpiar(db);
  // `limpiar()` no toca portal.users (ver test-db/harness.ts): este fichero
  // borra lo suyo por sufijo, para no dejar filas entre ejecuciones ni pisar
  // los usuarios que siembren otros tests.
  await db.query(`DELETE FROM portal.users WHERE email LIKE $1`, ['%' + DOMINIO]);
});

/** Crea un usuario y devuelve su id. */
async function sembrarUsuario(
  correo: string,
  opts: { role?: string; status?: string; apps?: string[] } = {},
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO portal.users (full_name, email, password_hash, role, status)
     VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
    [correo.split('@')[0], correo, opts.role ?? 'reader', opts.status ?? 'active'],
  );
  const id = (rows[0] as { id: string }).id;
  for (const app of opts.apps ?? []) {
    await db.query('INSERT INTO portal.user_apps (user_id, app_id) VALUES ($1, $2)', [id, app]);
  }
  return id;
}

describe('la consulta de requireAuth contra una base de verdad', () => {
  it('CANDADO: Postgres la ACEPTA (esto es lo que faltaba el 2026-08-23)', async () => {
    const id = await sembrarUsuario('acepta' + DOMINIO);
    // Si la consulta fuera inválida, esto lanzaría y en producción se traduce
    // en un 401 para todas las peticiones autenticadas.
    await expect(db.query(SQL_REQUIRE_AUTH, [id])).resolves.toBeTruthy();
  });

  it('devuelve rol, estado y token_version de la fila', async () => {
    const id = await sembrarUsuario('admin' + DOMINIO, { role: 'admin' });
    const { rows } = await db.query(SQL_REQUIRE_AUTH, [id]);
    expect(rows[0]).toMatchObject({ role: 'admin', status: 'active', token_version: 0 });
  });

  it('devuelve las apps asignadas, ordenadas', async () => {
    const id = await sembrarUsuario('conapps' + DOMINIO, { apps: ['wo-sales', 'ausencias'] });
    const { rows } = await db.query(SQL_REQUIRE_AUTH, [id]);
    expect((rows[0] as { apps: string[] }).apps).toEqual(['ausencias', 'wo-sales']);
  });

  it('CANDADO: sin apps devuelve un array VACÍO, no null', async () => {
    // `requireAuth` hace `req.user.apps = user.apps ?? []`. Si esto devolviera
    // null el `??` lo taparía, pero un null viajando por el código de
    // autorización es justo lo que no se quiere.
    const id = await sembrarUsuario('sinapps' + DOMINIO);
    const { rows } = await db.query(SQL_REQUIRE_AUTH, [id]);
    expect((rows[0] as { apps: string[] }).apps).toEqual([]);
  });

  it('un usuario inexistente no devuelve filas (→ 401 en requireAuth)', async () => {
    const { rows } = await db.query(SQL_REQUIRE_AUTH, ['00000000-0000-4000-8000-000000000000']);
    expect(rows).toHaveLength(0);
  });

  it('CANDADO: la consulta del perfil propio tambien la ACEPTA Postgres', async () => {
    // `getSelfProfile` estrena el mismo ARRAY(subconsulta) desde que el portal
    // dejo de sacar las apps del token, y corre el mismo riesgo: el doble de
    // `users.integration.test.ts` casa por REGEX y no valida el SQL, asi que una
    // consulta invalida ahi pasaria con los 1011 en verde y solo se veria en
    // produccion — que es literalmente lo que paso el 2026-08-23.
    const id = await sembrarUsuario('perfil' + DOMINIO, { apps: ['wo-sales', 'ausencias'] });
    const { rows } = await db.query(SQL_PERFIL_PROPIO, [id]);
    expect(rows[0]).toMatchObject({ role: 'reader', status: 'active' });
    expect((rows[0] as { apps: string[] }).apps).toEqual(['ausencias', 'wo-sales']);
  });

  it('CANDADO: el perfil sin apps devuelve un array VACIO, no null', async () => {
    // Los guardias del portal hacen `.includes` sobre esto.
    const id = await sembrarUsuario('perfilsinapps' + DOMINIO);
    const { rows } = await db.query(SQL_PERFIL_PROPIO, [id]);
    expect((rows[0] as { apps: string[] }).apps).toEqual([]);
  });

  it('CANDADO: la migración 034 dejó token_version NOT NULL DEFAULT 0', async () => {
    // Es lo que hace que desplegar SEC-220 no desloguee a nadie: los tokens
    // anteriores no traen el campo y se comparan contra este 0.
    const { rows } = await db.query(
      `SELECT column_default, is_nullable, data_type
         FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name = 'users' AND column_name = 'token_version'`,
    );
    expect(rows[0]).toMatchObject({ is_nullable: 'NO', data_type: 'integer' });
    expect(String((rows[0] as { column_default: string }).column_default)).toContain('0');
  });
});
