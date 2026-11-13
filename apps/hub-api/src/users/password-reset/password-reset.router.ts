import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { captureError } from '../../sentry.js';
import { PasswordResetError, type PasswordResetService } from './password-reset.service.js';

// Las dos rutas de la recuperación de contraseña, montadas bajo `/api` (ver
// index.ts). Sin sesión, como /api/login y /api/auth/register: quien las usa no
// puede iniciarla. Cada una con su rate limit por IP (clave por defecto
// `req.ip`; `trust proxy 1` ya está puesto en index.ts), creado DENTRO de la
// fábrica para que cada router —y cada test— empiece de cero. El limitador
// global de /api/ (60/min) les aplica además.

export const LIMIT_WINDOW_MS = 15 * 60_000;
export const FORGOT_LIMIT = 5;
export const RESET_LIMIT = 10;
/** Máximo de una dirección de correo (RFC 5321): más largo no puede ser una cuenta. */
export const MAX_EMAIL_LENGTH = 320;

/** Lo que el router necesita del servicio (los tests le pasan un stub). */
export type PasswordResetActions = Pick<PasswordResetService, 'requestReset' | 'resetPassword'>;

export function createPasswordResetRouter(service: PasswordResetActions): Router {
  const router = Router();
  const limitOptions = {
    windowMs: LIMIT_WINDOW_MS,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many requests' },
  };
  const forgotLimiter = rateLimit({ ...limitOptions, max: FORGOT_LIMIT });
  const resetLimiter = rateLimit({ ...limitOptions, max: RESET_LIMIT });

  // POST /api/auth/forgot-password { email } — responde YA, sea cual sea el
  // caso, y trabaja después: así el tiempo de respuesta no delata si la cuenta
  // existe. Los fallos de después van al log y a captureError.
  router.post('/auth/forgot-password', forgotLimiter, (req: Request, res: Response) => {
    const { email } = (req.body ?? {}) as { email?: unknown };
    if (typeof email !== 'string' || email.trim() === '' || email.length > MAX_EMAIL_LENGTH) {
      res.status(400).json({ error: 'missing_email' });
      return;
    }
    res.json({ message: 'reset_requested' });
    // Promise.resolve().then: si requestReset lanzara de forma síncrona (el
    // puerto no lo garantiza async), el error tampoco escapa de la petición.
    void Promise.resolve().then(() => service.requestReset(email)).catch((e: unknown) => {
      console.error('forgot_password error', e);
      captureError(e, { endpoint: 'forgot_password' });
    });
  });

  // POST /api/auth/reset-password { token, newPassword } — 400 con el código de
  // PasswordResetError (nunca 401: el interceptor del portal lo tomaría por una
  // sesión caducada); cualquier otro error, 500 genérico.
  router.post('/auth/reset-password', resetLimiter, async (req: Request, res: Response) => {
    const { token, newPassword } = (req.body ?? {}) as { token?: unknown; newPassword?: unknown };
    try {
      await service.resetPassword(token, newPassword);
      res.json({ message: 'password_reset' });
    } catch (e) {
      if (e instanceof PasswordResetError) {
        res.status(e.status).json({ error: e.code });
        return;
      }
      console.error('reset_password error', e);
      captureError(e, { endpoint: 'reset_password' });
      res.status(500).json({ error: 'internal error' });
    }
  });

  return router;
}
