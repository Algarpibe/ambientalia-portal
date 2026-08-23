import type { Pool } from '@algarpibe/zoho-sync';
import type { RegisterInput, UserPublic, UserRow, UserStatus, UserRole, PaginatedUsers, SelfProfile } from './users.types.js';

// El tipo del cliente transaccional se deriva del Pool para no depender de un
// import directo de 'pg' (sus @types no están instalados en este paquete).
type PoolClient = Awaited<ReturnType<Pool['connect']>>;

// Capa de acceso a datos del módulo user-management. Todas las queries usan
// parámetros posicionales ($1, $2…) para prevenir SQL injection. Las operaciones
// que tocan `users` y `user_apps` a la vez corren en una transacción con
// ROLLBACK ante cualquier fallo (Requirements 6.4, 6.6).

const PUBLIC_COLUMNS = 'id, full_name, email, role, status, created_at';

/** Normaliza una fila de BD a la proyección pública (sin password_hash). */
function toPublic(row: {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  created_at: Date | string;
}): UserPublic {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
    status: row.status,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export class UserRepository {
  constructor(private readonly pool: Pool) {}

  /** Busca por email (incluye password_hash para el login). null si no existe. */
  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query(
      `SELECT id, full_name, email, password_hash, role, status, created_at, token_version
         FROM portal.users WHERE email = $1`,
      [email.toLowerCase().trim()],
    );
    return rows[0] ?? null;
  }

  /** Busca por id (UUID). Incluye password_hash. null si no existe. */
  async findById(id: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query(
      `SELECT id, full_name, email, password_hash, role, status, created_at, token_version
         FROM portal.users WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Crea un usuario. `role` y `status` toman los defaults de la tabla
   * ('reader' / 'pending'). Devuelve la proyección pública del nuevo usuario.
   */
  async create(input: RegisterInput, passwordHash: string): Promise<UserPublic> {
    const { rows } = await this.pool.query(
      `INSERT INTO portal.users (full_name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING ${PUBLIC_COLUMNS}`,
      [input.fullName.trim(), input.email.toLowerCase().trim(), passwordHash],
    );
    return toPublic(rows[0]);
  }

  /** Cambia el estado. Devuelve el usuario actualizado o null si no existe. */
  async updateStatus(id: string, status: UserStatus): Promise<UserPublic | null> {
    const { rows } = await this.pool.query(
      `UPDATE portal.users SET status = $2 WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
      [id, status],
    );
    return rows[0] ? toPublic(rows[0]) : null;
  }

  /** Cambia el rol. Devuelve el usuario actualizado o null si no existe. */
  async updateRole(id: string, role: UserRole): Promise<UserPublic | null> {
    const { rows } = await this.pool.query(
      `UPDATE portal.users SET role = $2 WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
      [id, role],
    );
    return rows[0] ? toPublic(rows[0]) : null;
  }

  /** Perfil propio (incluye avatar). null si no existe. */
  async getSelfProfile(id: string): Promise<SelfProfile | null> {
    const { rows } = await this.pool.query(
      `SELECT ${PUBLIC_COLUMNS}, avatar FROM portal.users WHERE id = $1`,
      [id],
    );
    if (!rows[0]) return null;
    return { ...toPublic(rows[0]), avatar: rows[0].avatar ?? null };
  }

  // No hay updateName: full_name se escribe una sola vez, al registrarse.

  /** Actualiza el avatar (data URL). Devuelve true si el usuario existía. */
  async updateAvatar(id: string, avatar: string): Promise<boolean> {
    const res = await this.pool.query(
      'UPDATE portal.users SET avatar = $2 WHERE id = $1',
      [id, avatar],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** Preferencias de UI del usuario ({} si no tiene). null si no existe. */
  async getPreferences(id: string): Promise<Record<string, unknown> | null> {
    const { rows } = await this.pool.query(
      'SELECT preferences FROM portal.users WHERE id = $1',
      [id],
    );
    if (!rows[0]) return null;
    return rows[0].preferences ?? {};
  }

  /**
   * Fusiona un parche en las preferencias (merge de primer nivel, `||` de jsonb):
   * cada app escribe su propia clave sin pisar las de las demás. Devuelve el blob
   * resultante, o null si el usuario no existe.
   */
  async mergePreferences(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const { rows } = await this.pool.query(
      'UPDATE portal.users SET preferences = COALESCE(preferences, \'{}\'::jsonb) || $2::jsonb WHERE id = $1 RETURNING preferences',
      [id, JSON.stringify(patch)],
    );
    if (!rows[0]) return null;
    return rows[0].preferences ?? {};
  }

  /** Actualiza el hash de contraseña. Devuelve true si el usuario existía. */
  /**
   * Cambia la contraseña e invalida las sesiones vivas EN LA MISMA sentencia
   * (SEC-220). Van juntas a propósito: si el incremento de `token_version`
   * fuera una segunda consulta, un fallo entre ambas dejaría la contraseña
   * cambiada y los tokens robados todavía sirviendo, que es exactamente el
   * escenario del que la víctima intenta salir.
   */
  async updatePassword(id: string, passwordHash: string): Promise<boolean> {
    const res = await this.pool.query(
      'UPDATE portal.users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1',
      [id, passwordHash],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Invalida todas las sesiones vivas del usuario (SEC-220). La usa el logout;
   * el cambio de contraseña no la necesita porque `updatePassword` ya lo hace
   * en su propia sentencia.
   */
  async bumpTokenVersion(id: string): Promise<boolean> {
    const res = await this.pool.query(
      'UPDATE portal.users SET token_version = token_version + 1 WHERE id = $1',
      [id],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Elimina un usuario de forma permanente. Borra `user_apps` y `users` dentro
   * de una transacción; las FK `ON DELETE CASCADE` (mig. 001 y 013) ponen además
   * a NULL `contabilidad_overrides.updated_by` — supresión completa (PRIV-812,
   * Ley 1581 art. 8). La transacción garantiza atomicidad. Devuelve true si existía.
   */
  async delete(id: string): Promise<boolean> {
    return this.withTransaction(async (client) => {
      await client.query('DELETE FROM portal.user_apps WHERE user_id = $1', [id]);
      const res = await client.query('DELETE FROM portal.users WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    });
  }

  /**
   * Reemplaza el conjunto de apps del usuario por `appIds` (idempotente).
   * Borra las asignaciones previas e inserta las nuevas en una transacción.
   * Devuelve la lista final de apps.
   */
  async setApps(id: string, appIds: string[]): Promise<string[]> {
    const unique = [...new Set(appIds.map((a) => a.trim()).filter(Boolean))];
    await this.withTransaction(async (client) => {
      await client.query('DELETE FROM portal.user_apps WHERE user_id = $1', [id]);
      for (const appId of unique) {
        await client.query(
          `INSERT INTO portal.user_apps (user_id, app_id) VALUES ($1, $2)
           ON CONFLICT (user_id, app_id) DO NOTHING`,
          [id, appId],
        );
      }
    });
    return this.getApps(id);
  }

  /** Devuelve los app_id asignados al usuario, ordenados. Lista vacía si ninguno. */
  async getApps(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      'SELECT app_id FROM portal.user_apps WHERE user_id = $1 ORDER BY app_id',
      [userId],
    );
    return rows.map((r: { app_id: string }) => r.app_id);
  }

  /** Lista paginada de usuarios (proyección pública), ordenada por fecha desc. */
  async listPaginated(page: number, perPage: number): Promise<PaginatedUsers> {
    const safePage = Math.max(1, Math.floor(page));
    const safePerPage = Math.max(1, Math.floor(perPage));
    const offset = (safePage - 1) * safePerPage;

    const totalRes = await this.pool.query('SELECT count(*)::int AS total FROM portal.users');
    const total: number = totalRes.rows[0]?.total ?? 0;

    const { rows } = await this.pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM portal.users
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`,
      [safePerPage, offset],
    );

    return { users: rows.map(toPublic), total, page: safePage, limit: safePerPage };
  }

  /** Ejecuta `fn` dentro de BEGIN/COMMIT; hace ROLLBACK ante cualquier error. */
  private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
