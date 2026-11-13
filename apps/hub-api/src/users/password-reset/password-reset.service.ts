import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { BCRYPT_COST, MIN_PASSWORD_LENGTH } from '../users.service.js';
import type { UserStatus } from '../users.types.js';
import { buildPasswordChangedEmail, buildResetLinkEmail } from './password-reset.emails.js';

/**
 * Reglas de la recuperación de contraseña por correo (spec 2026-11-13): quién
 * recibe enlace, los frenos por cuenta, la caducidad y la validación de la
 * clave nueva. No sabe de SQL ni de red: habla con el repositorio y con el
 * correo a través de los dos puertos de abajo, y recibe el reloj para que los
 * tests controlen el tiempo.
 */

/** Cuánto vale un enlace. */
export const RESET_TOKEN_TTL_MS = 30 * 60_000;
/** Freno por cuenta: no sale otro enlace si el último salió hace menos de esto. */
export const MIN_REQUEST_INTERVAL_MS = 2 * 60_000;
/** Freno por cuenta: enlaces como mucho en la última hora. */
export const MAX_REQUESTS_PER_HOUR = 5;
const HOUR_MS = 60 * 60_000;
/** Formato exacto de generateToken: 32 bytes en base64url sin relleno. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** Lo que hace falta saber de la cuenta para decidir si se manda el enlace. */
export interface ResetUser {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
}

/** A quién se le acaba de cambiar la contraseña (para el aviso). */
export interface ResetUserRef {
  userId: string;
  email: string;
  fullName: string;
}

/** Cuándo se creó el último enlace de la cuenta y cuántos desde `since`. */
export interface TokenStats {
  lastCreatedAt: Date | null;
  countSince: number;
}

export interface CreateTokenInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
}

export interface ConsumeTokenInput {
  tokenHash: string;
  passwordHash: string;
  now: Date;
}

/** Puerto del repositorio: lo implementan PasswordResetRepository (SQL) y, en los tests, FakeStore. */
export interface PasswordResetStore {
  findUserByEmail(email: string): Promise<ResetUser | null>;
  recentTokenStats(userId: string, since: Date): Promise<TokenStats>;
  /** En una transacción: anula los enlaces sin usar de la cuenta, borra los caducados hace más de un día y guarda el nuevo. */
  createToken(input: CreateTokenInput): Promise<void>;
  /**
   * En una transacción: gasta el token si vale, comprueba que la cuenta siga
   * activa, cambia la clave subiendo token_version y anula los demás enlaces.
   * null (y nada cambia) si el token no vale o la cuenta ya no está activa.
   */
  consumeAndSetPassword(input: ConsumeTokenInput): Promise<ResetUserRef | null>;
}

/** Un correo listo para el webhook de n8n. */
export interface ResetEmail {
  para: string;
  asunto: string;
  cuerpo: string;
}

/** Puerto del correo. El de verdad (createResetMailer) nunca rechaza. */
export interface ResetMailer {
  send(email: ResetEmail): Promise<void>;
}

/** Una línea de log estructurada: el evento y sus datos (nunca el correo de la persona). */
export type ResetLog = (event: string, data?: Record<string, unknown>) => void;

export const logEvent: ResetLog = (event, data = {}) => {
  console.log(JSON.stringify({ event, ...data }));
};

export type PasswordResetErrorCode = 'password_too_short' | 'invalid_or_expired_token';

/** Error de negocio de restablecer; el router lo traduce a `400 { error: code }`. */
export class PasswordResetError extends Error {
  readonly status = 400;

  constructor(public readonly code: PasswordResetErrorCode) {
    super(code);
    this.name = 'PasswordResetError';
  }
}

/** La huella que se guarda en la BD: SHA-256 en hex. Sin sal ni bcrypt: el token ya trae 256 bits de azar. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 32 bytes aleatorios en base64url: el valor que solo viaja en el enlace del correo. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface PasswordResetDeps {
  store: PasswordResetStore;
  mailer: ResetMailer;
  now: () => Date;
  /** Base pública del portal (urlPortal()). */
  portalUrl: string;
  /** Solo para los tests; el servidor usa BCRYPT_COST, el mismo que el registro. */
  bcryptCost?: number;
  /** Solo para los tests; el servidor usa generateToken. */
  randomToken?: () => string;
  log?: ResetLog;
}

