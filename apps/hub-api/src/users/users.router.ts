import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { Pool } from '@algarpibe/zoho-sync';
import { UserRepository } from './users.repository.js';
import { UserService, UserError } from './users.service.js';
import { AuditLogger } from './audit.logger.js';
import { requireAuth, requireAdmin, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import type { AuditOperation } from './users.types.js';
import { toAccessUser, type AccessNotifierActions } from './access-emails/access-notifier.js';

// Router de gestión de usuarios, montado bajo `/api` (ver index.ts). Todas las
// rutas admin exigen requireAdmin. Cada mutación exitosa emite un audit log.

/** Traduce un UserError a su HTTP; cualquier otro error → 500 genérico. */
function sendError(res: Response, e: unknown, ctx: string): void {
  if (e instanceof UserError) {
    const body: Record<string, string> = { error: e.code };
    if (e.field) body.field = e.field;
    res.status(e.status).json(body);
    return;
  }
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

/** Lo que el router recibe además del pool. Todo opcional: sin ello, hace lo de siempre. */
export interface UsersRouterDeps {
  /**
   * Correos de acceso (bienvenida, reactivación y apps nuevas). Sin él no se
   * avisa a nadie: así lo montan los tests que no van de esto.
   */
  notifier?: AccessNotifierActions;
}

export function createUsersRouter(pool: Pool, deps: UsersRouterDeps = {}): Router {
  const router = Router();
  const service = new UserService(new UserRepository(pool));

  /**
   * Lanza un correo de acceso DESPUÉS de responder al admin y sin esperarlo: la
   * respuesta no depende de n8n. `Promise.resolve().then(...)` recoge también un
   * fallo síncrono del notificador, igual que en la recuperación de contraseña.
   * Un fallo solo queda en el log y en Sentry.
   */
  const avisar = (endpoint: string, aviso: (notifier: AccessNotifierActions) => Promise<void>): void => {
    const { notifier } = deps;
    if (!notifier) return;
    void Promise.resolve()
      .then(() => aviso(notifier))
      .catch((e: unknown) => {
        console.error(`${endpoint} error`, e);
        captureError(e, { endpoint });
      });
  };

  // SEC — rate limiting por IP (Req 5.4). 429 con cuerpo JSON estándar.
  const limitOptions = { windowMs: 60_000, standardHeaders: true, legacyHeaders: false, message: { error: 'too many requests' } };
  const registerLimiter = rateLimit({ ...limitOptions, max: 5 }); // registro
  const adminLimiter = rateLimit({ ...limitOptions, max: 20 }); // gestión de usuarios

  // Rate limit ANTES de la auth para todo /api/users/* (Req 5.4).
  router.use('/users', adminLimiter);

  // POST /api/auth/register — registro por autoservicio, sin autenticación.
  // Éxito → 201 y estado pending (no emite JWT). Validación → 400; duplicado → 409.
  // No se audita: no es una operación de admin (no hay adminEmail).
  router.post('/auth/register', registerLimiter, async (req: Request, res: Response) => {
    try {
      const { fullName, email, password } = (req.body ?? {}) as {
        fullName?: string;
        email?: string;
        password?: string;
      };
      const user = await service.register({ fullName: fullName!, email: email!, password: password! });
      res.status(201).json({ message: 'registration_pending', userId: user.id });
    } catch (e) {
      sendError(res, e, 'register');
    }
  });

  // GET /api/users/me — perfil propio (nombre, email, rol, avatar, alta).
  router.get('/users/me', requireAuth, async (req: Request, res: Response) => {
    const payload = getPayload(req);
    if (!payload?.user_id) return void res.status(401).json({ error: 'unauthorized' });
    try {
      res.json(await service.getSelfProfile(payload.user_id));
    } catch (e) {
      sendError(res, e, 'get_self_profile');
    }
  });

  // No hay PATCH /users/me/profile: el nombre completo queda fijado con lo que se
  // escribió en el registro. Es el nombre con el que la persona firma las
  // aprobaciones de ausencias (se guarda como `decisor_nombre`), así que dejar
  // que cada cual se renombre reescribiría a posteriori quién aparece en
  // decisiones ya tomadas. Mismo trato que el correo, que tampoco se edita.

  // PATCH /api/users/me/avatar { avatar } — data URL de imagen (thumbnail).
  router.patch('/users/me/avatar', requireAuth, async (req: Request, res: Response) => {
    const payload = getPayload(req);
    if (!payload?.user_id) return void res.status(401).json({ error: 'unauthorized' });
    try {
      await service.updateAvatar(payload.user_id, (req.body ?? {}).avatar);
      res.json({ message: 'avatar_updated' });
    } catch (e) {
      sendError(res, e, 'update_avatar');
    }
  });

  // GET /api/users/me/preferences — preferencias de UI propias (blob JSON libre).
  router.get('/users/me/preferences', requireAuth, async (req: Request, res: Response) => {
    const payload = getPayload(req);
    if (!payload?.user_id) return void res.status(401).json({ error: 'unauthorized' });
    try {
      res.json({ preferences: await service.getPreferences(payload.user_id) });
    } catch (e) {
      sendError(res, e, 'get_preferences');
    }
  });

  // PATCH /api/users/me/preferences { ...parche } — fusiona (no reemplaza), para que
  // cada app escriba su propia clave sin pisar las de las demás.
  router.patch('/users/me/preferences', requireAuth, async (req: Request, res: Response) => {
    const payload = getPayload(req);
    if (!payload?.user_id) return void res.status(401).json({ error: 'unauthorized' });
    try {
      const preferences = await service.updatePreferences(payload.user_id, req.body);
      res.json({ message: 'preferences_updated', preferences });
    } catch (e) {
      sendError(res, e, 'update_preferences');
    }
  });

  // PATCH /api/users/me/password — el usuario autenticado cambia su propia clave.
  // El objetivo es el user_id del JWT (no un :id de ruta), así que basta
  // requireAuth. changePassword verifica la contraseña actual con bcrypt. No se
  // audita (no es una acción de gestión administrativa).
  router.patch('/users/me/password', requireAuth, async (req: Request, res: Response) => {
    const payload = getPayload(req);
    if (!payload?.user_id) return void res.status(401).json({ error: 'unauthorized' });
    const { currentPassword, newPassword } = (req.body ?? {}) as {
      currentPassword?: string;
      newPassword?: string;
    };
    try {
      await service.changePassword(payload.user_id, String(currentPassword ?? ''), String(newPassword ?? ''));
      res.json({ message: 'password_updated' });
    } catch (e) {
      sendError(res, e, 'change_password');
    }
  });

  // POST /api/auth/logout — cierra la sesión de verdad (SEC-220). Incrementa
  // token_version, así que TODOS los tokens vivos de esa persona dejan de valer
  // en su siguiente petición, no solo el de la pestaña actual. El frontend
  // borra además el token de localStorage; esto es lo que hace que borrarlo
  // signifique algo.
  //
  // No se audita: no es una acción de gestión administrativa (no hay adminEmail),
  // igual que el cambio de contraseña propio.
  router.post('/auth/logout', requireAuth, async (req: Request, res: Response) => {
    const payload = getPayload(req);
    if (!payload?.user_id) return void res.status(401).json({ error: 'unauthorized' });
    try {
      await service.logout(payload.user_id);
      res.json({ message: 'logged_out' });
    } catch (e) {
      sendError(res, e, 'logout');
    }
  });

  // GET /api/users?page=N — lista paginada (50/página).
  router.get('/users', requireAdmin, async (req: Request, res: Response) => {
    try {
      const page = Number.parseInt(String(req.query.page ?? '1'), 10) || 1;
      res.json(await service.listUsers(page));
    } catch (e) {
      sendError(res, e, 'list_users');
    }
  });

  // PATCH /api/users/:id/status { status: 'active' | 'inactive' }
  // 'active' sobre pending = aprobar (rol reader); sobre inactive = reactivar.
  router.patch('/users/:id/status', requireAdmin, async (req: Request, res: Response) => {
    const admin = getPayload(req);
    if (!admin) return void res.status(401).json({ error: 'unauthorized' });
    const { id } = req.params;
    const status = (req.body ?? {}).status;
    try {
      const current = await service.getUser(id); // 404 si no existe
      let user;
      let operation: AuditOperation;
      if (status === 'active') {
        if (current.status === 'pending') {
          user = await service.approve(id);
          operation = 'approve_user';
        } else {
          user = await service.reactivate(id);
          operation = 'reactivate_user';
        }
      } else if (status === 'inactive') {
        user = await service.deactivate(id, admin.user_id);
        operation = 'deactivate_user';
      } else {
        return void res.status(400).json({ error: 'invalid_status', field: 'status' });
      }
      AuditLogger.log({ adminEmail: admin.sub, targetEmail: user.email, operation });
      res.json({ message: 'status_updated', user });
      // Correo de acceso: bienvenida si venía de pending, reactivación si venía de
      // inactive (desde active no sale nada: lo decide el notificador). Lleva las
      // apps que la cuenta tiene AHORA, que se leen ya fuera de la respuesta.
      if (status === 'active') {
        const destinatario = toAccessUser(user);
        const previousStatus = current.status;
        avisar('access_email_status', async (notifier) =>
          notifier.statusChanged({ user: destinatario, previousStatus, apps: await service.getUserApps(id) }),
        );
      }
    } catch (e) {
      sendError(res, e, 'update_status');
    }
  });

  // PATCH /api/users/:id/role { role: 'admin' | 'reader' }
  router.patch('/users/:id/role', requireAdmin, async (req: Request, res: Response) => {
    const admin = getPayload(req);
    if (!admin) return void res.status(401).json({ error: 'unauthorized' });
    try {
      const user = await service.changeRole(req.params.id, (req.body ?? {}).role);
      AuditLogger.log({ adminEmail: admin.sub, targetEmail: user.email, operation: 'change_role' });
      res.json({ message: 'role_updated', user });
    } catch (e) {
      sendError(res, e, 'change_role');
    }
  });

  // GET /api/users/:id/apps — apps asignadas (para precargar el modal de asignación).
  router.get('/users/:id/apps', requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json({ apps: await service.getUserApps(req.params.id) });
    } catch (e) {
      sendError(res, e, 'get_apps');
    }
  });

  // PUT /api/users/:id/apps { apps: string[] }
  router.put('/users/:id/apps', requireAdmin, async (req: Request, res: Response) => {
    const admin = getPayload(req);
    if (!admin) return void res.status(401).json({ error: 'unauthorized' });
    const { id } = req.params;
    try {
      const target = await service.getUser(id); // 404 + email para auditoría
      // Las de antes, para que el correo sepa cuáles son nuevas. Va antes de
      // guardar, así que sí forma parte de la petición.
      const before = await service.getUserApps(id);
      const apps = await service.setApps(id, (req.body ?? {}).apps);
      AuditLogger.log({ adminEmail: admin.sub, targetEmail: target.email, operation: 'update_apps' });
      res.json({ message: 'apps_updated', apps });
      // Correo de apps nuevas: el notificador decide (cuenta activa, que no sea la
      // del propio admin, y al menos una app conocida que no tuviera).
      const destinatario = toAccessUser(target);
      const isSelf = id === admin.user_id;
      avisar('access_email_apps', (notifier) => notifier.appsChanged({ user: destinatario, before, after: apps, isSelf }));
    } catch (e) {
      sendError(res, e, 'update_apps');
    }
  });

  // DELETE /api/users/:id — borrado permanente (con auto-protección del admin).
  router.delete('/users/:id', requireAdmin, async (req: Request, res: Response) => {
    const admin = getPayload(req);
    if (!admin) return void res.status(401).json({ error: 'unauthorized' });
    const { id } = req.params;
    try {
      const target = await service.getUser(id); // email antes de borrar + 404
      await service.delete(id, admin.user_id); // 403 si es su propia cuenta
      AuditLogger.log({ adminEmail: admin.sub, targetEmail: target.email, operation: 'delete_user' });
      res.json({ message: 'user_deleted' });
    } catch (e) {
      sendError(res, e, 'delete_user');
    }
  });

  return router;
}
