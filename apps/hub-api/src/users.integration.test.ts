import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Tests de integración HTTP del router de usuarios (Checkpoint 11). Montamos el
// router real sobre un pool fake in-memory que modela `users` y `user_apps`, y
// mockeamos db.js para que requireAuth (chequeo de estado) use el mismo pool.

const SECRET = 'test-secret-integration';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = '';

interface Row {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
  role: string;
  status: string;
  created_at: string;
  avatar?: string | null;
  /** SEC-220 — se incrementa al cambiar contraseña o cerrar sesión. */
  token_version: number;
  _seq: number;
}

/** Pool fake compatible con pg (query + connect) para las queries del repo. */
class FakeDb {
  users: Row[] = [];
  apps: { user_id: string; app_id: string }[] = [];
  private seq = 0;
  private snap: { users: Row[]; apps: { user_id: string; app_id: string }[] } | null = null;

  seedUser(u: Partial<Row>): Row {
    const n = ++this.seq;
    const row: Row = {
      id: u.id ?? `uuid-${n}`,
      full_name: u.full_name ?? 'User',
      email: (u.email ?? `user${n}@x.com`).toLowerCase(),
      password_hash: u.password_hash ?? 'h',
      role: u.role ?? 'reader',
      status: u.status ?? 'active',
      created_at: u.created_at ?? new Date(1_700_000_000_000 + n * 1000).toISOString(),
      token_version: u.token_version ?? 0,
      _seq: n,
    };
    this.users.push(row);
    return row;
  }

  private pub(u: Row) {
    return { id: u.id, full_name: u.full_name, email: u.email, role: u.role, status: u.status, created_at: u.created_at };
  }

  async query(text: string, params: unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (/^BEGIN/i.test(sql)) {
      this.snap = { users: [...this.users], apps: [...this.apps] };
      return { rows: [], rowCount: 0 };
    }
    if (/^COMMIT/i.test(sql)) {
      this.snap = null;
      return { rows: [], rowCount: 0 };
    }
    if (/^ROLLBACK/i.test(sql)) {
      if (this.snap) {
        this.users = this.snap.users;
        this.apps = this.snap.apps;
      }
      this.snap = null;
      return { rows: [], rowCount: 0 };
    }

    if (/^INSERT INTO portal.users/i.test(sql)) {
      const [full_name, email, password_hash] = params as string[];
      const row = this.seedUser({ full_name, email, password_hash, role: 'reader', status: 'pending' });
      return { rows: [this.pub(row)], rowCount: 1 };
    }
    if (/^INSERT INTO portal.user_apps/i.test(sql)) {
      const [user_id, app_id] = params as string[];
      if (!this.apps.some((a) => a.user_id === user_id && a.app_id === app_id)) this.apps.push({ user_id, app_id });
      return { rows: [], rowCount: 1 };
    }
    if (/^DELETE FROM portal.user_apps/i.test(sql)) {
      const [user_id] = params as string[];
      this.apps = this.apps.filter((a) => a.user_id !== user_id);
      return { rows: [], rowCount: 0 };
    }
    if (/^DELETE FROM portal.users/i.test(sql)) {
      const [id] = params as string[];
      const before = this.users.length;
      this.users = this.users.filter((u) => u.id !== id);
      return { rows: [], rowCount: before - this.users.length };
    }
    if (/^UPDATE portal.users SET status/i.test(sql)) {
      const [id, status] = params as string[];
      const u = this.users.find((x) => x.id === id);
      if (u) u.status = status;
      return { rows: u ? [this.pub(u)] : [], rowCount: u ? 1 : 0 };
    }
    if (/^UPDATE portal.users SET role/i.test(sql)) {
      const [id, role] = params as string[];
      const u = this.users.find((x) => x.id === id);
      if (u) u.role = role;
      return { rows: u ? [this.pub(u)] : [], rowCount: u ? 1 : 0 };
    }
    if (/^UPDATE portal.users SET password_hash/i.test(sql)) {
      const [id, hash] = params as string[];
      const u = this.users.find((x) => x.id === id);
      // SEC-220 — la sentencia real cambia la contraseña Y sube token_version
      // en un solo UPDATE. El fake tiene que hacer lo mismo, o el test de que
      // cambiar la contraseña invalida las sesiones pasaría por casualidad.
      if (u) { u.password_hash = hash; u.token_version += 1; }
      return { rows: [], rowCount: u ? 1 : 0 };
    }
    if (/^UPDATE portal.users SET full_name/i.test(sql)) {
      const [id, full_name] = params as string[];
      const u = this.users.find((x) => x.id === id);
      if (u) u.full_name = full_name;
      return { rows: u ? [{ ...this.pub(u), avatar: u.avatar ?? null }] : [], rowCount: u ? 1 : 0 };
    }
    if (/^UPDATE portal.users SET avatar/i.test(sql)) {
      const [id, avatar] = params as string[];
      const u = this.users.find((x) => x.id === id);
      if (u) u.avatar = avatar;
      return { rows: [], rowCount: u ? 1 : 0 };
    }
    if (/count\(\*\)/i.test(sql)) {
      return { rows: [{ total: this.users.length }], rowCount: 1 };
    }
    if (/FROM portal.users WHERE email = \$1/i.test(sql)) {
      const [email] = params as string[];
      const u = this.users.find((x) => x.email === String(email).toLowerCase());
      return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
    }
    // SEC-224 — requireAuth ya no pide solo la fila del usuario: pide rol,
    // estado y apps en una sola consulta con LEFT JOIN sobre user_apps. Va
    // ANTES del `WHERE id = $1` genérico, que devuelve la fila entera y no
    // sabría montar el array de apps.
    if (/LEFT JOIN portal\.user_apps/i.test(sql)) {
      const [id] = params as string[];
      const u = this.users.find((x) => x.id === id);
      if (!u) return { rows: [], rowCount: 0 };
      const apps = this.apps
        .filter((a) => a.user_id === id)
        .map((a) => a.app_id)
        .sort();
      return { rows: [{ role: u.role, status: u.status, apps, token_version: u.token_version }], rowCount: 1 };
    }
    // SEC-220 — el logout invalida las sesiones incrementando token_version.
    if (/SET token_version = token_version \+ 1/i.test(sql)) {
      const [id] = params as string[];
      const u = this.users.find((x) => x.id === id);
      if (u) u.token_version += 1;
      return { rows: [], rowCount: u ? 1 : 0 };
    }
    if (/FROM portal.users WHERE id = \$1/i.test(sql)) {
      const [id] = params as string[];
      const u = this.users.find((x) => x.id === id);
      return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
    }
    if (/FROM portal.users ORDER BY created_at DESC/i.test(sql)) {
      const [limit, offset] = params as number[];
      const sorted = [...this.users].sort((a, b) => b._seq - a._seq);
      return { rows: sorted.slice(offset, offset + limit).map((u) => this.pub(u)), rowCount: 0 };
    }
    if (/FROM portal.user_apps WHERE user_id = \$1/i.test(sql)) {
      const [user_id] = params as string[];
      const rows = this.apps
        .filter((a) => a.user_id === user_id)
        .map((a) => ({ app_id: a.app_id }))
        .sort((x, y) => x.app_id.localeCompare(y.app_id));
      return { rows, rowCount: rows.length };
    }
    throw new Error(`FakeDb: query no soportada: ${sql}`);
  }

