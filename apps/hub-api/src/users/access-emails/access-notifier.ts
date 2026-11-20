import { logEvent, type ResetLog, type ResetMailer } from '../password-reset/password-reset.service.js';
import type { UserPublic, UserStatus } from '../users.types.js';
import { buildNewAppsEmail, buildReactivatedEmail, buildWelcomeEmail, type AccessEmailContent } from './access-emails.js';
import { knownApps } from './app-catalog.js';

/**
 * Correos de acceso al portal (spec 2026-11-20): bienvenida al aprobar una
 * cuenta, reactivación y apps nuevas. Aplica las reglas de cuándo sale cada uno
 * (§3), arma el correo y lo entrega al mailer de la recuperación de contraseña,
 * que habla con el mismo flujo de n8n. Lo llama el router de usuarios DESPUÉS de
 * responder al admin.
 *
 * NUNCA lanza, y cada llamada deja exactamente una línea de log, siempre con el
 * user_id y nunca con el correo: user_access_email_sent (con `kind`),
 * user_access_email_skipped (con `reason`) o user_access_email_failed.
 *
 * El mailer de verdad tampoco lanza: si n8n falla, deja su propia línea
 * (password_reset_envio_fallido, nombre histórico) y aquí queda
 * user_access_email_sent, que significa «entregado al mailer».
 */

/** Lo que el notificador necesita saber de la cuenta. */
export interface AccessUser {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
}

export interface StatusChangedInput {
  /** La cuenta, ya cambiada. */
  user: AccessUser;
  /** El estado ANTES del cambio: decide entre bienvenida (pending) y reactivación (inactive). */
  previousStatus: UserStatus;
  /** Los ids de las apps que la cuenta tiene ahora (portal.user_apps). */
  apps: string[];
}

export interface AppsChangedInput {
  user: AccessUser;
  /** Los ids de las apps antes de guardar. */
  before: string[];
  /** Los ids tal como quedaron guardados. */
  after: string[];
  /** El admin se ha cambiado sus propias apps. */
  isSelf: boolean;
}

export type AccessEmailKind = 'welcome' | 'reactivated' | 'new_apps';
export type AccessSkipReason = 'not_active' | 'self' | 'no_new_apps' | 'no_known_apps' | 'no_transition';

export interface AccessNotifierDeps {
  /** El puerto de la recuperación de contraseña; el de verdad es createResetMailer(). */
  mailer: ResetMailer;
  /** Base pública del portal (urlPortal()). */
  portalUrl: string;
  log?: ResetLog;
}

/** O un correo que enviar, o el motivo para no enviarlo. */
type Decision = { kind: AccessEmailKind; email: AccessEmailContent } | { reason: AccessSkipReason };

/** Lo que el notificador necesita de una cuenta tal como la devuelve UserService. */
export function toAccessUser(user: UserPublic): AccessUser {
  return { id: user.id, email: user.email, fullName: user.full_name, status: user.status };
}

export class AccessNotifier {
  private readonly mailer: ResetMailer;
  private readonly portalUrl: string;
  private readonly log: ResetLog;

  constructor(deps: AccessNotifierDeps) {
    this.mailer = deps.mailer;
    this.portalUrl = deps.portalUrl;
    this.log = deps.log ?? logEvent;
  }

  /**
   * Tras pasar una cuenta a active: bienvenida si venía de pending, reactivación
   * si venía de inactive. Desde active no hay correo (el router trata `{active}`
   * sobre una cuenta activa como una reactivación, pero no ha cambiado nada).
   * Las dos listan las apps que la cuenta tiene AHORA: quien recibió apps
   * estando pending o inactive se entera aquí.
   */
  async statusChanged({ user, previousStatus, apps }: StatusChangedInput): Promise<void> {
    await this.notify(user, () => {
      const input = { fullName: user.fullName, portalUrl: this.portalUrl, apps: knownApps(apps) };
      if (previousStatus === 'pending') return { kind: 'welcome', email: buildWelcomeEmail(input) };
      if (previousStatus === 'inactive') return { kind: 'reactivated', email: buildReactivatedEmail(input) };
      return { reason: 'no_transition' };
    });
  }

  /**
   * Tras guardar las apps de una cuenta: correo con las que gana. Quitar apps o
   * guardar la misma lista no avisa; tampoco a quien no puede entrar (pending o
   * inactive) ni al admin que se cambia las suyas.
   */
  async appsChanged({ user, before, after, isSelf }: AppsChangedInput): Promise<void> {
    await this.notify(user, () => {
      if (isSelf) return { reason: 'self' };
      if (user.status !== 'active') return { reason: 'not_active' };
      const antes = new Set(before);
      const nuevas = after.filter((id) => !antes.has(id));
      if (nuevas.length === 0) return { reason: 'no_new_apps' };
      const conocidas = knownApps(nuevas);
      if (conocidas.length === 0) return { reason: 'no_known_apps' };
      return {
        kind: 'new_apps',
        email: buildNewAppsEmail({ fullName: user.fullName, portalUrl: this.portalUrl, apps: conocidas }),
      };
    });
  }

  /** Decide, envía y deja SIEMPRE una línea de log. Nada de aquí dentro sale como excepción. */
  private async notify(user: AccessUser, decide: () => Decision): Promise<void> {
    let kind: AccessEmailKind | undefined;
    try {
      const decision = decide();
      if ('reason' in decision) {
        this.log('user_access_email_skipped', { user_id: user.id, reason: decision.reason });
        return;
      }
      kind = decision.kind;
      await this.mailer.send({ para: user.email, ...decision.email });
      this.log('user_access_email_sent', { user_id: user.id, kind });
    } catch (e) {
      this.log('user_access_email_failed', { user_id: user.id, kind, motivo: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** Lo que el router de usuarios necesita del notificador (los tests le pasan un doble). */
export type AccessNotifierActions = Pick<AccessNotifier, 'statusChanged' | 'appsChanged'>;
