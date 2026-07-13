import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import bcrypt from 'bcryptjs';
import { UserService, UserError, isValidEmail } from './users.service.js';
import type { UserRepository } from './users.repository.js';
import type { PaginatedUsers, RegisterInput, UserPublic, UserRole, UserStatus } from './users.types.js';

// Property tests de la lógica de negocio (tasks 4.2–4.8). Se usa un repositorio
// fake in-memory que implementa la interfaz de UserRepository, de modo que la
// lógica de UserService se ejercita sin BD. Los tests que no verifican el
// hashing siembran el usuario directamente (sin bcrypt) para ser rápidos.

interface StoredUser {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
}

class FakeUserRepository {
  private users: StoredUser[] = [];
  private apps = new Map<string, Set<string>>();
  private seq = 0;

  count(): number {
    return this.users.length;
  }

  /** Inserta un usuario directamente (sin pasar por register/bcrypt). */
  seed(partial: Partial<StoredUser> = {}): StoredUser {
    const u: StoredUser = {
      id: `uuid-${++this.seq}`,
      full_name: 'Seed User',
      email: `seed${this.seq}@test.com`,
      password_hash: 'seed-hash',
      role: 'reader',
      status: 'pending',
      created_at: new Date(0).toISOString(),
      ...partial,
    };
    this.users.push(u);
    return u;
  }

  private toPublic(u: StoredUser): UserPublic {
    const { password_hash, ...pub } = u;
    return pub;
  }

  async findByEmail(email: string): Promise<StoredUser | null> {
    const e = email.toLowerCase().trim();
    return this.users.find((u) => u.email === e) ?? null;
  }

  async findById(id: string): Promise<StoredUser | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }

  async create(input: RegisterInput, passwordHash: string): Promise<UserPublic> {
    const email = input.email.toLowerCase().trim();
    if (this.users.some((u) => u.email === email)) {
      throw Object.assign(new Error('duplicate'), { code: '23505' });
    }
    const u: StoredUser = {
      id: `uuid-${++this.seq}`,
      full_name: input.fullName.trim(),
      email,
      password_hash: passwordHash,
      role: 'reader',
      status: 'pending',
      created_at: new Date(0).toISOString(),
    };
    this.users.push(u);
    return this.toPublic(u);
  }

  async updateStatus(id: string, status: UserStatus): Promise<UserPublic | null> {
    const u = this.users.find((x) => x.id === id);
    if (!u) return null;
    u.status = status;
    return this.toPublic(u);
  }

  async updateRole(id: string, role: UserRole): Promise<UserPublic | null> {
    const u = this.users.find((x) => x.id === id);
    if (!u) return null;
    u.role = role;
    return this.toPublic(u);
  }

  async updatePassword(id: string, passwordHash: string): Promise<boolean> {
    const u = this.users.find((x) => x.id === id);
    if (!u) return false;
    u.password_hash = passwordHash;
    return true;
  }

  async delete(id: string): Promise<boolean> {
    const before = this.users.length;
    this.users = this.users.filter((u) => u.id !== id);
    this.apps.delete(id);
    return this.users.length < before;
  }

  async setApps(id: string, appIds: string[]): Promise<string[]> {
    const unique = [...new Set(appIds.map((a) => a.trim()).filter(Boolean))];
    this.apps.set(id, new Set(unique));
    return this.getApps(id);
  }

  async getApps(userId: string): Promise<string[]> {
    return [...(this.apps.get(userId) ?? [])].sort();
  }

  async listPaginated(page: number, perPage: number): Promise<PaginatedUsers> {
    const start = (page - 1) * perPage;
    return {
      users: this.users.slice(start, start + perPage).map((u) => this.toPublic(u)),
      total: this.users.length,
      page,
      limit: perPage,
    };
  }
}

function makeService() {
  const repo = new FakeUserRepository();
  const service = new UserService(repo as unknown as UserRepository);
  return { repo, service };
}

// --- Arbitraries ---
const seg = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 12 })
  .map((a) => a.join(''));
const tld = fc.constantFrom('com', 'org', 'net', 'co', 'io', 'edu');
const emailArb = fc.tuple(seg, seg, tld).map(([l, d, t]) => `${l}@${d}.${t}`);

const nameChar = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ áéíóúñ.-'.split(''));
const validNameArb = fc
  .array(nameChar, { minLength: 1, maxLength: 100 })
  .map((a) => a.join(''))
  .filter((s) => s.trim().length >= 1 && s.length <= 100);

const passChar = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%'.split(''));
const validPassArb = fc.array(passChar, { minLength: 8, maxLength: 30 }).map((a) => a.join(''));

const registerInputArb = fc.record({ fullName: validNameArb, email: emailArb, password: validPassArb });

const APP_IDS = ['customer-profitability', 'payment-reconciliation', 'inventory', 'customer-valuation'];
const appListArb = fc.subarray(APP_IDS);

// bcrypt coste 12 × 100 iteraciones es intrínsecamente lento (~20-50 s/test), y
// bajo contención de CPU en la suite completa puede acercarse al minuto. Timeout
// holgado para no ser flaky, manteniendo las 100 iteraciones que exige el diseño.
const HASH_TIMEOUT = 180_000;

