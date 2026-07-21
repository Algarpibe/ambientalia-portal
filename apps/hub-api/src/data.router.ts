import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp } from './auth.js';
import { captureError } from './sentry.js';
import { cached } from './cache.js';
import { getReconciliationData } from './reconciliation.js';
import { getProfitabilityData } from './profitability.js';
import { getInventoryData } from './inventory.js';
import { getCustomerValuationData } from './customerValuation.js';
import { getPendingSalesOrders } from './salesOrders.js';
import { getDetalleFactura, getDetalleOV } from './contabilidad/detalle.js';

// SEC-210 / SEC-211 / PRIV-810 — endpoints de datos de solo-lectura de las apps
// del portal. Antes vivían inline en index.ts SOLO con requireAuth: cualquier
// usuario autenticado (incluido un token legacy AUTH_USERS con apps:[]) podía
// leer la rentabilidad/valoración/cartera de todos los clientes y enumerar el
// detalle de facturas/OV (NIT + dirección = PII, Ley 1581). Ahora cada ruta
// exige requireApp(<appId>) igual que los routers de contabilidad/salestracker/
// wo-sales: la autorización por-app se valida en el servidor, no solo en el
// AppGuard del frontend. Los appId coinciden con portal/src/lib/apps.ts.
const APP_PAGOS = 'payment-reconciliation';
const APP_RENTABILIDAD = 'customer-profitability';
const APP_INVENTARIO = 'inventory-optimization';
const APP_VALORACION = 'customer-valuation';

function sendError(res: Response, e: unknown, ctx: string): void {
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

/** Monta los endpoints de datos bajo '/api' con guard por-app. */
export function createDataRouter(db: Pool): Router {
  const router = Router();

  router.get('/reconciliation/data', requireAuth, requireApp(APP_PAGOS), async (req: Request, res: Response) => {
    try {
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const data = await cached(`reconciliation:${from || ''}:${to || ''}`, () => getReconciliationData(db, from, to));
      res.json(data);
    } catch (e) {
      sendError(res, e, 'reconciliation');
    }
  });

  router.get('/profitability/data', requireAuth, requireApp(APP_RENTABILIDAD), async (_req: Request, res: Response) => {
    try {
      const data = await cached('profitability', () => getProfitabilityData(db));
      res.json(data);
    } catch (e) {
      sendError(res, e, 'profitability');
    }
  });

  router.get('/inventory/data', requireAuth, requireApp(APP_INVENTARIO), async (_req: Request, res: Response) => {
    try {
      const data = await cached('inventory', () => getInventoryData(db));
      res.json(data);
    } catch (e) {
      sendError(res, e, 'inventory');
    }
  });

  router.get('/customer-valuation/data', requireAuth, requireApp(APP_VALORACION), async (_req: Request, res: Response) => {
    try {
      const data = await cached('customer-valuation', () => getCustomerValuationData(db));
      res.json(data);
    } catch (e) {
      sendError(res, e, 'customer-valuation');
    }
  });

  router.get('/sales-orders/pending', requireAuth, requireApp(APP_PAGOS), async (_req: Request, res: Response) => {
    try {
      const data = await cached('sales-orders-pending', () => getPendingSalesOrders(db));
      res.json({ orders: data });
    } catch (e) {
      sendError(res, e, 'sales-orders-pending');
    }
  });

  router.get('/invoices/:numero/detail', requireAuth, requireApp(APP_PAGOS), async (req: Request, res: Response) => {
    try {
      const d = await getDetalleFactura(db, req.params.numero);
      if (!d) return void res.status(404).json({ error: 'factura no encontrada' });
      res.json(d);
    } catch (e) {
      sendError(res, e, 'invoice_detail');
    }
  });

  router.get('/sales-orders/:numero/detail', requireAuth, requireApp(APP_PAGOS), async (req: Request, res: Response) => {
    try {
      const d = await getDetalleOV(db, req.params.numero);
      if (!d) return void res.status(404).json({ error: 'ov no encontrada' });
      res.json(d);
    } catch (e) {
      sendError(res, e, 'sales_order_detail');
    }
  });

  return router;
}
