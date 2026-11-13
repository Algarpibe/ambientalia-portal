import type { Pool } from '@algarpibe/zoho-sync';
import type { UserStatus } from '../users.types.js';
import type {
  ConsumeTokenInput,
  CreateTokenInput,
  PasswordResetStore,
  ResetUser,
  ResetUserRef,
  TokenStats,
} from './password-reset.service.js';

// El tipo del cliente transaccional se deriva del Pool, como en
// users.repository.ts (los @types de 'pg' no están en este paquete).
type PoolClient = Awaited<ReturnType<Pool['connect']>>;

/**
 * SQL de `portal.password_reset_tokens` y la transacción de restablecer.
 * Parámetros posicionales siempre. Todas las horas llegan como `now` desde el
 * servicio (reloj inyectable): aquí no se usa now() de la BD para decidir nada.
 */
export class PasswordResetRepository implements PasswordResetStore {
  constructor(private readonly pool: Pool) {}

  async findUserByEmail(email: string): Promise<ResetUser | null> {
    const { rows } = await this.pool.query(
      `SELECT id, email, full_name, status FROM portal.users WHERE email = $1`,
      [email.trim().toLowerCase()],
    );
    const row = rows[0] as { id: string; email: string; full_name: string; status: UserStatus } | undefined;
    return row ? { id: row.id, email: row.email, fullName: row.full_name, status: row.status } : null;
  }

  async recentTokenStats(userId: string, since: Date): Promise<TokenStats> {
    const { rows } = await this.pool.query(
      `SELECT max(created_at) AS last_created_at,
              (count(*) FILTER (WHERE created_at >= $2))::int AS count_since
         FROM portal.password_reset_tokens
        WHERE user_id = $1`,
      [userId, since],
    );
    const row = rows[0] as { last_created_at: Date | string | null; count_since: number };
    return {
      lastCreatedAt: row.last_created_at === null ? null : new Date(row.last_created_at),
      countSince: row.count_since,
    };
  }

  async createToken({ userId, tokenHash, expiresAt, now }: CreateTokenInput): Promise<void> {
    await this.transaction(async (client) => {
      // Un enlace nuevo anula los anteriores sin usar de la misma cuenta.
      await client.query(
        `UPDATE portal.password_reset_tokens SET used_at = $2 WHERE user_id = $1 AND used_at IS NULL`,
        [userId, now],
      );
      // Limpieza de paso: los caducados hace más de un día, de cualquier cuenta.
      await client.query(
        `DELETE FROM portal.password_reset_tokens WHERE expires_at < $1::timestamptz - interval '24 hours'`,
        [now],
      );
      await client.query(
        `INSERT INTO portal.password_reset_tokens (user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4)`,
        [userId, tokenHash, expiresAt, now],
      );
    });
  }

  async consumeAndSetPassword({ tokenHash, passwordHash, now }: ConsumeTokenInput): Promise<ResetUserRef | null> {
    return this.transaction(
      async (client) => {
        // Una sola sentencia condicionada: si dos peticiones usan el mismo token
        // a la vez, la segunda espera al bloqueo de la fila, vuelve a evaluar
        // `used_at IS NULL` y no encuentra nada. No pueden ganar las dos.
        const consumed = await client.query(
          `UPDATE portal.password_reset_tokens
              SET used_at = $2
            WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
        RETURNING user_id`,
          [tokenHash, now],
        );
        const userId = (consumed.rows[0] as { user_id: string } | undefined)?.user_id;
        if (!userId) return null;

        const found = await client.query(
          `SELECT email, full_name, status FROM portal.users WHERE id = $1 FOR UPDATE`,
          [userId],
        );
        const user = found.rows[0] as { email: string; full_name: string; status: UserStatus } | undefined;
        // Una cuenta que dejó de estar activa no restablece: ROLLBACK, y el token queda como estaba.
        if (!user || user.status !== 'active') return null;

        // Misma semántica que UserRepository.updatePassword (SEC-220): la clave y
        // token_version van juntas, así que restablecer cierra todas las sesiones.
        await client.query(
          `UPDATE portal.users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1`,
          [userId, passwordHash],
        );
        await client.query(
          `UPDATE portal.password_reset_tokens SET used_at = $2 WHERE user_id = $1 AND used_at IS NULL`,
          [userId, now],
        );
        return { userId, email: user.email, fullName: user.full_name };
      },
      (result) => result !== null,
    );
  }

  /**
   * BEGIN, el trabajo y COMMIT si `commitIf` lo aprueba (ROLLBACK si no). Un
   * error hace ROLLBACK y se propaga. Mismo estilo que
   * UserRepository.withTransaction, con la salida de deshacer sin lanzar.
   */
  private async transaction<T>(
    fn: (client: PoolClient) => Promise<T>,
    commitIf: (result: T) => boolean = () => true,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query(commitIf(result) ? 'COMMIT' : 'ROLLBACK');
      return result;
    } catch (err) {
      // Si el ROLLBACK también falla, no debe tapar el error original.
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
