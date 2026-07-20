import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp, requireAdmin, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { cached } from '../cache.js';
import { getSalesRows } from './sales.js';
import { getItemSalesRows } from './item-sales.js';
import { getCustomerSalesRows } from './customer-sales.js';
import { getCustomerItemSalesRows } from './customer-item-sales.js';
import { getCustomerMonthSalesRows } from './customer-month-sales.js';
import { getMarginByCustomerRows } from './margin-by-customer.js';
import { getMarginByYearRows } from './margin-by-year.js';
import { getMarginByItemRows } from './margin-by-item.js';
import { getCategoryMonthSalesRows } from './category-month-sales.js';
import { getFavorites, toggleFavorite, getSavedViews, saveView, deleteSavedView, MAX_VIEW_NAME_LEN, stateTooLarge } from './user-state.js';
import { getCategories, createCategory, updateCategory, deleteCategory, importFromHub } from './categories.js';
import { getGroupings, createGrouping, updateGrouping, deleteGrouping, reorderGroupings } from './groupings.js';
import { getGroupingAnalysis } from './grouping-analysis.js';
import type { RecordType, RecordTypeIO } from './types.js';

// dueño del JWT; null si token legacy sin user_id
const ownerId = (req: Request): string | null => {
  const uid = getPayload(req)?.user_id;
  return uid ? String(uid) : null;
};

const APP_ID = 'salestracker';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const parseAnio = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
};

