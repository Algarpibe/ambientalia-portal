import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { cached, clearCacheKey } from '../cache.js';
import { getContabilidadData, upsertCartera } from './source.js';

const APP_ID = 'contabilidad';
const CACHE_KEY = 'contabilidad:facturas';
const CARTERA_MAX = 1000; // tope defensivo para una nota de texto libre

function sendError(res: Response, e: unknown, ctx: string): void {
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

export function createContabilidadRouter(db: Pool): Router {
  const router = Router();

  router.get('/contabilidad/facturas', requireAuth, requireApp(APP_ID), async (_req: Request, res: Response) => {
    try {
      const data = await cached(CACHE_KEY, () => getContabilidadData(db));
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
      if (cartera.length > CARTERA_MAX) {
        return void res.status(400).json({ error: `cartera demasiado larga (máx ${CARTERA_MAX} caracteres)` });
      }
      const userId = getPayload(req)?.user_id ?? null;
      await upsertCartera(db, req.params.invoiceNumber, cartera, userId ? String(userId) : null);
      clearCacheKey(CACHE_KEY); // invalida solo las facturas de contabilidad; no evicta el cache de otras apps
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, 'contabilidad_cartera');
    }
  });

  return router;
}
