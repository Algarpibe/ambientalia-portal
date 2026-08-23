import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';

// El módulo lee las envs al importarse → las fijamos ANTES del import dinámico.
const SECRET = 'test-secret-para-firmar';
process.env.JWT_SECRET = SECRET;

// requireAuth consulta la BD para TODO token (desde SEC-220 no hay excepciones),
// así que hace falta el mock de db.js aunque el test sea del middleware.
const state = vi.hoisted(() => ({ fila: null as Record<string, unknown> | null }));
vi.mock('./db.js', () => ({
  getHubPool: () => ({
    query: async () => ({ rows: state.fila ? [state.fila] : [], rowCount: state.fila ? 1 : 0 }),
    on: () => {},
  }),
}));

let auth: typeof import('./auth.js');
beforeAll(async () => { auth = await import('./auth.js'); });
beforeEach(() => { state.fila = null; });

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const filaActiva = (token_version = 0) => ({ role: 'reader', status: 'active', apps: [], token_version });
const tokenDe = (payload: object) => jwt.sign(payload, SECRET, { expiresIn: '1h' });

// Mocks mínimos de Express (header case-insensitive, como el real).
function mockReq(headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const k in headers) lower[k.toLowerCase()] = headers[k];
  return { header: (n: string) => lower[n.toLowerCase()] } as any;
}
function mockRes() {
  const res: any = { statusCode: 200, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (o: any) => { res.body = o; return res; };
  return res;
}
async function run(req: any) {
  const res = mockRes();
  let passed = false;
  await auth.requireAuth(req, res, () => { passed = true; });
  return { passed, status: res.statusCode, body: res.body };
}

describe('requireAuth (solo JWT Bearer)', () => {
  it('deja pasar con un Bearer JWT válido de un usuario activo', async () => {
    state.fila = filaActiva();
    const token = tokenDe({ sub: 'user@ambientalia.com.co', user_id: USER_ID, role: 'reader', apps: [], token_version: 0 });
    const { passed, status } = await run(mockReq({ authorization: `Bearer ${token}` }));
    expect(passed).toBe(true);
    expect(status).toBe(200);
  });

  it('rechaza (401) sin credenciales', async () => {
    const { passed, status, body } = await run(mockReq({}));
    expect(passed).toBe(false);
    expect(status).toBe(401);
    expect(body).toEqual({ error: 'unauthorized' });
  });

  it('rechaza (401) con un JWT inválido', async () => {
    const { passed, status } = await run(mockReq({ authorization: 'Bearer no-es-un-jwt' }));
    expect(passed).toBe(false);
    expect(status).toBe(401);
  });

  // CANDADO del retiro del fallback AUTH_USERS (2026-08-23). Un token sin
  // `user_id` era el formato legacy y tenía barra libre: `next()` sin tocar la
  // BD, sin chequeo de estado, de rol ni de versión — el único camino que no se
  // podía revocar. Ya no existe, y firmar uno a mano con el secreto correcto
  // tampoco sirve.
  it('CANDADO: un token legacy sin user_id ya NO pasa, aunque la firma sea válida', async () => {
    state.fila = filaActiva();
    const token = tokenDe({ sub: 'user@ambientalia.com.co' });
    const { passed, status } = await run(mockReq({ authorization: `Bearer ${token}` }));
    expect(passed).toBe(false);
    expect(status).toBe(401);
  });
});
