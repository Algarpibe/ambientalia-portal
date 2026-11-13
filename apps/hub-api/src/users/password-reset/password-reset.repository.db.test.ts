import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../../test-db/harness.js';
import { PasswordResetRepository } from './password-reset.repository.js';

// El repositorio de la recuperacion de contrasena contra Postgres de verdad: la
// transaccion de restablecer, la carrera de dos usos del mismo token, el
// rollback de una cuenta que ya no esta activa, la cascada al borrar el usuario
// y la limpieza de caducados. Las horas las pone el test: el repositorio
// compara contra el `now` que recibe, no contra now() de la BD.
//
// Solo toca usuarios de @restablecer.test y la tabla de tokens: los ficheros de
// BD corren en serie y cada uno limpia lo suyo.

const DOMINIO = '@restablecer.test';
const T0 = new Date('2026-11-13T15:00:00.000Z');
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const at = (ms: number) => new Date(T0.getTime() + ms);

let db: Pool;
let repo: PasswordResetRepository;

beforeAll(() => {
  db = poolDePrueba();
  repo = new PasswordResetRepository(db);
});
afterAll(async () => {
  await db?.query(`DELETE FROM portal.users WHERE email LIKE $1`, [`%${DOMINIO}`]);
  await db?.end();
});
beforeEach(async () => {
  await db.query(`DELETE FROM portal.password_reset_tokens`);
  await db.query(`DELETE FROM portal.users WHERE email LIKE $1`, [`%${DOMINIO}`]);
});

async function sembrarUsuario(local: string, nombre: string, status = 'active'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO portal.users (full_name, email, password_hash, role, status)
     VALUES ($1, $2, 'hash-viejo', 'reader', $3) RETURNING id`,
    [nombre, `${local}${DOMINIO}`, status],
  );
  return (rows[0] as { id: string }).id;
}

async function insertarToken(
  userId: string,
  tokenHash: string,
  f: { createdAt: Date; expiresAt: Date; usedAt?: Date | null },
): Promise<void> {
  await db.query(
    `INSERT INTO portal.password_reset_tokens (user_id, token_hash, created_at, expires_at, used_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, f.createdAt, f.expiresAt, f.usedAt ?? null],
  );
}

interface FilaToken {
  token_hash: string;
  used_at: Date | null;
  created_at: Date;
  expires_at: Date;
}