export class PasswordResetService {
  private readonly store: PasswordResetStore;
  private readonly mailer: ResetMailer;
  private readonly now: () => Date;
  private readonly portalUrl: string;
  private readonly bcryptCost: number;
  private readonly randomToken: () => string;
  private readonly log: ResetLog;

  constructor(deps: PasswordResetDeps) {
    this.store = deps.store;
    this.mailer = deps.mailer;
    this.now = deps.now;
    this.portalUrl = deps.portalUrl;
    this.bcryptCost = deps.bcryptCost ?? BCRYPT_COST;
    this.randomToken = deps.randomToken ?? generateToken;
    this.log = deps.log ?? logEvent;
  }

  /**
   * Pide un enlace. Nunca delata si la cuenta existe: el router ya respondió
   * antes de llamar aquí, y los casos que no mandan nada (desconocida, no
   * activa, frenada) terminan en silencio. Solo rechaza ante un fallo de
   * verdad (la BD), que el router manda al log.
   */
  async requestReset(email: string): Promise<void> {
    const user = await this.store.findUserByEmail(email.trim().toLowerCase());
    // Una cuenta pending o inactive no podría entrar aunque cambiara la clave.
    if (!user || user.status !== 'active') return;

    const now = this.now();
    const stats = await this.store.recentTokenStats(user.id, new Date(now.getTime() - HOUR_MS));
    const muyPronto =
      stats.lastCreatedAt !== null && now.getTime() - stats.lastCreatedAt.getTime() < MIN_REQUEST_INTERVAL_MS;
    if (muyPronto || stats.countSince >= MAX_REQUESTS_PER_HOUR) {
      this.log('password_reset_frenado', { user_id: user.id });
      return;
    }

    const token = this.randomToken();
    // A la BD solo llega la huella: el token en claro vive en el correo y en ningún otro sitio.
    await this.store.createToken({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
      now,
    });
    await this.mailer.send({
      para: user.email,
      ...buildResetLinkEmail({ fullName: user.fullName, portalUrl: this.portalUrl, token }),
    });
    this.log('password_reset_requested', { user_id: user.id });
  }

  /**
   * Cambia la clave con un enlace. Recibe el cuerpo tal cual (por eso `unknown`)
   * y lanza PasswordResetError si la clave es corta o el enlace no vale.
   * Cierra todas las sesiones (token_version) y no inicia ninguna.
   */
  async resetPassword(token: unknown, newPassword: unknown): Promise<void> {
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new PasswordResetError('password_too_short');
    }
    // Un token que no tiene el formato del generado no puede existir: se
    // rechaza antes de gastar un bcrypt de coste 12 con basura.
    if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) {
      throw new PasswordResetError('invalid_or_expired_token');
    }

    // bcrypt ANTES de la transacción: son cientos de milisegundos que no deben
    // pasarse con filas bloqueadas.
    const passwordHash = await bcrypt.hash(newPassword, this.bcryptCost);
    const now = this.now();
    const user = await this.store.consumeAndSetPassword({ tokenHash: hashToken(token), passwordHash, now });
    if (!user) throw new PasswordResetError('invalid_or_expired_token');

    this.log('password_reset_completed', { user_id: user.userId });
    // El aviso sale sin esperar: la respuesta no depende de él, y un fallo del
    // correo no deshace un cambio que ya está confirmado en la BD. El mailer de
    // verdad nunca rechaza; el catch cubre a cualquier otro que lo hiciera.
    // Promise.resolve().then: si armar el correo o send lanzaran de forma
    // síncrona, tampoco puede escapar nada hacia la petición ya confirmada.
    void Promise.resolve()
      .then(() =>
        this.mailer.send({ para: user.email, ...buildPasswordChangedEmail({ fullName: user.fullName, changedAt: now }) }),
      )
      .catch(() => this.log('password_reset_envio_fallido', { user_id: user.userId }));
  }
}
