import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Pool } from '@algarpibe/zoho-sync';

// HTTP wiring of the calibraciones router: auth/app guards, role resolution and
// the 403/400 mapping. The SQL itself is covered by calibraciones.db.test.ts;
// here the pool is a double that only answers the role lookup and records
// every other query so a test can assert nothing was written.

const SECRET = 'test-secret-calibraciones';
process.env.JWT_SECRET = SECRET;

const authState = vi.hoisted(() => ({ byUser: new Map<string, { role: string; apps: string[] }>() }));
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async (_sql: string, params: unknown[] = []) => {
      const row = authState.byUser.get(String(params[0] ?? '')) ?? { role: 'reader', apps: ['calibraciones'] };
      return { rows: [{ role: row.role, status: 'active', apps: row.apps, token_version: 0 }], rowCount: 1 };
    },
    on: () => {},
  }),
}));

const { createCalibracionesRouter } = await import('./router.js');

const calRoles = new Map<string, string>();
const queries: string[] = [];
const fakePool = {
  query: async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM portal.cal_user_roles') && sql.includes('WHERE user_id')) {
      const role = calRoles.get(String(params[0]));
      return { rows: role ? [{ role }] : [], rowCount: role ? 1 : 0 };
    }
    queries.push(sql);
    return { rows: [], rowCount: 0 };
  },
  connect: async () => {
    throw new Error('no transactions in this test');
  },
} as unknown as Pool;

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api', createCalibracionesRouter(fakePool));
  return a;
}

let seq = 0;
function tokenFor(opts: { calRole?: string; portalRole?: string; apps?: string[] } = {}): string {
  const userId = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  authState.byUser.set(userId, { role: opts.portalRole ?? 'reader', apps: opts.apps ?? ['calibraciones'] });
  if (opts.calRole) calRoles.set(userId, opts.calRole);
  return jwt.sign({ sub: `u${seq}@ambientalia.com.co`, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' });
}

beforeEach(() => {
  queries.length = 0;
});

describe('guards', () => {
  it('401 without a token', async () => {
    const res = await request(app()).get('/api/calibraciones/roles/me');
    expect(res.status).toBe(401);
  });

  it('403 without the calibraciones app', async () => {
    const res = await request(app())
      .get('/api/calibraciones/roles/me')
      .set('Authorization', `Bearer ${tokenFor({ apps: ['ausencias'] })}`);
    expect(res.status).toBe(403);
  });
});

describe('roles', () => {
  it('a user with the app and no role row is LECTOR', async () => {
    const res = await request(app()).get('/api/calibraciones/roles/me').set('Authorization', `Bearer ${tokenFor()}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'LECTOR', permissions: ['read'], canManageRoles: false });
  });

  it('reports the stored role and its permissions', async () => {
    const res = await request(app())
      .get('/api/calibraciones/roles/me')
      .set('Authorization', `Bearer ${tokenFor({ calRole: 'TECNICO' })}`);
    expect(res.body.role).toBe('TECNICO');
    expect(res.body.permissions).toContain('verification.calculate');
  });

  it('a portal admin can manage roles but is not a director', async () => {
    const res = await request(app())
      .get('/api/calibraciones/roles/me')
      .set('Authorization', `Bearer ${tokenFor({ portalRole: 'admin', apps: [] })}`);
    expect(res.body).toMatchObject({ role: 'LECTOR', canManageRoles: true });
  });

  it('only portal admins may change roles', async () => {
    const res = await request(app())
      .put('/api/calibraciones/roles/00000000-0000-4000-8000-999999999999')
      .set('Authorization', `Bearer ${tokenFor({ calRole: 'DIRECTOR_TECNICO' })}`)
      .send({ role: 'TECNICO' });
    expect(res.status).toBe(403);
    expect(queries).toHaveLength(0);
  });
});

describe('permissions are checked before touching data', () => {
  it('LECTOR cannot create equipment', async () => {
    const res = await request(app())
      .post('/api/calibraciones/equipment')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
    expect(res.body.message).toMatch(/permiso/i);
    expect(queries).toHaveLength(0);
  });

  it('TECNICO cannot approve', async () => {
    const res = await request(app())
      .post('/api/calibraciones/verifications/00000000-0000-4000-8000-000000000001/approve')
      .set('Authorization', `Bearer ${tokenFor({ calRole: 'TECNICO' })}`);
    expect(res.status).toBe(403);
    expect(queries).toHaveLength(0);
  });

  it('TECNICO cannot change limits', async () => {
    const res = await request(app())
      .put('/api/calibraciones/limits')
      .set('Authorization', `Bearer ${tokenFor({ calRole: 'TECNICO' })}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('an invalid body is a 400 with a Spanish message and the field', async () => {
    const res = await request(app())
      .post('/api/calibraciones/equipment')
      .set('Authorization', `Bearer ${tokenFor({ calRole: 'TECNICO' })}`)
      .send({ brand: 'Thermo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
    expect(res.body.field).toBe('model');
    expect(typeof res.body.message).toBe('string');
    expect(queries).toHaveLength(0);
  });

  it('a malformed id is a 400, not a database error', async () => {
    const res = await request(app())
      .get('/api/calibraciones/verifications/not-a-uuid')
      .set('Authorization', `Bearer ${tokenFor()}`);
    expect(res.status).toBe(400);
  });
});
