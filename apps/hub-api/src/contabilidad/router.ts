import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { cached, clearCache } from '../cache.js';
import { getContabilidadData, upsertCartera } from './source.js';

const APP_ID = 'contabilidad';

function sendError(res: Response, e: unknown, ctx: string): void {
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

export function createContabilidadRouter(db: Pool): Router {
  const router = Router();

  router.get('/contabilidad/facturas', requireAuth, requireApp(APP_ID), async (_req: Request, res: Response) => {
    try {
      const data = await cached('contabilidad:facturas', () => getContabilidadData(db));
      res.json(data);
    } catch (e) {
      sendError(res, e, 'contabilidad_facturas');
    }
  });

  router.put('/contabilidad/cartera/:invoiceNumber', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const cartera = (req.body as { cartera?: unknown }).cartera;
      if (typeof cartera !== 'string') {
        return void res.status(400).json({ error: 'cartera (string) requerido' });
      }
      const userId = getPayload(req)?.user_id ?? null;
      await upsertCartera(db, req.params.invoiceNumber, cartera, userId ? String(userId) : null);
      clearCache(); // invalida el cache de facturas para que el próximo GET traiga la cartera nueva
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, 'contabilidad_cartera');
    }
  });

  return router;
}
