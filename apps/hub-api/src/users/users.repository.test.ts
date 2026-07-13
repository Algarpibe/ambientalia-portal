import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { UserRepository } from './users.repository.js';

// Property tests del repositorio (tasks 3.2 y 3.3). Se usa un fake in-memory que
// modela las tablas `users` y `user_apps` con transacciones reales
// (snapshot en BEGIN, restauración en ROLLBACK), evitando una dependencia de BD.
// El diseño sanciona "mock del pool" para atomicidad y un esquema de test
// dedicado para el borrado; este fake cubre ambos de forma determinista.

interface Row {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
  role: string;
  status: string;
  created_at: Date;
}
interface AppRow {
  user_id: string;
  app_id: string;
}

type Snapshot = { users: Row[]; apps: AppRow[] };

/** Pool falso compatible con la interfaz que usa UserRepository (query + connect). */
class FakeDb {
  users: Row[] = [];
  apps: AppRow[] = [];
  /** Si devuelve true para una sentencia de datos, se lanza un error (fuerza fallo). */
  failOn?: (sql: string) => boolean;
  private snap: Snapshot | null = null;
  private seq = 0;

  async query(text: string, params: unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const sql = text.replace(/\s+/g, ' ').trim();

    // --- Control transaccional (no sujeto a failOn) ---
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

    // --- Fallo forzado (simula error del driver a mitad de transacción) ---
    if (this.failOn && this.failOn(sql)) {
      throw new Error('forced db failure');
    }

    // --- INSERT INTO users ... RETURNING ---
    if (/^INSERT INTO users/i.test(sql)) {
      const [full_name, email, password_hash] = params as string[];
      const row: Row = {
        id: `uuid-${++this.seq}`,
        full_name,
        email,
        password_hash,
        role: 'reader',
        status: 'pending',
        created_at: new Date(0),
      };
      this.users.push(row);
      return { rows: [row], rowCount: 1 };
    }

    // --- INSERT INTO user_apps ... ON CONFLICT DO NOTHING ---
    if (/^INSERT INTO user_apps/i.test(sql)) {
      const [user_id, app_id] = params as string[];
      if (!this.apps.some((a) => a.user_id === user_id && a.app_id === app_id)) {
        this.apps.push({ user_id, app_id });
      }
      return { rows: [], rowCount: 1 };
    }

    // --- DELETE FROM user_apps WHERE user_id = $1 ---
    if (/^DELETE FROM user_apps/i.test(sql)) {
      const [user_id] = params as string[];
      const before = this.apps.length;
      this.apps = this.apps.filter((a) => a.user_id !== user_id);
      return { rows: [], rowCount: before - this.apps.length };
    }

    // --- DELETE FROM users WHERE id = $1 ---
    if (/^DELETE FROM users/i.test(sql)) {
      const [id] = params as string[];
      const before = this.users.length;
      this.users = this.users.filter((u) => u.id !== id);
      return { rows: [], rowCount: before - this.users.length };
    }

    // --- SELECT ... FROM users WHERE id = $1 ---
    if (/FROM users WHERE id = \$1/i.test(sql)) {
      const [id] = params as string[];
      const found = this.users.find((u) => u.id === id);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }

    // --- SELECT app_id FROM user_apps WHERE user_id = $1 ---
    if (/FROM user_apps WHERE user_id = \$1/i.test(sql)) {
      const [user_id] = params as string[];
      const rows = this.apps
        .filter((a) => a.user_id === user_id)
        .map((a) => ({ app_id: a.app_id }))
        .sort((x, y) => x.app_id.localeCompare(y.app_id));
      return { rows, rowCount: rows.length };
    }

    throw new Error(`FakeDb: query no soportada en test: ${sql}`);
  }

  async connect() {
    return {
      query: (t: string, p?: unknown[]) => this.query(t, p),
      release: () => {},
    };
  }
}

const appIdArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/);
const appListArb = fc.array(appIdArb, { maxLength: 8 });

function dedupeSorted(apps: string[]): string[] {
  return [...new Set(apps.map((a) => a.trim()).filter(Boolean))].sort();
}

describe('UserRepository — property tests', () => {
  // Feature: user-management, Property 15: Atomicidad transaccional en operaciones multi-tabla
  // Validates: Requirements 6.4, 6.6
  it('3.2 — si la segunda escritura de una transacción falla, la primera se revierte', async () => {
    await fc.assert(
      fc.asyncProperty(appListArb, async (seedApps) => {
        const db = new FakeDb();
        const repo = new UserRepository(db as any);

        const user = await repo.create(
          { fullName: 'Test User', email: 'a@b.com', password: 'irrelevant' },
          'hash',
        );
        await repo.setApps(user.id, seedApps);
        const before = dedupeSorted(seedApps);

        // delete() hace: DELETE user_apps (1ª escritura) → DELETE users (2ª).
        // Forzamos el fallo en la 2ª: el borrado de user_apps debe revertirse.
        db.failOn = (sql) => /DELETE FROM users/i.test(sql);
        await expect(repo.delete(user.id)).rejects.toThrow();
        db.failOn = undefined;

        // El usuario sigue existiendo y sus apps intactas (rollback total).
        expect(await repo.findById(user.id)).not.toBeNull();
        expect(await repo.getApps(user.id)).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: user-management, Property 7: Eliminación es permanente y total
  // Validates: Requirements 2.6
  it('3.3 — tras delete(id), findById es null y no quedan user_apps de ese usuario', async () => {
    await fc.assert(
      fc.asyncProperty(appListArb, async (seedApps) => {
        const db = new FakeDb();
        const repo = new UserRepository(db as any);

        const user = await repo.create(
          { fullName: 'Test User', email: 'a@b.com', password: 'irrelevant' },
          'hash',
        );
        await repo.setApps(user.id, seedApps);

        const deleted = await repo.delete(user.id);

        expect(deleted).toBe(true);
        expect(await repo.findById(user.id)).toBeNull();
        expect(await repo.getApps(user.id)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
