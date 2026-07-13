import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tests de la lógica de decodificación de sesión (task 12.2). Se prueba
// readAuthState(), que concentra el parseo del JWT; useAuth() es un envoltorio
// reactivo de esta función. Se mockea getToken para no depender de localStorage.

const h = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('../auth', () => ({ getToken: () => h.token }));

import { readAuthState } from './useAuth';

/** Construye un JWT de prueba (header.payload.sig) con el payload dado. */
function makeToken(payload: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(payload));
  return `header.${body}.sig`;
}
const futureExp = () => Math.floor(Date.now() / 1000) + 3600;
const pastExp = () => Math.floor(Date.now() / 1000) - 60;

beforeEach(() => {
  h.token = null;
});

describe('readAuthState', () => {
  it('parsea un JWT válido con todos los campos', () => {
    h.token = makeToken({
      sub: 'user@x.com',
      user_id: 'uuid-1',
      role: 'admin',
      apps: ['customer-profitability', 'inventory'],
      exp: futureExp(),
    });
    expect(readAuthState()).toEqual({
      isAuthenticated: true,
      user_id: 'uuid-1',
      email: 'user@x.com',
      role: 'admin',
      apps: ['customer-profitability', 'inventory'],
    });
  });

  it('sin token → estado vacío', () => {
    h.token = null;
    expect(readAuthState()).toEqual({ isAuthenticated: false, user_id: null, email: null, role: null, apps: [] });
  });

  it('token expirado → estado vacío', () => {
    h.token = makeToken({ sub: 'u@x.com', user_id: 'i', role: 'reader', apps: [], exp: pastExp() });
    expect(readAuthState().isAuthenticated).toBe(false);
  });

  it('token malformado → estado vacío (no lanza)', () => {
    h.token = 'esto-no-es-un-jwt';
    expect(readAuthState()).toEqual({ isAuthenticated: false, user_id: null, email: null, role: null, apps: [] });
  });

  it('sin exp → estado vacío (coherente con isAuthenticated)', () => {
    h.token = makeToken({ sub: 'u@x.com', user_id: 'i', role: 'reader', apps: [] });
    expect(readAuthState().isAuthenticated).toBe(false);
  });

  it('rol desconocido → role null pero autenticado', () => {
    h.token = makeToken({ sub: 'u@x.com', user_id: 'i', role: 'superadmin', apps: [], exp: futureExp() });
    const s = readAuthState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.role).toBeNull();
  });

  it('token legacy (solo sub) → autenticado con user_id/role nulos y apps []', () => {
    h.token = makeToken({ sub: 'legacy@x.com', exp: futureExp() });
    expect(readAuthState()).toEqual({
      isAuthenticated: true,
      user_id: null,
      email: 'legacy@x.com',
      role: null,
      apps: [],
    });
  });

  describe('apps malformado → []', () => {
    for (const [label, apps] of [
      ['null', null],
      ['undefined', undefined],
      ['número', 42],
      ['objeto', { a: 1 }],
      ['string', 'customer-profitability'],
      ['array con no-strings', ['ok', 3, null, { x: 1 }]],
    ] as const) {
      it(label, () => {
        h.token = makeToken({ sub: 'u@x.com', user_id: 'i', role: 'reader', apps, exp: futureExp() });
        const result = readAuthState().apps;
        // Solo se conservan strings; el resto → descartado.
        expect(result.every((a) => typeof a === 'string')).toBe(true);
        if (label === 'array con no-strings') expect(result).toEqual(['ok']);
        else expect(result).toEqual([]);
      });
    }
  });
});