function sendError(res: Response, e: unknown, ctx: string): void {
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

function sendCategoryError(res: Response, e: unknown, ctx: string): void {
  const msg = e instanceof Error ? e.message : '';
  if (/requerido|demasiado largo|inválido/.test(msg)) return void res.status(400).json({ error: msg });
  if (/(duplicate key|unique)/i.test(msg)) return void res.status(409).json({ error: 'ya existe una categoría con ese nombre' });
  sendError(res, e, ctx);
}

function sendGroupError(res: Response, e: unknown, ctx: string): void {
  const msg = e instanceof Error ? e.message : '';
  if (/requerido|demasiado largo|demasiadas|inválido/.test(msg)) return void res.status(400).json({ error: msg });
  if (/(duplicate key|unique)/i.test(msg)) return void res.status(409).json({ error: 'ya existe una agrupación con ese nombre' });
  sendError(res, e, ctx);
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

  router.get('/salestracker/customer-sales', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const tipo = req.query.tipo === 'SALES_ORDER' ? 'SALES_ORDER' : 'INVOICE';
      const desdeAnio = parseAnio(req.query.desdeAnio);
      const hastaAnio = parseAnio(req.query.hastaAnio);
      if (desdeAnio === null || hastaAnio === null || desdeAnio > hastaAnio) {
        return void res.status(400).json({ error: 'desdeAnio/hastaAnio inválidos (enteros 2000-2100, desde ≤ hasta)' });
      }
      const key = `salestracker:customer-sales:${tipo}:${desdeAnio}:${hastaAnio}`;
      const rows = await cached(key, () => getCustomerSalesRows(db, { tipo: tipo as RecordTypeIO, desdeAnio, hastaAnio }));
      res.json({ rows });
    } catch (e) {
      sendError(res, e, 'salestracker_customer_sales');
    }
  });

  router.get('/salestracker/customer-item-sales', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const tipo = req.query.tipo === 'SALES_ORDER' ? 'SALES_ORDER' : 'INVOICE';
      const anio = parseAnio(req.query.anio);
      if (anio === null) return void res.status(400).json({ error: 'anio inválido (2000-2100)' });
      const rows = await cached(`salestracker:customer-item-sales:${tipo}:${anio}`, () => getCustomerItemSalesRows(db, { tipo: tipo as RecordTypeIO, anio }));
      res.json({ rows });
    } catch (e) { sendError(res, e, 'salestracker_customer_item_sales'); }
  });

  router.get('/salestracker/customer-month-sales', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const tipo = req.query.tipo === 'SALES_ORDER' ? 'SALES_ORDER' : 'INVOICE';
      const anio = parseAnio(req.query.anio);
      if (anio === null) return void res.status(400).json({ error: 'anio inválido (2000-2100)' });
      const rows = await cached(`salestracker:customer-month-sales:${tipo}:${anio}`, () => getCustomerMonthSalesRows(db, { tipo: tipo as RecordTypeIO, anio }));
      res.json({ rows });
    } catch (e) { sendError(res, e, 'salestracker_customer_month_sales'); }
  });

  router.get('/salestracker/margin-by-customer', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const tipo = req.query.tipo === 'SALES_ORDER' ? 'SALES_ORDER' : 'INVOICE';
      const anio = parseAnio(req.query.anio);
      if (anio === null) return void res.status(400).json({ error: 'anio inválido (2000-2100)' });
      const rows = await cached(`salestracker:margin-by-customer:${tipo}:${anio}`, () => getMarginByCustomerRows(db, { tipo: tipo as RecordTypeIO, anio }));
      res.json({ rows });
    } catch (e) { sendError(res, e, 'salestracker_margin_by_customer'); }
  });

  router.get('/salestracker/margin-by-year', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const tipo = req.query.tipo === 'SALES_ORDER' ? 'SALES_ORDER' : 'INVOICE';
      const rows = await cached(`salestracker:margin-by-year:${tipo}`, () => getMarginByYearRows(db, { tipo: tipo as RecordTypeIO }));
      res.json({ rows });
    } catch (e) { sendError(res, e, 'salestracker_margin_by_year'); }
  });

  router.get('/salestracker/margin-by-item', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const tipo = req.query.tipo === 'SALES_ORDER' ? 'SALES_ORDER' : 'INVOICE';
      const anio = parseAnio(req.query.anio);
      if (anio === null) return void res.status(400).json({ error: 'anio inválido (2000-2100)' });
      const rows = await cached(`salestracker:margin-by-item:${tipo}:${anio}`, () => getMarginByItemRows(db, { tipo: tipo as RecordTypeIO, anio }));
      res.json({ rows });
    } catch (e) { sendError(res, e, 'salestracker_margin_by_item'); }
  });

  router.get('/salestracker/category-month-sales', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const tipo = req.query.tipo === 'SALES_ORDER' ? 'SALES_ORDER' : 'INVOICE';
      const anio = parseAnio(req.query.anio);
      if (anio === null) return void res.status(400).json({ error: 'anio inválido (2000-2100)' });
      const rows = await cached(`salestracker:category-month-sales:${tipo}:${anio}`, () => getCategoryMonthSalesRows(db, { tipo: tipo as RecordTypeIO, anio }));
      res.json({ rows });
    } catch (e) { sendError(res, e, 'salestracker_category_month_sales'); }
  });

  router.get('/salestracker/favorites', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const uid = ownerId(req);
      res.json({ favorites: uid ? await getFavorites(db, uid) : [] });
    } catch (e) { sendError(res, e, 'salestracker_favorites_get'); }
  });
  router.post('/salestracker/favorites/toggle', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const uid = ownerId(req);
      if (!uid) return void res.status(400).json({ error: 'usuario sin identidad persistente' });
      const customer = (req.body as { customer?: unknown }).customer;
      if (typeof customer !== 'string' || !customer.trim()) return void res.status(400).json({ error: 'customer requerido' });
      const favorited = await toggleFavorite(db, uid, customer);
      res.json({ favorited });
    } catch (e) { sendError(res, e, 'salestracker_favorites_toggle'); }
  });
  router.get('/salestracker/saved-views', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const uid = ownerId(req);
      const viewKey = String(req.query.viewKey ?? '');
      if (!viewKey) return void res.status(400).json({ error: 'viewKey requerido' });
      res.json({ views: uid ? await getSavedViews(db, uid, viewKey) : [] });
    } catch (e) { sendError(res, e, 'salestracker_saved_views_get'); }
  });
  router.put('/salestracker/saved-views', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const uid = ownerId(req);
      if (!uid) return void res.status(400).json({ error: 'usuario sin identidad persistente' });
      const b = req.body as { viewKey?: unknown; name?: unknown; state?: unknown };
      if (typeof b.viewKey !== 'string' || !b.viewKey || typeof b.name !== 'string') return void res.status(400).json({ error: 'viewKey/name requeridos' });
      // Errores de entrada del cliente → 400 (no 500): nombre demasiado largo / state demasiado grande.
      if (b.name.trim().length > MAX_VIEW_NAME_LEN) return void res.status(400).json({ error: `nombre demasiado largo (máx ${MAX_VIEW_NAME_LEN})` });
      if (stateTooLarge(b.state)) return void res.status(400).json({ error: 'vista demasiado grande (máx 32 KB)' });
      const ok = await saveView(db, uid, b.viewKey, b.name, b.state);
      if (!ok) return void res.status(400).json({ error: 'nombre vacío' });
      res.json({ ok: true });
    } catch (e) { sendError(res, e, 'salestracker_saved_views_put'); }
  });
  router.delete('/salestracker/saved-views/:id', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const uid = ownerId(req);
      if (!uid) return void res.status(400).json({ error: 'usuario sin identidad persistente' });
      await deleteSavedView(db, uid, req.params.id);
      res.json({ ok: true });
    } catch (e) { sendError(res, e, 'salestracker_saved_views_delete'); }
  });

  router.get('/salestracker/categories', requireAuth, requireApp(APP_ID), async (_req: Request, res: Response) => {
    try { res.json({ categories: await getCategories(db) }); }
    catch (e) { sendError(res, e, 'salestracker_categories_get'); }
  });
  router.post('/salestracker/categories', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try { res.json({ category: await createCategory(db, req.body as { name: unknown }) }); }
    catch (e) { sendCategoryError(res, e, 'salestracker_categories_post'); }
  });
  router.patch('/salestracker/categories/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try { await updateCategory(db, req.params.id, req.body as Record<string, unknown>); res.json({ ok: true }); }
    catch (e) { sendCategoryError(res, e, 'salestracker_categories_patch'); }
  });
  router.delete('/salestracker/categories/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try { await deleteCategory(db, req.params.id); res.json({ ok: true }); }
    catch (e) { sendError(res, e, 'salestracker_categories_delete'); }
  });
  router.post('/salestracker/categories/import', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try { res.json({ added: await importFromHub(db) }); }
    catch (e) { sendError(res, e, 'salestracker_categories_import'); }
  });

  router.get('/salestracker/category-groups', requireAuth, requireApp(APP_ID), async (_req: Request, res: Response) => {
    try { res.json({ groups: await getGroupings(db) }); }
    catch (e) { sendError(res, e, 'salestracker_groups_get'); }
  });
  router.post('/salestracker/category-groups', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try { res.json({ group: await createGrouping(db, req.body as { name: unknown }) }); }
    catch (e) { sendGroupError(res, e, 'salestracker_groups_post'); }
  });
  router.patch('/salestracker/category-groups/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try { await updateGrouping(db, req.params.id, req.body as { name: unknown }); res.json({ ok: true }); }
    catch (e) { sendGroupError(res, e, 'salestracker_groups_patch'); }
  });
  router.delete('/salestracker/category-groups/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try { await deleteGrouping(db, req.params.id); res.json({ ok: true }); }
    catch (e) { sendError(res, e, 'salestracker_groups_delete'); }
  });
  router.post('/salestracker/category-groups/reorder', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try { const ids = (req.body as { orderedIds?: unknown }).orderedIds; await reorderGroupings(db, Array.isArray(ids) ? ids as string[] : []); res.json({ ok: true }); }
    catch (e) { sendError(res, e, 'salestracker_groups_reorder'); }
  });

  router.get('/salestracker/grouping-analysis', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const tipo = req.query.tipo === 'SALES_ORDER' ? 'SALES_ORDER' : 'INVOICE';
      const key = `salestracker:grouping-analysis:${tipo}`;
      res.json(await cached(key, () => getGroupingAnalysis(db, tipo as RecordType)));
    } catch (e) { sendError(res, e, 'salestracker_grouping_analysis'); }
  });

  return router;
}