async function tokensDe(userId: string): Promise<FilaToken[]> {
  const { rows } = await db.query(
    `SELECT token_hash, used_at, created_at, expires_at
       FROM portal.password_reset_tokens WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return rows as FilaToken[];
}

async function usuario(id: string): Promise<{ password_hash: string; token_version: number }> {
  const { rows } = await db.query(`SELECT password_hash, token_version FROM portal.users WHERE id = $1`, [id]);
  return rows[0] as { password_hash: string; token_version: number };
}

describe('findUserByEmail', () => {
  it('normaliza el correo y devuelve id, correo, nombre y estado', async () => {
    const id = await sembrarUsuario('ana', 'Ana Ruiz', 'pending');
    expect(await repo.findUserByEmail('  ANA@Restablecer.test ')).toEqual({
      id,
      email: `ana${DOMINIO}`,
      fullName: 'Ana Ruiz',
      status: 'pending',
    });
  });

  it('un correo desconocido: null', async () => {
    expect(await repo.findUserByEmail(`nadie${DOMINIO}`)).toBeNull();
  });
});

describe('recentTokenStats', () => {
  it('sin enlaces: ninguno', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    expect(await repo.recentTokenStats(yo, at(-HORA))).toEqual({ lastCreatedAt: null, countSince: 0 });
  });

  it('el ultimo de la cuenta y cuantos desde `since` (gastados incluidos; los de otra cuenta no)', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    const otro = await sembrarUsuario('luis', 'Luis Gil');
    await insertarToken(yo, 'h1', { createdAt: at(-90 * MIN), expiresAt: at(-60 * MIN) });
    await insertarToken(yo, 'h2', { createdAt: at(-30 * MIN), expiresAt: at(0) });
    await insertarToken(yo, 'h3', { createdAt: at(-5 * MIN), expiresAt: at(25 * MIN), usedAt: at(-MIN) });
    await insertarToken(otro, 'h4', { createdAt: at(-MIN), expiresAt: at(29 * MIN) });
    expect(await repo.recentTokenStats(yo, at(-HORA))).toEqual({ lastCreatedAt: at(-5 * MIN), countSince: 2 });
  });
});

describe('createToken', () => {
  it('guarda el nuevo con la hora que recibe y anula los anteriores sin usar de esa cuenta, no los de otra', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    const otro = await sembrarUsuario('luis', 'Luis Gil');
    await repo.createToken({ userId: otro, tokenHash: 'de-otro', expiresAt: at(30 * MIN), now: T0 });
    await repo.createToken({ userId: yo, tokenHash: 'primero', expiresAt: at(31 * MIN), now: at(MIN) });
    await repo.createToken({ userId: yo, tokenHash: 'segundo', expiresAt: at(34 * MIN), now: at(4 * MIN) });

    const mios = await tokensDe(yo);
    expect(mios.map((f) => [f.token_hash, f.used_at])).toEqual([
      ['primero', at(4 * MIN)],
      ['segundo', null],
    ]);
    expect(mios[1].created_at).toEqual(at(4 * MIN));
    expect(mios[1].expires_at).toEqual(at(34 * MIN));
    expect((await tokensDe(otro))[0].used_at).toBeNull();
  });

  it('borra los caducados hace mas de un dia, de cualquier cuenta, y no los demas', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    const otro = await sembrarUsuario('luis', 'Luis Gil');
    await insertarToken(otro, 'viejo', { createdAt: at(-DIA - 31 * MIN), expiresAt: at(-DIA - MIN) });
    await insertarToken(otro, 'reciente', { createdAt: at(-DIA - 29 * MIN), expiresAt: at(-DIA + MIN), usedAt: at(-DIA) });
    await repo.createToken({ userId: yo, tokenHash: 'nuevo', expiresAt: at(30 * MIN), now: T0 });
    expect((await tokensDe(otro)).map((f) => f.token_hash)).toEqual(['reciente']);
    expect((await tokensDe(yo)).map((f) => f.token_hash)).toEqual(['nuevo']);
  });
});

describe('consumeAndSetPassword', () => {
  it('restablece: cambia password_hash, sube token_version, gasta el token y dice a quien', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await repo.createToken({ userId: yo, tokenHash: 'huella', expiresAt: at(30 * MIN), now: T0 });
    const r = await repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-nuevo', now: at(5 * MIN) });
    expect(r).toEqual({ userId: yo, email: `ana${DOMINIO}`, fullName: 'Ana Ruiz' });
    expect(await usuario(yo)).toEqual({ password_hash: 'hash-nuevo', token_version: 1 });
    expect((await tokensDe(yo))[0].used_at).toEqual(at(5 * MIN));
  });

  it('solo sirve una vez', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await repo.createToken({ userId: yo, tokenHash: 'huella', expiresAt: at(30 * MIN), now: T0 });
    await repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-nuevo', now: at(MIN) });
    expect(await repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-otro', now: at(2 * MIN) })).toBeNull();
    expect(await usuario(yo)).toEqual({ password_hash: 'hash-nuevo', token_version: 1 });
  });

  it('caducado (expires_at <= now): null y nada cambia', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await repo.createToken({ userId: yo, tokenHash: 'huella', expiresAt: at(30 * MIN), now: T0 });
    expect(await repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-nuevo', now: at(30 * MIN) })).toBeNull();
    expect(await usuario(yo)).toEqual({ password_hash: 'hash-viejo', token_version: 0 });
    expect((await tokensDe(yo))[0].used_at).toBeNull();
  });

  it('un token desconocido: null', async () => {
    expect(await repo.consumeAndSetPassword({ tokenHash: 'no-existe', passwordHash: 'hash-nuevo', now: T0 })).toBeNull();
  });

  it('dos consumos simultaneos del mismo token: solo uno gana', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await repo.createToken({ userId: yo, tokenHash: 'huella', expiresAt: at(30 * MIN), now: T0 });
    const [a, b] = await Promise.all([
      repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-a', now: at(MIN) }),
      repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-b', now: at(MIN) }),
    ]);
    expect([a, b].filter((r) => r !== null)).toHaveLength(1);
    const u = await usuario(yo);
    expect(u.token_version).toBe(1);
    expect(u.password_hash).toBe(a !== null ? 'hash-a' : 'hash-b');
  });

  it('cuenta no active al usar el token: null y ROLLBACK (ni la clave ni el token cambian)', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await repo.createToken({ userId: yo, tokenHash: 'huella', expiresAt: at(30 * MIN), now: T0 });
    await db.query(`UPDATE portal.users SET status = 'inactive' WHERE id = $1`, [yo]);
    expect(await repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-nuevo', now: at(MIN) })).toBeNull();
    expect(await usuario(yo)).toEqual({ password_hash: 'hash-viejo', token_version: 0 });
    expect((await tokensDe(yo))[0].used_at).toBeNull();
  });

  it('anula los demas tokens sin usar de la cuenta', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await insertarToken(yo, 'otra-huella', { createdAt: at(-MIN), expiresAt: at(29 * MIN) });
    await insertarToken(yo, 'huella', { createdAt: T0, expiresAt: at(30 * MIN) });
    await repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-nuevo', now: at(2 * MIN) });
    expect((await tokensDe(yo)).map((f) => [f.token_hash, f.used_at])).toEqual([
      ['otra-huella', at(2 * MIN)],
      ['huella', at(2 * MIN)],
    ]);
  });
});

describe('ON DELETE CASCADE', () => {
  it('borrar el usuario borra sus tokens', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await repo.createToken({ userId: yo, tokenHash: 'huella', expiresAt: at(30 * MIN), now: T0 });
    await db.query(`DELETE FROM portal.users WHERE id = $1`, [yo]);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM portal.password_reset_tokens WHERE user_id = $1`, [yo]);
    expect((rows[0] as { n: number }).n).toBe(0);
  });
});
