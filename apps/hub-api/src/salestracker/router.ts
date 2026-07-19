import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp } from '../auth.js';
import { captureError } from '../sentry.js';
import { cached } from '../cache.js';
import { getSalesRows } from './sales.js';

const APP_ID = 'salestracker';

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

  return router;
}
