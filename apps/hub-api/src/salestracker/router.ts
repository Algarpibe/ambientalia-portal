import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp } from '../auth.js';
import { captureError } from '../sentry.js';
import { cached } from '../cache.js';
import { getSalesRows } from './sales.js';
import { getItemSalesRows } from './item-sales.js';
import type { RecordTypeIO } from './types.js';

const APP_ID = 'salestracker';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function sendError(res: Response, e: unknown, ctx: string): void {
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

export function createSalestrackerRouter(db: Pool): Router {
  const router = Router();

  router.get('/salestracker/sales', requireAuth, requireApp(APP_ID), async (_req: Request, res: Response) => {
    try {
      const rows = await cached('salestracker:sales', () => getSalesRows(db));
      res.json({ rows });
    } catch (e) {
      sendError(res, e, 'salestracker_sales');
    }
  });

  router.get('/salestracker/item-sales', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const tipo = req.query.tipo === 'SALES_ORDER' ? 'SALES_ORDER' : 'INVOICE';
      const desde = String(req.query.desde ?? '');
      const hasta = String(req.query.hasta ?? '');
      if (!ISO_DATE.test(desde) || !ISO_DATE.test(hasta)) {
        return void res.status(400).json({ error: 'desde/hasta requeridos (YYYY-MM-DD)' });
      }
      const key = `salestracker:item-sales:${tipo}:${desde}:${hasta}`;
      const rows = await cached(key, () => getItemSalesRows(db, { tipo: tipo as RecordTypeIO, desde, hasta }));
      res.json({ rows });
    } catch (e) {
      sendError(res, e, 'salestracker_item_sales');
    }
  });

  return router;
}
