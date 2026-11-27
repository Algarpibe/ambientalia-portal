import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { CelebracionError } from './dominio.js';
import type { CelebracionService, Sesion } from './service.js';

// Rutas de la invitación de fin de año, montadas bajo /api (ver index.ts).
// Abiertas a cualquier usuario activo: basta requireAuth, sin app asignada.
// El resumen y quitar o readmitir personas, además, exigen admin.

/** Lo que el router necesita del servicio (los tests le pasan un stub). */
export type CelebracionActions = Pick<CelebracionService, 'vista' | 'miEstado' | 'confirmar' | 'votar' | 'resumen' | 'excluir' | 'readmitir'>;

function sesionDe(req: Request): Sesion | null {
  const p = getPayload(req);
  return p?.user_id ? { userId: String(p.user_id), esAdmin: p.role === 'admin' } : null;
}

/** CelebracionError → su 400/409 con el código; cualquier otro error → 500 genérico y Sentry. */
function sendError(res: Response, e: unknown, ctx: string): void {
  if (e instanceof CelebracionError) {
    res.status(e.status).json({ error: e.code });
    return;
  }
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

/** Lee la sesión (requireAuth ya la validó), ejecuta el caso de uso y responde su resultado en JSON. */
function ruta(ctx: string, fn: (sesion: Sesion, req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response): Promise<void> => {
    const sesion = sesionDe(req);
    if (!sesion) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      res.json(await fn(sesion, req));
    } catch (e) {
      sendError(res, e, ctx);
    }
  };
}

export function createCelebracionRouter(service: CelebracionActions): Router {
  const router = Router();

  router.get('/celebracion', requireAuth, ruta('celebracion_vista', (s) => service.vista(s)));

  router.get('/celebracion/mi-estado', requireAuth, ruta('celebracion_mi_estado', (s) => service.miEstado(s.userId)));

  router.put(
    '/celebracion/confirmacion',
    requireAuth,
    ruta('celebracion_confirmar', async (s, req) => {
      await service.confirmar(s.userId, req.body);
      return { message: 'confirmacion_guardada' };
    }),
  );

  router.put(
    '/celebracion/votos/:userId',
    requireAuth,
    ruta('celebracion_votar', async (s, req) => {
      await service.votar(s.userId, req.params.userId, req.body);
      return { message: 'votos_guardados' };
    }),
  );

  router.get('/celebracion/resumen', requireAuth, requireAdmin, ruta('celebracion_resumen', () => service.resumen()));

  router.put(
    '/celebracion/excluidos/:userId',
    requireAuth,
    requireAdmin,
    ruta('celebracion_excluir', async (s, req) => {
      await service.excluir(s.userId, req.params.userId);
      return { message: 'excluido' };
    }),
  );

  router.delete(
    '/celebracion/excluidos/:userId',
    requireAuth,
    requireAdmin,
    ruta('celebracion_readmitir', async (_s, req) => {
      await service.readmitir(req.params.userId);
      return { message: 'readmitido' };
    }),
  );

  return router;
}
