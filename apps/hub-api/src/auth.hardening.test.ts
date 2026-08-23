import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Hardening de auth: SEC-213 (algoritmo fijo en jwt.verify) y SEC-214 (login
// timing-safe). auth.ts captura JWT_SECRET AL CARGAR el módulo, así que fijamos
// el env ANTES e importamos auth de forma dinámica en beforeAll.
const SECRET = 'test-secret-hardening';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = ''; // el fallback ya no existe; queda solo como provisioning

const KNOWN_EMAIL = 'known@x.com';
const KNOWN_PW = 'known-password';
const KNOWN_HASH = bcrypt.hashSync(KNOWN_PW, 4); // cost bajo → test rápido
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Mock de db.js. Desde SEC-220 TODO token pasa por la BD, y desde el retiro del
// fallback el login también: sin este mock no hay ni SEC-213 ni SEC-214 que
// probar. Discrimina por el parámetro, no por el SQL: `loginUser` busca por
// email y `requireAuth` por id.
const state = vi.hoisted(() => ({ filaDeRequireAuth: null as Record<string, unknown> | null }));
vi.mock('./db.js', () => ({
  getHubPool: () => ({
    query: async (_sql: string, params: unknown[] = []) => {
      const p = String(params[0] ?? '');
      if (p === 'known@x.com') {
        return {
          rows: [{
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            full_name: 'Known', email: 'known@x.com',
            password_hash: bcrypt.hashSync('known-password', 4),
            role: 'reader', status: 'active',
            created_at: '2025-01-01T00:00:00.000Z', token_version: 0,
          }],
          rowCount: 1,
        };
      }
      if (p === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' && state.filaDeRequireAuth) {
        return { rows: [state.filaDeRequireAuth], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 }; // email desconocido, o sin fila sembrada
    },
    on: () => {},
  }),
}));

let auth: typeof import('./auth.js');
beforeAll(async () => {
  auth = await import('./auth.js');
});
beforeEach(() => {
  state.filaDeRequireAuth = { role: 'reader', status: 'active', apps: [], token_version: 0 };
});

function res(): Response {
  const r: Partial<Response> = {};
  r.status = vi.fn().mockReturnValue(r as Response);
  r.json = vi.fn().mockReturnValue(r as Response);
  return r as Response;
}
function reqWith(token: string): Request {
  return { header: (h: string) => (h.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined) } as unknown as Request;
}

describe('SEC-213 — jwt.verify fija algorithms:[HS256]', () => {
  it('acepta un token HS256 legítimo de un usuario activo', async () => {
    // Con user_id, porque desde el retiro del fallback no hay otra clase de token.
    const token = jwt.sign({ sub: KNOWN_EMAIL, user_id: USER_ID, role: 'reader', apps: [], token_version: 0 }, SECRET);
    const next = vi.fn();
    const r = res();
    await auth.requireAuth(reqWith(token), r, next);
    expect(next).toHaveBeenCalled();
    expect(r.status).not.toHaveBeenCalledWith(401);
  });

  it('rechaza (401) un token con alg "none"', async () => {
    const noneToken = jwt.sign({ sub: 'attacker@x.com', user_id: USER_ID, role: 'admin' }, '', { algorithm: 'none' });
    const next = vi.fn();
    const r = res();
    await auth.requireAuth(reqWith(noneToken), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(401);
  });
});

describe('SEC-214 — loginUser es timing-safe', () => {
  // La defensa vivía en verifyCredentials, que se retiró con el fallback
  // AUTH_USERS. Se movió a loginUser porque siempre fue SUYA: sin ella, un
  // correo inexistente responde al instante y uno real cuesta un bcrypt.compare,
  // y esa diferencia enumera usuarios.
  it('valida credenciales correctas contra la BD', async () => {
    const ok = await auth.loginUser(KNOWN_EMAIL, KNOWN_PW);
    expect(ok.ok).toBe(true);
    const mal = await auth.loginUser(KNOWN_EMAIL, 'wrong');
    expect(mal.ok).toBe(false);
    expect(mal.status).toBe(401);
  });

  it('CANDADO: ejecuta bcrypt.compare TAMBIÉN cuando el email no existe (no fast-return)', async () => {
    const spy = vi.spyOn(bcrypt, 'compare');
    spy.mockClear();
    const r = await auth.loginUser('desconocido@x.com', 'cualquiera');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1); // el compare contra DUMMY_HASH
    spy.mockRestore();
  });

  it('CANDADO: el mensaje de error NO distingue email inexistente de contraseña mala', async () => {
    const inexistente = await auth.loginUser('desconocido@x.com', 'x');
    const malaPw = await auth.loginUser(KNOWN_EMAIL, 'x');
    expect(inexistente.error).toBe(malaPw.error);
    expect(inexistente.status).toBe(malaPw.status);
  });
});
