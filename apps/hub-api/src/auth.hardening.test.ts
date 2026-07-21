import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Hardening de auth: SEC-213 (algoritmo fijo en jwt.verify) y SEC-214 (login
// timing-safe). auth.ts captura JWT_SECRET y AUTH_USERS AL CARGAR el módulo, así
// que fijamos el env ANTES e importamos auth de forma dinámica en beforeAll.
const SECRET = 'test-secret-hardening';
process.env.JWT_SECRET = SECRET;
const KNOWN_PW = 'known-password';
const KNOWN_HASH = bcrypt.hashSync(KNOWN_PW, 4); // cost bajo → test rápido
process.env.AUTH_USERS = `known@x.com:${KNOWN_HASH}`;

let auth: typeof import('./auth.js');
beforeAll(async () => {
  auth = await import('./auth.js');
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
  it('acepta un token HS256 legítimo (sin user_id → rama legacy, sin BD)', async () => {
    const token = jwt.sign({ sub: 'u@x.com', role: 'reader', apps: [] }, SECRET); // HS256 por defecto
    const next = vi.fn();
    const r = res();
    await auth.requireAuth(reqWith(token), r, next);
    expect(next).toHaveBeenCalled();
    expect(r.status).not.toHaveBeenCalledWith(401);
  });

  it('rechaza (401) un token con alg "none"', async () => {
    const noneToken = jwt.sign({ sub: 'attacker@x.com', role: 'admin' }, '', { algorithm: 'none' });
    const next = vi.fn();
    const r = res();
    await auth.requireAuth(reqWith(noneToken), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(401);
  });
});

describe('SEC-214 — verifyCredentials es timing-safe', () => {
  it('valida credenciales correctas del fallback AUTH_USERS', async () => {
    expect(await auth.verifyCredentials('known@x.com', KNOWN_PW)).toBe(true);
    expect(await auth.verifyCredentials('known@x.com', 'wrong')).toBe(false);
  });

  it('ejecuta bcrypt.compare TAMBIÉN cuando el usuario no existe (no fast-return)', async () => {
    const spy = vi.spyOn(bcrypt, 'compare');
    spy.mockClear();
    const result = await auth.verifyCredentials('desconocido@x.com', 'cualquiera');
    expect(result).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1); // hizo el compare contra el DUMMY_HASH
    spy.mockRestore();
  });
});
