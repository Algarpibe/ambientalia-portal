import express from 'express';
import cors from 'cors';
import { getHubPool } from './db.js';
import { requireApiKey } from './auth.js';
import { getReconciliationData } from './reconciliation.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
if (!ALLOWED_ORIGIN) {
  console.warn('WARNING: ALLOWED_ORIGIN is not set — CORS is open to all origins.');
}

app.use(cors({ origin: ALLOWED_ORIGIN || '*' }));

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
    res.status(500).json({ error: errMsg(e) });
  }
});

// Temporary discovery endpoint (behind the API key). Reports the real books.*
// schema so the payments query / balance source can be finalized. Remove once
// the reconciliation SQL is confirmed.
app.get('/debug/schema', requireApiKey, async (_req, res) => {
  try {
    const db = getHubPool();
    const [tables, invoiceCols, paymentCols, sampleInvoice, samplePayment] = await Promise.all([
      db.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'books' ORDER BY table_name`
      ),
      db.query(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema = 'books' AND table_name = 'invoices' ORDER BY ordinal_position`
      ),
      db.query(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
          WHERE table_schema = 'books' AND table_name LIKE '%payment%' ORDER BY table_name, ordinal_position`
      ),
      db.query(`SELECT raw FROM books.invoices LIMIT 1`),
      db.query(
        `SELECT raw FROM books.customer_payments LIMIT 1`
      ).catch((e: unknown) => ({ rows: [{ error: errMsg(e) }] })),
    ]);
    res.json({
      booksTables: tables.rows.map((r: { table_name: string }) => r.table_name),
      invoiceColumns: invoiceCols.rows,
      paymentColumns: paymentCols.rows,
      sampleInvoiceRawKeys: sampleInvoice.rows[0]?.raw ? Object.keys(sampleInvoice.rows[0].raw) : null,
      samplePaymentRawKeys: samplePayment.rows[0]?.raw ? Object.keys(samplePayment.rows[0].raw) : samplePayment.rows[0] ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: errMsg(e) });
  }
});

app.listen(PORT, () => console.log(`hub-api listening on :${PORT}`));