  async connect() {
    return { query: (t: string, p?: unknown[]) => this.query(t, p), release: () => {} };
  }
}

// Mock de db.js: requireAuth usa getHubPool() → devolvemos el pool del test.
const h = vi.hoisted(() => ({ pool: null as any }));
vi.mock('./db.js', () => ({ getHubPool: () => h.pool }));

let createUsersRouter: typeof import('./users/users.router.js').createUsersRouter;
beforeAll(async () => {
  ({ createUsersRouter } = await import('./users/users.router.js'));
});

const ADMIN_ID = 'admin-0000';
const READER_ID = 'reader-000';
let db: FakeDb;
let app: express.Express;

function tokenFor(userId: string, role: 'admin' | 'reader', email: string, token_version = 0) {
  return jwt.sign({ sub: email, user_id: userId, role, apps: [], token_version }, SECRET, { expiresIn: '1h' });
}
let adminToken: string;
let readerToken: string;

beforeEach(() => {
  db = new FakeDb();
  db.seedUser({ id: ADMIN_ID, email: 'admin@x.com', role: 'admin', status: 'active' });
  db.seedUser({ id: READER_ID, email: 'reader@x.com', role: 'reader', status: 'active' });
  h.pool = db;
  adminToken = tokenFor(ADMIN_ID, 'admin', 'admin@x.com');
  readerToken = tokenFor(READER_ID, 'reader', 'reader@x.com');
  app = express();
  app.use(express.json());
  app.use('/api', createUsersRouter(db));
});

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('GET /api/users', () => {
  it('sin token → 401', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });
  it('token reader → 403', async () => {
    const res = await request(app).get('/api/users').set(bearer(readerToken));
    expect(res.status).toBe(403);
  });
  it('token admin → 200 con forma paginada', async () => {
    const res = await request(app).get('/api/users').set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, limit: 50 });
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users).toHaveLength(2);
    // No debe filtrar password_hash.
    expect(res.body.users[0]).not.toHaveProperty('password_hash');
  });
});

