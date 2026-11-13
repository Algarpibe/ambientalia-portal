import type { UserStatus } from '../users.types.js';
import type {
  ConsumeTokenInput,
  CreateTokenInput,
  PasswordResetStore,
  ResetEmail,
  ResetMailer,
  ResetUser,
  ResetUserRef,
  TokenStats,
} from './password-reset.service.js';

// Solo para los tests de la recuperación de contraseña (servicio y router).
// Dobles en memoria de los dos puertos del servicio y un reloj que se mueve a
// mano. FakeStore imita la semántica del SQL de password-reset.repository.ts,
// la que vigila password-reset.repository.db.test.ts contra Postgres: si uno
// cambia, el otro también.

const DAY_MS = 24 * 60 * 60_000;

export interface FakeUser extends ResetUser {
  passwordHash: string;
  tokenVersion: number;
}

export interface FakeToken {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export class FakeStore implements PasswordResetStore {
  users: FakeUser[] = [];
  tokens: FakeToken[] = [];
  private seq = 0;

  addUser({ email, fullName = 'Ana Ruiz', status = 'active' }: { email: string; fullName?: string; status?: UserStatus }): FakeUser {
    const user: FakeUser = {
      id: `user-${++this.seq}`,
      email: email.trim().toLowerCase(),
      fullName,
      status,
      passwordHash: 'hash-viejo',
      tokenVersion: 0,
    };
    this.users.push(user);
    return user;
  }

  userById(id: string): FakeUser {
    const user = this.users.find((u) => u.id === id);
    if (!user) throw new Error(`FakeStore: no existe el usuario ${id}`);
    return user;
  }

  async findUserByEmail(email: string): Promise<ResetUser | null> {
    const u = this.users.find((x) => x.email === email.trim().toLowerCase());
    return u ? { id: u.id, email: u.email, fullName: u.fullName, status: u.status } : null;
  }

  async recentTokenStats(userId: string, since: Date): Promise<TokenStats> {
    const suyos = this.tokens.filter((t) => t.userId === userId);
    const lastCreatedAt = suyos.reduce<Date | null>(
      (max, t) => (max === null || t.createdAt.getTime() > max.getTime() ? t.createdAt : max),
      null,
    );
    return { lastCreatedAt, countSince: suyos.filter((t) => t.createdAt.getTime() >= since.getTime()).length };
  }

  async createToken({ userId, tokenHash, expiresAt, now }: CreateTokenInput): Promise<void> {
    for (const t of this.tokens) if (t.userId === userId && t.usedAt === null) t.usedAt = now;
    this.tokens = this.tokens.filter((t) => t.expiresAt.getTime() >= now.getTime() - DAY_MS);
    this.tokens.push({ userId, tokenHash, expiresAt, usedAt: null, createdAt: now });
  }

  async consumeAndSetPassword({ tokenHash, passwordHash, now }: ConsumeTokenInput): Promise<ResetUserRef | null> {
    const token = this.tokens.find(
      (t) => t.tokenHash === tokenHash && t.usedAt === null && t.expiresAt.getTime() > now.getTime(),
    );
    if (!token) return null;
    const user = this.users.find((u) => u.id === token.userId);
    // La transacción de verdad hace ROLLBACK: ni el token ni la clave cambian.
    if (!user || user.status !== 'active') return null;
    token.usedAt = now;
    user.passwordHash = passwordHash;
    user.tokenVersion += 1;
    for (const t of this.tokens) if (t.userId === user.id && t.usedAt === null) t.usedAt = now;
    return { userId: user.id, email: user.email, fullName: user.fullName };
  }
}

export class FakeMailer implements ResetMailer {
  sent: ResetEmail[] = [];
  /** Con true, `send` rechaza (el mailer de verdad no lo hace nunca). */
  fail = false;

  async send(email: ResetEmail): Promise<void> {
    if (this.fail) throw new Error('n8n caído');
    this.sent.push(email);
  }
}

export class FakeClock {
  constructor(private t: number) {}

  readonly now = (): Date => new Date(this.t);

  advance(ms: number): void {
    this.t += ms;
  }

  set(ms: number): void {
    this.t = ms;
  }
}
