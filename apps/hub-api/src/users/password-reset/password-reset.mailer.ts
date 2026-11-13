import { captureError } from '../../sentry.js';
import { logEvent, type ResetEmail, type ResetLog, type ResetMailer } from './password-reset.service.js';

/**
 * Cliente del webhook de n8n que envía los correos de la recuperación de
 * contraseña (flujo «Portal — Restablecer contraseña»: Webhook con Header Auth
 * → Gmail → Respond 200). Mismo patrón que el canal de avisos de Trazabilidad:
 * POST JSON, token en una cabecera, sin seguir redirecciones (el token y el
 * enlace no viajan a otro sitio) y con una espera máxima.
 *
 * NUNCA lanza. Quien pidió el enlace ya tiene su respuesta y nadie reintenta:
 * si n8n falla (red, espera agotada, respuesta que no es 2xx), queda el log
 * `password_reset_envio_fallido` y captureError, y la persona vuelve a pedirlo.
 * Sin PASSWORD_RESET_N8N_URL o PASSWORD_RESET_N8N_TOKEN no sale nada y queda
 * `password_reset_sin_configurar`. El correo de la persona nunca va al log.
 */

/** Cuánto se espera, como mucho, la respuesta de n8n. */
export const MAILER_TIMEOUT_MS = 10_000;
/** La cabecera del token: la credencial Header Auth del Webhook de n8n la comprueba. */
export const TOKEN_HEADER = 'X-Password-Reset-Token';

type Env = Readonly<Record<string, string | undefined>>;
type Net = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Las dos variables, leídas una a una por su nombre: así las ve el detector de
 * `.env.example` (INFRA-537), que no entiende `process.env` suelto.
 */
const envFromProcess = (): Env => ({
  PASSWORD_RESET_N8N_URL: process.env.PASSWORD_RESET_N8N_URL,
  PASSWORD_RESET_N8N_TOKEN: process.env.PASSWORD_RESET_N8N_TOKEN,
});

export interface ResetMailerOptions {
  env?: Env;
  net?: Net;
  log?: ResetLog;
  report?: (error: unknown, context: Record<string, unknown>) => void;
}

/**
 * El mailer de verdad. En producción, con el entorno del proceso y el `fetch`
 * de Node; las pruebas le pasan los suyos. Lee el entorno una vez, al crearse
 * (al arrancar hub-api): cambiarlo es cambiar la variable y desplegar.
 */
export function createResetMailer({
  env = envFromProcess(),
  net = fetch,
  log = logEvent,
  report = captureError,
}: ResetMailerOptions = {}): ResetMailer {
  const url = (env.PASSWORD_RESET_N8N_URL ?? '').trim();
  const token = (env.PASSWORD_RESET_N8N_TOKEN ?? '').trim();
  return {
    async send({ para, asunto, cuerpo }: ResetEmail): Promise<void> {
      if (url === '' || token === '') {
        log('password_reset_sin_configurar');
        return;
      }
      try {
        const res = await net(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [TOKEN_HEADER]: token },
          body: JSON.stringify({ para, asunto, cuerpo }),
          // Sin seguir redirecciones: el token y el enlace no deben viajar a otro sitio.
          redirect: 'manual',
          signal: AbortSignal.timeout(MAILER_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`El webhook de n8n respondió ${res.status}`);
      } catch (e) {
        log('password_reset_envio_fallido', { motivo: e instanceof Error ? e.message : String(e) });
        report(e, { endpoint: 'password_reset_mailer' });
      }
    },
  };
}
