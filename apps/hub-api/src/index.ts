import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { getHubPool } from './db.js';
import { requireApiKey } from './auth.js';
import { getReconciliationData } from './reconciliation.js';
import { getProfitabilityData } from './profitability.js';
import { getInventoryData } from './inventory.js';
import { getCustomerValuationData } from './customerValuation.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// SEC-006 — CORS fail-closed: solo los orígenes de ALLOWED_ORIGIN (coma-separado).
// Si no está configurado, NO se emite Access-Control-Allow-Origin (los navegadores
// bloquean cross-origin). Fijar ALLOWED_ORIGIN=<url-del-portal> en el entorno.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (ALLOWED_ORIGINS.length === 0) {
  console.warn('WARNING: ALLOWED_ORIGIN no configurado — CORS bloqueará peticiones cross-origin del navegador.');
}
app.use(cors({ origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : false }));

// SEC-005 — rate limiting en la API de datos (mitiga scraping/DoS).
app.use('/api/', rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
}));

// SEC-007 — loguea el detalle server-side y responde un mensaje genérico.
const sendError = (res: express.Response, e: unknown, ctx: string) => {
  console.error(`${ctx} error`, e);
  res.status(500).json({ error: 'internal error' });
};

app.get('/health', async (_req, res) => {
  try {
    const db = getHubPool();
    const { rows } = await db.query(
      `SELECT (SELECT count(*)::int FROM crm.deals) deals,
              (SELECT count(*)::int FROM books.invoices) invoices,
              (SELECT count(*)::int FROM desk.tickets) tickets`
    );
    res.json({ ok: true, ...rows[0] });
  } catch (e) {
    // /health is unauthenticated — don't leak raw driver errors to callers.
    console.error('health check failed', e);
    res.status(500).json({ ok: false, error: 'hub unreachable' });
  }
});

app.get('/api/reconciliation/data', requireApiKey, async (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const data = await getReconciliationData(getHubPool(), from, to);
    res.json(data);
  } catch (e) {
    sendError(res, e, 'reconciliation');
  }
});

app.get('/api/profitability/data', requireApiKey, async (_req, res) => {
  try {
    const data = await getProfitabilityData(getHubPool());
    res.json(data);
  } catch (e) {
    sendError(res, e, 'profitability');
  }
});

app.get('/api/inventory/data', requireApiKey, async (_req, res) => {
  try {
    const data = await getInventoryData(getHubPool());
    res.json(data);
  } catch (e) {
    sendError(res, e, 'inventory');
  }
});

app.get('/api/customer-valuation/data', requireApiKey, async (_req, res) => {
  try {
    const data = await getCustomerValuationData(getHubPool());
    res.json(data);
  } catch (e) {
    sendError(res, e, 'customer-valuation');
  }
});

app.listen(PORT, () => console.log(`hub-api listening on :${PORT}`));