describe('POST /api/auth/register', () => {
  it('registro válido → 201 y usuario pending', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Nuevo Usuario', email: 'nuevo@x.com', password: 's3cur3pass' });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('registration_pending');
    expect(res.body.userId).toBeTruthy();
    const created = db.users.find((u) => u.email === 'nuevo@x.com');
    expect(created?.status).toBe('pending');
  });
  it('password corta → 400 con field', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'X', email: 'a@x.com', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'password_too_short', field: 'password' });
  });
  it('email duplicado → 409', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Dup', email: 'admin@x.com', password: 's3cur3pass' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('email_already_registered');
  });
});

describe('PATCH /api/users/:id/status', () => {
  it('aprobar (pending → active) asigna rol reader', async () => {
    const p = db.seedUser({ email: 'pend@x.com', status: 'pending', role: 'reader' });
    const res = await request(app).patch(`/api/users/${p.id}/status`).set(bearer(adminToken)).send({ status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ status: 'active', role: 'reader' });
  });
  it('desactivar (active → inactive)', async () => {
    const u = db.seedUser({ email: 'act@x.com', status: 'active' });
    const res = await request(app).patch(`/api/users/${u.id}/status`).set(bearer(adminToken)).send({ status: 'inactive' });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('inactive');
  });
  it('admin desactivando su propia cuenta → 403', async () => {
    const res = await request(app).patch(`/api/users/${ADMIN_ID}/status`).set(bearer(adminToken)).send({ status: 'inactive' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('cannot_modify_own_account');
  });
  it('usuario inexistente → 404', async () => {
    const res = await request(app).patch('/api/users/no-existe/status').set(bearer(adminToken)).send({ status: 'active' });
    expect(res.status).toBe(404);
  });
  it('status inválido → 400', async () => {
    const u = db.seedUser({ email: 'z@x.com', status: 'active' });
    const res = await request(app).patch(`/api/users/${u.id}/status`).set(bearer(adminToken)).send({ status: 'raro' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/users/:id/role', () => {
  it('cambia rol → 200', async () => {
    const u = db.seedUser({ email: 'r@x.com', status: 'active', role: 'reader' });
    const res = await request(app).patch(`/api/users/${u.id}/role`).set(bearer(adminToken)).send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
  });
  it('rol inválido → 400', async () => {
    const u = db.seedUser({ email: 'r2@x.com', status: 'active' });
    const res = await request(app).patch(`/api/users/${u.id}/role`).set(bearer(adminToken)).send({ role: 'superadmin' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/users/:id/apps', () => {
  it('asigna apps → 200 y round-trip', async () => {
    const u = db.seedUser({ email: 'apps@x.com', status: 'active' });
    const apps = ['customer-profitability', 'inventory'];
    const res = await request(app).put(`/api/users/${u.id}/apps`).set(bearer(adminToken)).send({ apps });
    expect(res.status).toBe(200);
    expect([...res.body.apps].sort()).toEqual([...apps].sort());
  });
  it('usuario inexistente → 404', async () => {
    const res = await request(app).put('/api/users/no-existe/apps').set(bearer(adminToken)).send({ apps: [] });
    expect(res.status).toBe(404);
  });

  it('GET apps devuelve las asignadas', async () => {
    const u = db.seedUser({ email: 'getapps@x.com', status: 'active' });
    await request(app).put(`/api/users/${u.id}/apps`).set(bearer(adminToken)).send({ apps: ['inventory', 'customer-profitability'] });
    const res = await request(app).get(`/api/users/${u.id}/apps`).set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect([...res.body.apps].sort()).toEqual(['customer-profitability', 'inventory']);
  });

  it('GET apps de usuario inexistente → 404', async () => {
    const res = await request(app).get('/api/users/no-existe/apps').set(bearer(adminToken));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/users/:id', () => {
  it('elimina → 200 y desaparece', async () => {
    const u = db.seedUser({ email: 'del@x.com', status: 'active' });
    const res = await request(app).delete(`/api/users/${u.id}`).set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(db.users.some((x) => x.id === u.id)).toBe(false);
  });
  it('admin eliminando su propia cuenta → 403', async () => {
    const res = await request(app).delete(`/api/users/${ADMIN_ID}`).set(bearer(adminToken));
    expect(res.status).toBe(403);
  });
  it('usuario inexistente → 404', async () => {
    const res = await request(app).delete('/api/users/no-existe').set(bearer(adminToken));
    expect(res.status).toBe(404);
  });
});

describe('perfil propio (/api/users/me)', () => {
  it('GET /me sin token → 401', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });

  it('GET /me devuelve el perfil propio', async () => {
    const res = await request(app).get('/api/users/me').set(bearer(readerToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: READER_ID, email: 'reader@x.com', role: 'reader' });
    expect(res.body).toHaveProperty('avatar');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  // El nombre queda fijado en el registro. Esconderlo en la UI no bastaba: con
  // el endpoint vivo, cualquiera con el token podía renombrarse por API y
  // reescribir cómo aparece en las aprobaciones que ya firmó.
  it('el nombre no se puede cambiar: ya no existe PATCH /me/profile', async () => {
    const res = await request(app)
      .patch('/api/users/me/profile')
      .set(bearer(readerToken))
      .send({ fullName: 'Nombre Suplantado' });
    expect(res.status).toBe(404);

    // Y sigue siendo el del registro.
    const perfil = await request(app).get('/api/users/me').set(bearer(readerToken));
    expect(perfil.body.full_name).not.toBe('Nombre Suplantado');
  });

  it('PATCH /me/avatar: data URL válida → 200, basura → 400', async () => {
    const ok = await request(app)
      .patch('/api/users/me/avatar')
      .set(bearer(readerToken))
      .send({ avatar: 'data:image/png;base64,AAABBB' });
    expect(ok.status).toBe(200);

    const bad = await request(app).patch('/api/users/me/avatar').set(bearer(readerToken)).send({ avatar: 'no-es-imagen' });
    expect(bad.status).toBe(400);

    // El GET /me ahora refleja el avatar guardado.
    const me = await request(app).get('/api/users/me').set(bearer(readerToken));
    expect(me.body.avatar).toBe('data:image/png;base64,AAABBB');
  });
});

describe('rate limiting', () => {
  it('POST /api/auth/register supera 5/min → 429', async () => {
    let sawTooMany = false;
    for (let i = 0; i < 7; i++) {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ fullName: 'RL', email: `rl${i}@x.com`, password: 's3cur3pass' });
      if (res.status === 429) {
        sawTooMany = true;
        expect(res.body.error).toBe('too many requests');
        break;
      }
    }
    expect(sawTooMany).toBe(true);
  });
});

describe('SEC-220 — cerrar sesión y cambiar la contraseña invalidan de verdad', () => {
  // La prueba de punta a punta, por el router real. Hasta aquí nada podía matar
  // un JWT antes de que expirase, así que un token robado sobrevivía a la
  // reacción de la víctima.

  it('POST /api/auth/logout responde 200 y el MISMO token deja de valer', async () => {
    const u = db.seedUser({ email: 'sale@x.com', role: 'reader', status: 'active' });
    const tok = tokenFor(u.id, 'reader', u.email, 0);

    // Antes: sirve.
    expect((await request(app).get('/api/users/me').set(bearer(tok))).status).toBe(200);

    expect((await request(app).post('/api/auth/logout').set(bearer(tok))).status).toBe(200);

    // Después: el mismo token, firma intacta y sin expirar, ya no vale.
    expect((await request(app).get('/api/users/me').set(bearer(tok))).status).toBe(401);
  });

  it('CANDADO: el logout invalida TODAS las sesiones, no solo la que lo pidió', async () => {
    // Es la razón de ser del logout global: el caso que de verdad importa es
    // «me dejé la sesión abierta en otro sitio», y ese no lo resuelve un logout
    // por dispositivo.
    const u = db.seedUser({ email: 'dos-sesiones@x.com', role: 'reader', status: 'active' });
    const portatil = tokenFor(u.id, 'reader', u.email, 0);
    const movil = tokenFor(u.id, 'reader', u.email, 0);

    expect((await request(app).post('/api/auth/logout').set(bearer(portatil))).status).toBe(200);
    expect((await request(app).get('/api/users/me').set(bearer(movil))).status).toBe(401);
  });

  it('CANDADO: cambiar la contraseña también invalida las sesiones vivas', async () => {
    const pw = 'contrasena-vieja-1';
    const u = db.seedUser({ email: 'cambia@x.com', role: 'reader', status: 'active', password_hash: bcrypt.hashSync(pw, 4) });
    const tok = tokenFor(u.id, 'reader', u.email, 0);

    const cambio = await request(app)
      .patch('/api/users/me/password')
      .set(bearer(tok))
      .send({ currentPassword: pw, newPassword: 'contrasena-nueva-1' });
    expect(cambio.status).toBe(200);

    // El escenario entero: te roban el token, cambias la contraseña, y el
    // ladrón se queda fuera. Antes seguía dentro hasta que el token expirase.
    expect((await request(app).get('/api/users/me').set(bearer(tok))).status).toBe(401);
  });

  it('el token emitido DESPUÉS del logout sí funciona', async () => {
    const u = db.seedUser({ email: 'vuelve@x.com', role: 'reader', status: 'active' });
    expect((await request(app).post('/api/auth/logout').set(bearer(tokenFor(u.id, 'reader', u.email, 0)))).status).toBe(200);
    expect((await request(app).get('/api/users/me').set(bearer(tokenFor(u.id, 'reader', u.email, 1)))).status).toBe(200);
  });

  it('logout sin token → 401', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(401);
  });
});