describe('UserService — property tests', () => {
  // Feature: user-management, Property 1: Registro crea usuario en estado pending
  // Validates: Requirements 1.2, 3.1
  it(
    '4.2 — register() con input válido siempre crea usuario pending/reader',
    async () => {
      await fc.assert(
        fc.asyncProperty(registerInputArb, async (input) => {
          const { service } = makeService();
          const user = await service.register(input);
          expect(user.status).toBe('pending');
          expect(user.role).toBe('reader');
        }),
        { numRuns: 100 },
      );
    },
    HASH_TIMEOUT,
  );

  // Feature: user-management, Property 2: Hash bcrypt con coste mínimo 12
  // Validates: Requirements 1.3
  it(
    '4.3 — la contraseña nunca se almacena en texto plano (bcrypt coste ≥ 12)',
    async () => {
      await fc.assert(
        fc.asyncProperty(registerInputArb, async (input) => {
          const { repo, service } = makeService();
          await service.register(input);
          const stored = await repo.findByEmail(input.email);
          expect(stored).not.toBeNull();
          expect(stored!.password_hash).not.toBe(input.password);
          expect(await bcrypt.compare(input.password, stored!.password_hash)).toBe(true);
          expect(bcrypt.getRounds(stored!.password_hash)).toBeGreaterThanOrEqual(12);
        }),
        { numRuns: 100 },
      );
    },
    HASH_TIMEOUT,
  );

  // Feature: user-management, Property 3: Correo duplicado siempre rechazado con 409
  // Validates: Requirements 1.4
  it(
    '4.4 — registrar un email ya existente lanza 409 sin crear un segundo registro',
    async () => {
      await fc.assert(
        fc.asyncProperty(registerInputArb, async (input) => {
          const { repo, service } = makeService();
          await service.register(input);

          let err: unknown;
          try {
            await service.register({ fullName: 'Otro Nombre', email: input.email, password: input.password + 'x' });
          } catch (e) {
            err = e;
          }
          expect(err).toBeInstanceOf(UserError);
          expect((err as UserError).code).toBe('email_already_registered');
          expect((err as UserError).status).toBe(409);
          expect(repo.count()).toBe(1);
        }),
        { numRuns: 100 },
      );
    },
    HASH_TIMEOUT,
  );

  // Feature: user-management, Property 4: Emails/campos inválidos siempre rechazados con 400
  // Validates: Requirements 1.5, 1.6, 1.7
  it('4.5 — cualquier input inválido lanza 400 sin crear usuario', async () => {
    const invalidEmailArb = fc.oneof(
      fc.constant('noatsign'),
      fc.constant('no@dot'),
      fc.constant('@nolocal.com'),
      fc.constant('spaces in@email.com'),
      fc.constant(''),
      fc.string({ maxLength: 20 }).filter((e) => !isValidEmail(e)),
    );
    const shortPassArb = fc.string({ maxLength: 7 });
    const longNameArb = fc.array(nameChar, { minLength: 101, maxLength: 130 }).map((a) => a.join(''));
    const badNameArb = fc.oneof(fc.constant(''), fc.constant('   '), longNameArb);

    const invalidInputArb = fc.oneof(
      fc.record({ fullName: validNameArb, email: invalidEmailArb, password: validPassArb }),
      fc.record({ fullName: validNameArb, email: emailArb, password: shortPassArb }),
      fc.record({ fullName: badNameArb, email: emailArb, password: validPassArb }),
    );

    await fc.assert(
      fc.asyncProperty(invalidInputArb, async (input) => {
        const { repo, service } = makeService();
        let err: unknown;
        try {
          await service.register(input);
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).status).toBe(400);
        expect(repo.count()).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: user-management, Property 5: Transiciones de estado válidas
  // Validates: Requirements 2.2, 2.3, 2.5, 3.1
  it('4.6 — approve/deactivate/reactivate producen las transiciones correctas', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const { repo, service } = makeService();
        const pending = repo.seed({ status: 'pending', role: 'reader' });
        const requester = 'admin-id';

        const approved = await service.approve(pending.id);
        expect(approved.status).toBe('active');
        expect(approved.role).toBe('reader');

        const deactivated = await service.deactivate(pending.id, requester);
        expect(deactivated.status).toBe('inactive');

        const reactivated = await service.reactivate(pending.id);
        expect(reactivated.status).toBe('active');
      }),
      { numRuns: 100 },
    );
  });

  // Feature: user-management, Property 8: Auto-protección del administrador
  // Validates: Requirements 2.7
  it('4.7 — delete/deactivate sobre la propia cuenta lanzan 403 sin cambiar estado', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<UserStatus>('active'), async (status) => {
        const { repo, service } = makeService();
        const admin = repo.seed({ status, role: 'admin' });

        for (const op of [
          () => service.delete(admin.id, admin.id),
          () => service.deactivate(admin.id, admin.id),
        ]) {
          let err: unknown;
          try {
            await op();
          } catch (e) {
            err = e;
          }
          expect(err).toBeInstanceOf(UserError);
          expect((err as UserError).status).toBe(403);
        }

        const still = await repo.findById(admin.id);
        expect(still).not.toBeNull();
        expect(still!.status).toBe(status);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: user-management, Property 10: Round-trip de asignación de apps
  // Validates: Requirements 4.1, 4.2
  it('4.8 — setApps → getApps devuelve exactamente el conjunto (idempotente)', async () => {
    await fc.assert(
      fc.asyncProperty(appListArb, async (apps) => {
        const { repo, service } = makeService();
        const user = repo.seed({ status: 'active' });
        const expected = [...new Set(apps)].sort();

        const first = await service.setApps(user.id, apps);
        expect([...first].sort()).toEqual(expected);

        // Idempotencia: aplicar el mismo conjunto otra vez da el mismo resultado.
        const second = await service.setApps(user.id, apps);
        expect([...second].sort()).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });
});
