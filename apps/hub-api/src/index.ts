import { captureError } from './sentry.js'; // debe importarse primero (init de Sentry)
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { getHubPool, initDb } from './db.js';
import { requireAuth, loginUser } from './auth.js';
import { createUsersRouter } from './users/users.router.js';
import { createWoSalesRouter } from './wo-sales/router.js';
import { cached } from './cache.js';
import { getReconciliationData } from './reconciliation.js';
import { getProfitabilityData } from './profitability.js';
import { getInventoryData } from './inventory.js';
import { getCustomerValuationData } from './customerValuation.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// DATA-001 — compresión gzip: los payloads JSON (facturas/pagos/ítems) comprimen
// ~5-10×, reduciendo mucho el tamaño en la red sin cambiar el dato ni la lógica.
app.use(compression());

// SEC-006 — CORS fail-closed: solo los orígenes de ALLOWED_ORIGIN (coma-separado).
// Si no está configurado, NO se emite Access-Control-Allow-Origin (los navegadores
// bloquean cross-origin). Fijar ALLOWED_ORIGIN=<url-del-portal> en el entorno.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (ALLOWED_ORIGINS.length === 0) {
  console.warn('WARNING: ALLOWED_ORIGIN no configurado — CORS bloqueará peticiones cross-origin del navegador.');
}
app.use(cors({ origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : false }));

// Body JSON. Límite de 2mb para permitir la subida del avatar (data URL de un
// thumbnail); el resto de payloads son pequeños y hay rate limiting.
app.use(express.json({ limit: '2mb' }));

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
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
};

// Login: valida credenciales (usuarios en env) y emite un JWT. Rate-limit
// estricto para frenar fuerza bruta.
app.post('/api/login',
  rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false }),
  async (req, res) => {
    try {
      const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
      if (!email || !password) return res.status(400).json({ error: 'missing credentials' });
      const result = await loginUser(email, password);
      if (!result.ok) return res.status(result.status ?? 401).json({ error: result.error });
      res.json({ token: result.token });
    } catch (e) {
      sendError(res, e, 'login');
    }
  });

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
    captureError(e, { endpoint: 'health' });
    res.status(500).json({ ok: false, error: 'hub unreachable' });
  }
});

app.get('/api/reconciliation/data', requireAuth, async (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const data = await cached(`reconciliation:${from || ''}:${to || ''}`, () => getReconciliationData(getHubPool(), from, to));
    res.json(data);
  } catch (e) {
    sendError(res, e, 'reconciliation');
  }
});

app.get('/api/profitability/data', requireAuth, async (_req, res) => {
  try {
    const data = await cached('profitability', () => getProfitabilityData(getHubPool()));
    res.json(data);
  } catch (e) {
    sendError(res, e, 'profitability');
  }
});

app.get('/api/inventory/data', requireAuth, async (_req, res) => {
  try {
    const data = await cached('inventory', () => getInventoryData(getHubPool()));
    res.json(data);
  } catch (e) {
    sendError(res, e, 'inventory');
  }
});

app.get('/api/customer-valuation/data', requireAuth, async (_req, res) => {
  try {
    const data = await cached('customer-valuation', () => getCustomerValuationData(getHubPool()));
    res.json(data);
  } catch (e) {
    sendError(res, e, 'customer-valuation');
  }
});

// Captura fallos no manejados del proceso (además de loguearlos).
process.on('unhandledRejection', (reason) => { console.error('unhandledRejection', reason); captureError(reason); });
process.on('uncaughtException', (err) => { console.error('uncaughtException', err); captureError(err); });

// Inicializa la BD (valida HUB_DB_URL, verifica conectividad, aplica migraciones
// y seed) antes de aceptar tráfico. Si algo falla, initDb() termina el proceso.
initDb()
  .then(() => {
    // Router de gestión de usuarios. Se monta tras initDb (getHubPool ya
    // validado) para no romper el chequeo de arranque de HUB_DB_URL.
    // Montado en '/api' → expone /api/users*, /api/auth/register. El rate limit
    // propio del router corre antes de requireAuth/requireAdmin.
    app.use('/api', createUsersRouter(getHubPool()));
    // Router de WO-sales → /api/wo-sales/preview y /api/wo-sales/csv. Se monta aquí
    // por lo mismo que el de usuarios: necesita getHubPool() ya validado.
    app.use('/api', createWoSalesRouter(getHubPool()));
    app.listen(PORT, () => console.log(`hub-api listening on :${PORT}`));
  })
  .catch((e) => {
    console.error('FATAL: fallo en la inicialización de la base de datos.', e);
    captureError(e, { endpoint: 'initDb' });
    process.exit(1);
  });
