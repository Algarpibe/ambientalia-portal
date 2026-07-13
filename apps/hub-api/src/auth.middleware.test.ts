import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import jwt from 'jsonwebtoken';

// Property tests de los middlewares de autorización (tasks 7.4 y 7.5).
// requireAuth/requireOwnerOrAdmin consultan la BD vía getHubPool(); mockeamos
// ./db.js para controlar qué devuelve findById sin una BD real.

const SECRET = 'test-secret-middlewares';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = '';

// Estado compartido con el mock (vi.hoisted para que exista al construir el mock).
const state = vi.hoisted(() => ({ findByIdResult: null as Record<string, unknown> | null }));

vi.mock('./db.js', () => ({
  getHubPool: () => ({
    query: async () => ({
      rows: state.findByIdResult ? [state.findByIdResult] : [],
      rowCount: state.findByIdResult ? 1 : 0,
    }),
    on: () => {},
  }),
}));

let auth: typeof import('./auth.js');
beforeAll(async () => {
  auth = await import('./auth.js');
});
beforeEach(() => {
  state.findByIdResult = null;
});

function mockReq(headers: Record<string, string> = {}, params: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const k in headers) lower[k.toLowerCase()] = headers[k];
  return { header: (n: string) => lower[n.toLowerCase()], params } as any;
}
function mockRes() {
  const res: any = { statusCode: 200, body: null };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (o: any) => {
    res.body = o;
    return res;
  };
  return res;
}
async function run(mw: any, req: any) {
  const res = mockRes();
  let passed = false;
  await mw(req, res, () => {
    passed = true;
  });
  return { passed, status: res.statusCode, body: res.body };
}

function activeUser(id: string, role: 'admin' | 'reader' = 'reader') {
  return {
    id,
    full_name: 'X',
    email: 'x@x.com',
    password_hash: 'h',
    role,
    status: 'active',
    created_at: '2025-01-01T00:00:00.000Z',
  };
}
function tokenFor(userId: string, role: 'admin' | 'reader' = 'reader') {
  return jwt.sign({ sub: 'x@x.com', user_id: userId, role, apps: [] }, SECRET, { expiresIn: '1h' });
}

describe('requireAuth — chequeo de estado (task 7.4)', () => {
  // Feature: user-management, Property 6: JWT de usuario inactivo es rechazado
  // Validates: Requirements 2.4, 2.8
  it('rechaza con 401 cualquier usuario no activo, aun con JWT válido y no expirado', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.constantFrom('pending', 'inactive'), async (userId, status) => {
        state.findByIdResult = { ...activeUser(userId), status };
        const req = mockReq({ authorization: `Bearer ${tokenFor(userId)}` });
        const { passed, status: code } = await run(auth.requireAuth, req);
        expect(passed).toBe(false);
        expect(code).toBe(401);
      }),
      { numRuns: 100 },
    );
  });

  it('deja pasar a un usuario activo (control)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (userId) => {
        state.findByIdResult = activeUser(userId);
        const req = mockReq({ authorization: `Bearer ${tokenFor(userId)}` });
        const { passed, status: code } = await run(auth.requireAuth, req);
        expect(passed).toBe(true);
        expect(code).toBe(200);
      }),
      { numRuns: 100 },
    );
  });

  it('rechaza con 401 si el usuario ya no existe en BD', async () => {
    const userId = '00000000-0000-4000-8000-000000000000';
    state.findByIdResult = null; // findById → null
    const req = mockReq({ authorization: `Bearer ${tokenFor(userId)}` });
    const { passed, status } = await run(auth.requireAuth, req);
    expect(passed).toBe(false);
    expect(status).toBe(401);
  });
});

describe('requireOwnerOrAdmin — límite propio/ajeno (task 7.5)', () => {
  // Feature: user-management, Property 11: Autorización lector respeta límite propio/ajeno
  // Validates: Requirements 3.5, 3.6
  it('reader: permite el recurso propio y bloquea (403) el ajeno', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), async (ownerId, otherId) => {
        fc.pre(ownerId !== otherId);
        state.findByIdResult = activeUser(ownerId, 'reader');
        const auth401Header = { authorization: `Bearer ${tokenFor(ownerId, 'reader')}` };

        // Recurso propio → permitido.
        const own = await run(auth.requireOwnerOrAdmin, mockReq(auth401Header, { id: ownerId }));
        expect(own.passed).toBe(true);

        // Recurso ajeno → 403.
        const other = await run(auth.requireOwnerOrAdmin, mockReq(auth401Header, { id: otherId }));
        expect(other.passed).toBe(false);
        expect(other.status).toBe(403);
      }),
      { numRuns: 100 },
    );
  });

  it('admin: permite acceder a un recurso ajeno', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), async (adminId, otherId) => {
        fc.pre(adminId !== otherId);
        state.findByIdResult = activeUser(adminId, 'admin');
        const req = mockReq({ authorization: `Bearer ${tokenFor(adminId, 'admin')}` }, { id: otherId });
        const { passed } = await run(auth.requireOwnerOrAdmin, req);
        expect(passed).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
