import { describe, it, expect, beforeAll, vi } from 'vitest';
import fc from 'fast-check';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Property test del JWT extendido tras login (task 8.5, Property 9).
// Mockeamos db.js para controlar findByEmail y getApps sin BD real.

const SECRET = 'test-secret-login';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = '';

// Contraseña de prueba con hash fijo (cost 4 → bcrypt.compare rápido en el loop).
const PASSWORD = 'correct-horse-battery';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  apps: [] as string[],
}));

vi.mock('./db.js', () => ({
  getHubPool: () => ({
    query: async (sql: string) => {
      if (/FROM portal.user_apps/i.test(sql)) {
        return { rows: state.apps.map((app_id) => ({ app_id })), rowCount: state.apps.length };
      }
      // findByEmail
      return { rows: state.user ? [state.user] : [], rowCount: state.user ? 1 : 0 };
    },
    on: () => {},
  }),
}));

let auth: typeof import('./auth.js');
beforeAll(async () => {
  auth = await import('./auth.js');
});

const APP_IDS = ['payment-reconciliation', 'inventory', 'customer-valuation'];
const emailArb = fc
  .tuple(
    fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 12 }).map((a) => a.join('')),
    fc.constantFrom('empresa.com', 'test.org', 'x.co'),
  )
  .map(([l, d]) => `${l}@${d}`);

describe('loginUser — JWT extendido (task 8.5)', () => {
  // Feature: user-management, Property 9: JWT incluye role y apps correctos tras login
  // Validates: Requirements 3.3, 4.3, 6.2
  it('el JWT contiene sub=email, user_id, role y apps exactamente igual a user_apps', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        emailArb,
        fc.constantFrom<'admin' | 'reader'>('admin', 'reader'),
        fc.subarray(APP_IDS),
        async (userId, email, role, apps) => {
          state.user = {
            id: userId,
            full_name: 'X',
            email,
            password_hash: PASSWORD_HASH,
            role,
            status: 'active',
            created_at: '2025-01-01T00:00:00.000Z',
          };
          state.apps = apps;

          const result = await auth.loginUser(email, PASSWORD);
          expect(result.ok).toBe(true);

          const payload = jwt.verify(result.token as string, SECRET) as Record<string, unknown>;
          expect(payload.sub).toBe(email);
          expect(payload.user_id).toBe(userId);
          expect(payload.role).toBe(role);
          expect(payload.apps).toEqual(apps);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Fue de 8h, luego 30 días, y desde SEC-220 son 7. El candado no defiende un
  // número concreto por capricho: defiende que nadie lo mueva sin pensarlo. 30
  // días eran demasiados cuando NADA podía invalidar un token antes de tiempo;
  // ahora que cambiar la contraseña y cerrar sesión sí lo hacen, 7 es el
  // compromiso entre no reloguear a diario y no dejar suelto un mes un token
  // del que nadie sospecha.
  it('la sesión dura 7 días por defecto (SEC-220; ni 8h ni 30 días por descuido)', async () => {
    state.user = {
      id: 'u1', full_name: 'X', email: 'ttl@empresa.com', password_hash: PASSWORD_HASH,
      role: 'reader', status: 'active', created_at: '2025-01-01T00:00:00.000Z',
    };
    state.apps = [];
    const result = await auth.loginUser('ttl@empresa.com', PASSWORD);
    const payload = jwt.verify(result.token as string, SECRET) as { iat: number; exp: number };
    const days = (payload.exp - payload.iat) / 86400;
    expect(days).toBeCloseTo(7, 0);
  });

  it('usuario no activo → 403 sin emitir token', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), emailArb, fc.constantFrom('pending', 'inactive'), async (userId, email, status) => {
        state.user = {
          id: userId,
          full_name: 'X',
          email,
          password_hash: PASSWORD_HASH,
          role: 'reader',
          status,
          created_at: '2025-01-01T00:00:00.000Z',
        };
        state.apps = [];
        const result = await auth.loginUser(email, PASSWORD);
        expect(result.ok).toBe(false);
        expect(result.status).toBe(403);
        expect(result.token).toBeUndefined();
      }),
      { numRuns: 50 },
    );
  });
});
