import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import { UserRepository } from './users.repository.js';

// La 079 y las dos consultas de las condiciones de uso contra Postgres de verdad.
// Es la primera vez que esto toca una base real: el pool falso de
// users.integration.test.ts casa por regex y no valida SQL.
//
// Solo toca usuarios de @terminos.test: los ficheros de BD corren en serie y cada
// uno limpia lo suyo. Las aceptaciones se van con sus usuarios (ON DELETE
// CASCADE), así que el TRUNCATE de test-db/harness.ts no necesita la tabla nueva.

const DOMINIO = '@terminos.test';
const SQL_079 = readFileSync(
  fileURLToPath(new URL('./migrations/079_terms_acceptances.sql', import.meta.url)),
  'utf8',
);

let db: Pool;
let repo: UserRepository;

beforeAll(() => {
  db = poolDePrueba();
  repo = new UserRepository(db);
});
afterAll(async () => {
  await db?.query(`DELETE FROM portal.users WHERE email LIKE $1`, [`%${DOMINIO}`]);
  await db?.end();
});
beforeEach(async () => {
  await db.query(`DELETE FROM portal.users WHERE email LIKE $1`, [`%${DOMINIO}`]);
});

async function sembrarUsuario(local: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO portal.users (full_name, email, password_hash, role, status)
     VALUES ('Persona de Prueba', $1, 'hash-ficticio', 'reader', 'active') RETURNING id`,
    [`${local}${DOMINIO}`],
  );
  return (rows[0] as { id: string }).id;
}

async function aceptacionesDe(userId: string): Promise<{ version: string; accepted_at: Date }[]> {
  const { rows } = await db.query(
    `SELECT version, accepted_at FROM portal.terms_acceptances WHERE user_id = $1 ORDER BY version`,
    [userId],
  );
  return rows as { version: string; accepted_at: Date }[];
}

describe('migración 079 contra Postgres', () => {
  it('se puede aplicar dos veces más sobre la ya aplicada (idempotente)', async () => {
    await db.query(SQL_079);
    await db.query(SQL_079);
  });

  it('deja portal.terms_acceptances con usuario, versión y fecha, las tres obligatorias', async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name = 'terms_acceptances' ORDER BY ordinal_position`,
    );
    expect(rows).toEqual([
      { column_name: 'user_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'version', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'accepted_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
    ]);
  });

  it('re-aplicarla no borra las aceptaciones que ya hay', async () => {
    const id = await sembrarUsuario('reaplicar');
    await repo.recordTermsAcceptance(id, '1.0');
    await db.query(SQL_079);
    expect(await aceptacionesDe(id)).toHaveLength(1);
  });

  it('la clave primaria (user_id, version) impide dos filas iguales', async () => {
    const id = await sembrarUsuario('clave');
    await db.query(`INSERT INTO portal.terms_acceptances (user_id, version) VALUES ($1, '1.0')`, [id]);
    await expect(
      db.query(`INSERT INTO portal.terms_acceptances (user_id, version) VALUES ($1, '1.0')`, [id]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('borrar la cuenta borra sus aceptaciones (ON DELETE CASCADE, supresión de datos)', async () => {
    const id = await sembrarUsuario('borrado');
    await repo.recordTermsAcceptance(id, '1.0');
    expect(await repo.delete(id)).toBe(true);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM portal.terms_acceptances WHERE user_id = $1`,
      [id],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('UserRepository · condiciones de uso', () => {
  it('hasAcceptedTerms es false sin aceptación y true tras recordTermsAcceptance', async () => {
    const id = await sembrarUsuario('acepta');
    expect(await repo.hasAcceptedTerms(id, '1.0')).toBe(false);
    await repo.recordTermsAcceptance(id, '1.0');
    expect(await repo.hasAcceptedTerms(id, '1.0')).toBe(true);
  });

  it('otra versión u otra cuenta no cuentan', async () => {
    const ana = await sembrarUsuario('ana');
    const beto = await sembrarUsuario('beto');
    await repo.recordTermsAcceptance(ana, '0.9');
    await repo.recordTermsAcceptance(beto, '1.0');
    expect(await repo.hasAcceptedTerms(ana, '1.0')).toBe(false);
  });

  it('repetir la misma aceptación no falla y conserva la fecha de la primera', async () => {
    const id = await sembrarUsuario('repite');
    // La primera, con una fecha pasada fija: si el segundo intento la pisara con
    // now(), la diferencia sería de meses y no dependería de la precisión de ms.
    await db.query(
      `INSERT INTO portal.terms_acceptances (user_id, version, accepted_at) VALUES ($1, '1.0', '2026-01-01T00:00:00Z')`,
      [id],
    );
    await repo.recordTermsAcceptance(id, '1.0');
    const filas = await aceptacionesDe(id);
    expect(filas).toHaveLength(1);
    expect(filas[0].accepted_at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('una versión nueva es otra fila: quedan las dos aceptaciones', async () => {
    const id = await sembrarUsuario('dos-versiones');
    await repo.recordTermsAcceptance(id, '1.0');
    await repo.recordTermsAcceptance(id, '1.1');
    expect((await aceptacionesDe(id)).map((f) => f.version)).toEqual(['1.0', '1.1']);
  });
});
