import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TOKEN_KEY, authHeaders, esAdmin, getToken, getUserId } from './index';

// TEST-711 — @suite/auth-client lee el token del portal para todas las
// sub-apps y no tenía ni un test. Lo que importa vigilar: que sin sesión no se
// mande una cabecera rota, y que un token raro no reviente la pantalla (esAdmin
// y getUserId son solo para la interfaz; la autorización la hace hub-api).
//
// `localStorage` se sustituye por uno en memoria: el CI corre en Node 20, que no
// lo tiene, y así el test no depende de jsdom.

let almacen: Map<string, string>;

beforeEach(() => {
  almacen = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => almacen.get(k) ?? null,
    setItem: (k: string, v: string) => void almacen.set(k, v),
    removeItem: (k: string) => void almacen.delete(k),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Un JWT con ese payload. La firma da igual: este paquete no la verifica. */
function jwt(payload: Record<string, unknown>): string {
  const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.firma`;
}
const conSesion = (token: string) => almacen.set(TOKEN_KEY, token);

describe('@suite/auth-client', () => {
  it('lee el token de la misma clave en la que lo guarda el portal', () => {
    // apps/portal/src/auth.ts escribe en 'ambientalia_token'; si una de las dos
    // cambia sola, todas las sub-apps se quedan sin sesión.
    expect(TOKEN_KEY).toBe('ambientalia_token');
    expect(getToken()).toBeNull();
    conSesion('abc');
    expect(getToken()).toBe('abc');
  });

  it('sin sesión no manda cabecera: ni «Bearer null» ni «Bearer »', () => {
    expect(authHeaders()).toEqual({});
  });

  it('con sesión manda Authorization: Bearer <token>', () => {
    conSesion('tok.en.x');
    expect(authHeaders()).toEqual({ Authorization: 'Bearer tok.en.x' });
  });

  it('esAdmin lee el rol del token', () => {
    expect(esAdmin()).toBe(false);
    conSesion(jwt({ role: 'admin', user_id: 'u1' }));
    expect(esAdmin()).toBe(true);
    conSesion(jwt({ role: 'user', user_id: 'u1' }));
    expect(esAdmin()).toBe(false);
  });

  it('getUserId lee el user_id del token, siempre como texto', () => {
    expect(getUserId()).toBeNull();
    conSesion(jwt({ user_id: '7f3c9a2e-1b4d-4e8f-9a6b-2c5d8e1f0a3b' }));
    expect(getUserId()).toBe('7f3c9a2e-1b4d-4e8f-9a6b-2c5d8e1f0a3b');
    conSesion(jwt({ user_id: 42 }));
    expect(getUserId()).toBe('42');
    conSesion(jwt({ role: 'admin' }));
    expect(getUserId()).toBeNull();
  });

  it('un token mal formado no revienta: no es admin y no tiene usuario', () => {
    for (const roto of ['sin-puntos', 'a.no-es-base64!!.c', `a.${btoa('{no json')}.c`, '']) {
      conSesion(roto);
      expect(esAdmin()).toBe(false);
      expect(getUserId()).toBeNull();
    }
  });
});
