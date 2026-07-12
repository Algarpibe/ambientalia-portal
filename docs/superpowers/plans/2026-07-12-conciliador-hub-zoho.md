# Conciliador de Pagos → hub de Zoho — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Excel-upload data source of the "Conciliador de Pagos" SPA with a new shared read-only backend (`apps/hub-api`) that reads invoices and payments from the central `zoho-hub` Postgres, so the app auto-loads its data on open.

**Architecture:** A new Node + Express service (`apps/hub-api`) connects to the hub via `@algarpibe/zoho-sync` (`createPoolFromUrl`, read-only `hub_reader`) and exposes `GET /health` and `GET /api/reconciliation/data`. Pure mapping functions turn hub rows into the existing `InvoiceDetails[]`/`PaymentRecord[]` shapes, so the SPA's reconciliation logic is untouched. The SPA fetches that JSON on mount instead of parsing Excel. `hub-api` deploys as a separate EasyPanel service in the same project as the hub.

**Tech Stack:** Node 20, Express 4, TypeScript, `@algarpibe/zoho-sync` (+ `pg`), `cors`, Vitest (unit tests for mappers), React 19 + Vite 7 (SPA), Docker + EasyPanel.

**Spec:** `docs/superpowers/specs/2026-07-12-conciliador-hub-zoho-design.md`

---

## File Structure

**New — `apps/hub-api/`:**
- `package.json` — deps: express, cors, @algarpibe/zoho-sync; devDeps: typescript, tsx, vitest, @types/*
- `tsconfig.json`
- `Dockerfile` — Node runtime, `ARG NPM_TOKEN`, listens on `$PORT`
- `.dockerignore`
- `src/db.ts` — hub `Pool` singleton via `createPoolFromUrl`
- `src/mappers.ts` — pure functions: `mapInvoiceRow`, `mapPaymentRow` (hub row → app shape)
- `src/mappers.test.ts` — Vitest unit tests for the mappers
- `src/reconciliation.ts` — SQL queries → `{ invoices, payments }`
- `src/auth.ts` — API-key middleware
- `src/index.ts` — Express app, routes, startup
- `src/schema-probe.ts` — one-off introspection helper (temporary, kept for future migrations)

**New — repo root:**
- `.npmrc` — GitHub Packages registry for `@algarpibe` scope

**Modified:**
- `apps/payment-reconciliation/src/App.tsx` — fetch-on-mount, remove Excel upload data path, loading/error UI
- `apps/payment-reconciliation/src/types.ts` — no change expected (shapes already match); confirm only
- `apps/portal/…` build env — `VITE_HUB_API_URL` (documented in deployment task)

---

## Task 0: Repo-level `.npmrc` for the private package

**Files:**
- Create: `.npmrc` (repo root)

- [ ] **Step 1: Create `.npmrc`**

```
@algarpibe:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

- [ ] **Step 2: Confirm it is safe to commit (placeholder, not a literal token)**

Run: `cat .npmrc`
Expected: contains `${NPM_TOKEN}` (a shell placeholder), no real `ghp_...` value.

- [ ] **Step 3: Commit**

```bash
git add .npmrc
git commit -m "chore: add .npmrc for @algarpibe GitHub Packages registry"
```

---

## Task 1: Scaffold `apps/hub-api` with a `/health`-only Express server

**Files:**
- Create: `apps/hub-api/package.json`
- Create: `apps/hub-api/tsconfig.json`
- Create: `apps/hub-api/src/index.ts`

- [ ] **Step 1: Create `apps/hub-api/package.json`**

```json
{
  "name": "hub-api",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -b",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@algarpibe/zoho-sync": "^1.0.0",
    "cors": "^2.8.5",
    "express": "^4.21.2"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^24.10.1",
    "tsx": "^4.19.2",
    "typescript": "~5.9.3",
    "vitest": "^2.1.8"
  }
}
```

> Note: pin `@algarpibe/zoho-sync` to the version resolved at install time; `^1.0.0` per the spec's "API del paquete (v1)". Adjust if `npm i` reports a different published version.

- [ ] **Step 2: Create `apps/hub-api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmitOnError": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create minimal `apps/hub-api/src/index.ts`**

```ts
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

app.use(cors({ origin: ALLOWED_ORIGIN }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`hub-api listening on :${PORT}`);
});
```

- [ ] **Step 4: Install deps (requires NPM_TOKEN for the private package)**

Run (PowerShell): `$env:NPM_TOKEN="<PAT read:packages>"; npm install --workspace=apps/hub-api`
Expected: installs without `E401`. If `E401` → the PAT lacks `read:packages` or `NPM_TOKEN` is unset.

- [ ] **Step 5: Smoke-run the server**

Run: `npm run dev --workspace=apps/hub-api` then in another shell `curl http://localhost:3001/health`
Expected: `{"ok":true}`. Stop the server after verifying.

- [ ] **Step 6: Commit**

```bash
git add apps/hub-api/package.json apps/hub-api/tsconfig.json apps/hub-api/src/index.ts package-lock.json
git commit -m "feat(hub-api): scaffold express service with /health"
```

---

## Task 2: Hub connection pool singleton

**Files:**
- Create: `apps/hub-api/src/db.ts`

- [ ] **Step 1: Create `apps/hub-api/src/db.ts`**

```ts
import { createPoolFromUrl } from '@algarpibe/zoho-sync';
import type { Pool } from 'pg';

let pool: Pool | null = null;

/** Returns the shared read-only hub pool, creating it on first use. */
export function getHubPool(): Pool {
  if (!pool) {
    const url = process.env.HUB_DB_URL;
    if (!url) throw new Error('HUB_DB_URL is not set');
    pool = createPoolFromUrl(url);
  }
  return pool;
}
```

> If `@algarpibe/zoho-sync` does not re-export `Pool`'s type, import `type { Pool } from 'pg'` (pg is a transitive dep) as shown, or fall back to `ReturnType<typeof createPoolFromUrl>`.

- [ ] **Step 2: Typecheck**

Run: `npm run build --workspace=apps/hub-api`
Expected: compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/hub-api/src/db.ts
git commit -m "feat(hub-api): add read-only hub pool singleton"
```

---

## Task 3: Probe the real hub schema (discovery — resolves the spec's critical risk)

**Files:**
- Create: `apps/hub-api/src/schema-probe.ts`

**Purpose:** The exact `books.*` table/column names and the payment↔invoice link are unknown. This task discovers them and records the findings, which Tasks 4–5 depend on. Do NOT guess — run this against the live hub.

- [ ] **Step 1: Create `apps/hub-api/src/schema-probe.ts`**

```ts
import { getHubPool } from './db.js';

async function main() {
  const db = getHubPool();

  const { rows: tables } = await db.query(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_schema = 'books'
      ORDER BY table_name`
  );
  console.log('BOOKS TABLES:', tables.map((t) => t.table_name));

  for (const t of ['invoices', 'customer_payments', 'customer_payment_invoices', 'invoice_payments']) {
    const { rows: cols } = await db.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'books' AND table_name = $1
        ORDER BY ordinal_position`,
      [t]
    );
    if (cols.length) console.log(`\nbooks.${t} COLUMNS:`, cols);
  }

  const { rows: counts } = await db.query(
    `SELECT (SELECT count(*) FROM crm.deals) deals,
            (SELECT count(*) FROM books.invoices) invoices,
            (SELECT count(*) FROM desk.tickets) tickets`
  );
  console.log('\nCOUNTS:', counts[0]);

  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run against the hub**

Run: `HUB_DB_URL="postgres://hub_reader:<PASS>@<host>:5432/zoho-hub" npx tsx apps/hub-api/src/schema-probe.ts`
(From a shell that can reach the hub — locally that may require a tunnel; otherwise run inside the deployed container. The internal host `ambientalia_project_zoho-hub-db` only resolves inside EasyPanel.)
Expected: prints the books table list, real column names for invoices & the payment-application table, and non-zero counts.

- [ ] **Step 3: Record findings in the plan/spec**

Write the actual table + column names into a short note at the top of `apps/hub-api/src/reconciliation.ts` (created next) as a comment. These names drive Tasks 4–5. If a discovered name differs from the assumptions in Task 5's SQL, update Task 5's SQL to match before running it.

- [ ] **Step 4: Commit**

```bash
git add apps/hub-api/src/schema-probe.ts
git commit -m "feat(hub-api): add hub schema probe (discovery)"
```

---

## Task 4: Pure mapper functions with unit tests (TDD core)

**Files:**
- Create: `apps/hub-api/src/mappers.ts`
- Create: `apps/hub-api/src/mappers.test.ts`

**Shapes (must match `apps/payment-reconciliation/src/types.ts`):**
```ts
InvoiceDetails { invoiceNumber, orderNumber, clientName, invoiceDate, dueDate, status, total: number, balance: number }
PaymentRecord  { paymentNumber, clientName, invoiceNumber, paymentDate, amountFCY: number, unusedFCY: number, amountBCY: number, unusedBCY: number }
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { mapInvoiceRow, mapPaymentRow } from './mappers.js';

describe('mapInvoiceRow', () => {
  it('maps a hub invoice row to InvoiceDetails', () => {
    const row = {
      invoice_number: 'INV-000123',
      reference_number: 'SO-45',
      customer_name: 'ACME S.A.S.',
      date: '2026-01-15',
      due_date: '2026-02-14',
      status: 'overdue',
      total: 1190000,
      balance: 500000,
    };
    expect(mapInvoiceRow(row)).toEqual({
      invoiceNumber: 'INV-000123',
      orderNumber: 'SO-45',
      clientName: 'ACME S.A.S.',
      invoiceDate: '2026-01-15',
      dueDate: '2026-02-14',
      status: 'overdue',
      total: 1190000,
      balance: 500000,
    });
  });

  it('coerces null money/reference to safe defaults', () => {
    const row = { invoice_number: 'INV-1', customer_name: 'X', date: '2026-01-01',
      due_date: null, status: null, total: null, balance: null, reference_number: null };
    const out = mapInvoiceRow(row);
    expect(out.total).toBe(0);
    expect(out.balance).toBe(0);
    expect(out.orderNumber).toBe('');
    expect(out.status).toBe('');
  });
});

describe('mapPaymentRow', () => {
  it('maps a hub payment-application row to PaymentRecord', () => {
    const row = {
      payment_number: 'PMT-9',
      customer_name: 'ACME S.A.S.',
      invoice_number: 'INV-000123',
      date: '2026-02-01',
      amount_fcy: 500000,
      unused_amount_fcy: 0,
      amount_bcy: 500000,
      unused_amount_bcy: 0,
    };
    expect(mapPaymentRow(row)).toEqual({
      paymentNumber: 'PMT-9',
      clientName: 'ACME S.A.S.',
      invoiceNumber: 'INV-000123',
      paymentDate: '2026-02-01',
      amountFCY: 500000,
      unusedFCY: 0,
      amountBCY: 500000,
      unusedBCY: 0,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=apps/hub-api`
Expected: FAIL — `mapInvoiceRow`/`mapPaymentRow` not defined.

- [ ] **Step 3: Implement `apps/hub-api/src/mappers.ts`**

```ts
// Column names below must match the schema-probe findings (Task 3).
// Adjust the source keys if the hub uses different names.

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v));

export interface InvoiceDetails {
  invoiceNumber: string; orderNumber: string; clientName: string;
  invoiceDate: string; dueDate: string; status: string;
  total: number; balance: number;
}
export interface PaymentRecord {
  paymentNumber: string; clientName: string; invoiceNumber: string;
  paymentDate: string; amountFCY: number; unusedFCY: number;
  amountBCY: number; unusedBCY: number;
}

export function mapInvoiceRow(row: Record<string, unknown>): InvoiceDetails {
  return {
    invoiceNumber: str(row.invoice_number),
    orderNumber: str(row.reference_number),
    clientName: str(row.customer_name),
    invoiceDate: str(row.date),
    dueDate: str(row.due_date),
    status: str(row.status),
    total: num(row.total),
    balance: num(row.balance),
  };
}

export function mapPaymentRow(row: Record<string, unknown>): PaymentRecord {
  return {
    paymentNumber: str(row.payment_number),
    clientName: str(row.customer_name),
    invoiceNumber: str(row.invoice_number),
    paymentDate: str(row.date),
    amountFCY: num(row.amount_fcy),
    unusedFCY: num(row.unused_amount_fcy),
    amountBCY: num(row.amount_bcy),
    unusedBCY: num(row.unused_amount_bcy),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test --workspace=apps/hub-api`
Expected: PASS (both suites).

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/mappers.ts apps/hub-api/src/mappers.test.ts
git commit -m "feat(hub-api): add tested hub-row->app-shape mappers"
```

---

## Task 5: Reconciliation queries

**Files:**
- Create: `apps/hub-api/src/reconciliation.ts`

**Precondition:** Task 3 discovery completed; column/table names below confirmed or corrected to match findings.

- [ ] **Step 1: Create `apps/hub-api/src/reconciliation.ts`**

```ts
import type { Pool } from 'pg';
import { mapInvoiceRow, mapPaymentRow, type InvoiceDetails, type PaymentRecord } from './mappers.js';

export interface ReconciliationData {
  invoices: InvoiceDetails[];
  payments: PaymentRecord[];
}

// NOTE (from Task 3 discovery): confirm these table/column names against the
// real hub schema before running. Payments are matched to invoices by invoice
// number; a payment applied to N invoices yields N payment rows.
export async function getReconciliationData(
  db: Pool,
  from?: string,
  to?: string
): Promise<ReconciliationData> {
  const dateFilter = from && to ? 'WHERE i.date BETWEEN $1 AND $2' : '';
  const params = from && to ? [from, to] : [];

  const invoicesSql = `
    SELECT i.invoice_number, i.reference_number, i.customer_name,
           i.date, i.due_date, i.status, i.total, i.balance
      FROM books.invoices i
      ${dateFilter}
      ORDER BY i.date`;

  // Payment applications: one row per (payment, invoice) with per-invoice amounts.
  // If the hub stores applications in a separate table (e.g. books.customer_payment_invoices),
  // join it; otherwise adapt to the discovered structure.
  const paymentsSql = `
    SELECT p.payment_number, p.customer_name, a.invoice_number,
           p.date, a.amount_applied AS amount_fcy, p.unused_amount AS unused_amount_fcy,
           a.amount_applied AS amount_bcy, p.unused_amount AS unused_amount_bcy
      FROM books.customer_payments p
      JOIN books.customer_payment_invoices a ON a.payment_id = p.payment_id`;

  const [inv, pay] = await Promise.all([
    db.query(invoicesSql, params),
    db.query(paymentsSql),
  ]);

  return {
    invoices: inv.rows.map(mapInvoiceRow),
    payments: pay.rows.map(mapPaymentRow),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build --workspace=apps/hub-api`
Expected: compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/hub-api/src/reconciliation.ts
git commit -m "feat(hub-api): reconciliation data queries (books.*)"
```

---

## Task 6: API-key middleware, CORS, and wire the routes

**Files:**
- Create: `apps/hub-api/src/auth.ts`
- Modify: `apps/hub-api/src/index.ts`

- [ ] **Step 1: Create `apps/hub-api/src/auth.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';

/** Rejects /api/* requests without the shared key. Not real auth (see spec §2.4). */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.API_KEY;
  if (!expected) return next(); // if unset, do not block (dev)
  if (req.header('x-api-key') === expected) return next();
  res.status(401).json({ error: 'unauthorized' });
}
```

- [ ] **Step 2: Rewrite `apps/hub-api/src/index.ts` to wire everything**

```ts
import express from 'express';
import cors from 'cors';
import { getHubPool } from './db.js';
import { requireApiKey } from './auth.js';
import { getReconciliationData } from './reconciliation.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

app.use(cors({ origin: ALLOWED_ORIGIN }));

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
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

app.get('/api/reconciliation/data', requireApiKey, async (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const data = await getReconciliationData(getHubPool(), from, to);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.listen(PORT, () => console.log(`hub-api listening on :${PORT}`));
```

- [ ] **Step 3: Typecheck**

Run: `npm run build --workspace=apps/hub-api`
Expected: compiles with no errors.

- [ ] **Step 4: Runtime check against the hub (if reachable)**

Run: `HUB_DB_URL="..." API_KEY="testkey" npm run dev --workspace=apps/hub-api`
then: `curl -H "x-api-key: testkey" http://localhost:3001/api/reconciliation/data | head -c 400`
Expected: JSON with non-empty `invoices` and `payments` arrays. `curl http://localhost:3001/health` returns counts > 0.
(If the hub is only reachable inside EasyPanel, defer this to Task 10.)

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/auth.ts apps/hub-api/src/index.ts
git commit -m "feat(hub-api): api-key middleware + reconciliation route"
```

---

## Task 7: Dockerfile for `hub-api`

**Files:**
- Create: `apps/hub-api/Dockerfile`
- Create: `apps/hub-api/.dockerignore`

- [ ] **Step 1: Create `apps/hub-api/.dockerignore`**

```
node_modules
dist
```

- [ ] **Step 2: Create `apps/hub-api/Dockerfile`**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
ARG NPM_TOKEN
ENV NPM_TOKEN=$NPM_TOKEN
COPY apps/hub-api/package.json ./package.json
COPY .npmrc ./.npmrc
RUN npm install
COPY apps/hub-api/tsconfig.json ./tsconfig.json
COPY apps/hub-api/src ./src
RUN npm run build
ENV NPM_TOKEN=""

FROM node:20-alpine AS runtime
WORKDIR /app
ARG NPM_TOKEN
ENV NPM_TOKEN=$NPM_TOKEN
COPY apps/hub-api/package.json ./package.json
COPY .npmrc ./.npmrc
RUN npm install --omit=dev
ENV NPM_TOKEN=""
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

> Build context is the repo root (so `.npmrc` and `apps/hub-api/*` are available). In EasyPanel set the service's Dockerfile path to `apps/hub-api/Dockerfile` and build context to repo root.

- [ ] **Step 3: Local Docker build (if Docker available)**

Run: `docker build -f apps/hub-api/Dockerfile --build-arg NPM_TOKEN=$NPM_TOKEN -t hub-api:test .`
Expected: builds successfully through both stages.

- [ ] **Step 4: Commit**

```bash
git add apps/hub-api/Dockerfile apps/hub-api/.dockerignore
git commit -m "feat(hub-api): dockerfile with NPM_TOKEN build arg"
```

---

## Task 8: SPA — auto-load from hub, remove Excel upload

**Files:**
- Modify: `apps/payment-reconciliation/src/App.tsx`

**Behavior:** On mount, fetch `${VITE_HUB_API_URL}/api/reconciliation/data` (with `x-api-key`), then `setInvoices`/`setPayments`. Show the existing `SkeletonLoader` while loading and an error box with a "Reintentar" button on failure. Remove the two Excel upload cards and their `handleFileUpload` data path. Keep `reconcile()` and all downstream UI unchanged.

- [ ] **Step 1: Add a data-loading function + effect near the top of the `App` component**

Insert after the existing state declarations (they include `setInvoices`, `setPayments`, `setLoading`, `setError`):

```tsx
const API_BASE = import.meta.env.VITE_HUB_API_URL as string;
const API_KEY = import.meta.env.VITE_HUB_API_KEY as string | undefined;

const loadFromHub = React.useCallback(async () => {
  setLoading(true);
  setError(null);
  try {
    const res = await fetch(`${API_BASE}/api/reconciliation/data`, {
      headers: API_KEY ? { 'x-api-key': API_KEY } : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: { invoices: InvoiceDetails[]; payments: PaymentRecord[] } = await res.json();
    setInvoices(data.invoices);
    setPayments(data.payments);
  } catch (err) {
    setError('No se pudieron cargar los datos del hub de Zoho. Reintenta.');
    console.error(err);
  } finally {
    setLoading(false);
  }
}, [API_BASE, API_KEY]);

React.useEffect(() => { loadFromHub(); }, [loadFromHub]);
```

> Ensure `InvoiceDetails` and `PaymentRecord` are imported from `./types` (they are already used in the file). Ensure `React` is imported (add `import React from 'react'` if only named hooks were imported).

- [ ] **Step 2: Auto-run reconciliation once data arrives**

Find where `reconcile()` is triggered by the button. Add an effect so it runs automatically after a successful load:

```tsx
React.useEffect(() => {
  if (invoices.length > 0) reconcile();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [invoices, payments]);
```

> If `reconcile` is defined after this effect, move the effect below `reconcile`'s definition, or wrap `reconcile` in `useCallback`. Keep the manual reconcile button working too.

- [ ] **Step 3: Replace the two upload cards with load/error UI**

In the render, replace the JSX block containing the "Detalles de Factura" / "Pagos Recibidos" upload cards and the "Generar Conciliación" button with:

```tsx
{loading && <SkeletonLoader />}
{!loading && error && (
  <div className="p-6 text-center">
    <p className="text-red-600 mb-4">{error}</p>
    <button onClick={loadFromHub} className="px-6 py-2 bg-primary text-white rounded-lg font-semibold">
      Reintentar
    </button>
  </div>
)}
```

> Keep the results/tables/tabs block that renders when `reconciledData` (or equivalent) is populated. Only the *input* (upload) UI is removed. `handleFileUpload` and `findHeaderRow` may be deleted if no longer referenced; the `xlsx` import stays only if the results-export feature still uses it.

- [ ] **Step 4: Typecheck the SPA**

Run: `cd apps/payment-reconciliation && npx tsc -b --noEmit`
Expected: 0 errors. (Also run portal strict check: `cd apps/portal && npx tsc -b --noEmit` → 0 errors.)

- [ ] **Step 5: Manual dev check with a stubbed API**

Run: set `VITE_HUB_API_URL` to a local stub (or the running `hub-api` from Task 6) in `apps/payment-reconciliation/.env.local`, then `npm run dev --workspace=apps/payment-reconciliation` and confirm the app auto-loads and renders the reconciliation without any Excel upload.

- [ ] **Step 6: Commit**

```bash
git add apps/payment-reconciliation/src/App.tsx
git commit -m "feat(conciliador): auto-load invoices/payments from hub-api, drop excel upload"
```

---

## Task 9: Deployment configuration (EasyPanel) — documentation

**Files:**
- Modify: `README.md` (add a "hub-api deployment" section) OR create `apps/hub-api/README.md`

- [ ] **Step 1: Document the new service + env in `apps/hub-api/README.md`**

```markdown
# hub-api

Read-only API over the central zoho-hub Postgres. Deployed as a separate
EasyPanel service in the same project as `zoho-hub-db`.

## EasyPanel service
- Source: this repo, branch `main`.
- Build: Dockerfile `apps/hub-api/Dockerfile`, context = repo root.
- Build arg (Entorno): `NPM_TOKEN` (GitHub PAT, scope `read:packages`).
- Runtime env (Entorno):
  - `HUB_DB_URL=postgres://hub_reader:<PASS>@ambientalia_project_zoho-hub-db:5432/zoho-hub`
  - `ALLOWED_ORIGIN=<portal public domain>`
  - `API_KEY=<shared secret>`
  - `PORT` is injected by EasyPanel.
- Domain: assign a public domain pointing to the container port EasyPanel maps.

## Portal build env (for the SPA)
- `VITE_HUB_API_URL=<hub-api public domain>`
- `VITE_HUB_API_KEY=<same shared secret>` (note: visible in client bundle — light deterrent only)
```

- [ ] **Step 2: Commit**

```bash
git add apps/hub-api/README.md
git commit -m "docs(hub-api): deployment + env configuration"
```

---

## Task 10: End-to-end validation (success criteria)

- [ ] **Step 1: Deploy `hub-api` in EasyPanel** with the env from Task 9. Confirm the build passes (needs `NPM_TOKEN`) and the container stays running.

- [ ] **Step 2: Validate `/health`**

Run: `curl https://<hub-api-domain>/health`
Expected: `{"ok":true,"deals":<n>,"invoices":<n>,"tickets":<n>}` with counts > 0.
- `E401` at build time → `NPM_TOKEN` missing/scope wrong.
- 500 with connection error → `HUB_DB_URL`/`hub_reader`/internal host wrong.

- [ ] **Step 3: Validate the data endpoint**

Run: `curl -H "x-api-key: <API_KEY>" "https://<hub-api-domain>/api/reconciliation/data" | head -c 600`
Expected: JSON with non-empty `invoices` and `payments` arrays in the correct shapes.

- [ ] **Step 4: Redeploy the portal** with `VITE_HUB_API_URL` (+ `VITE_HUB_API_KEY`) set. Open the Conciliador de Pagos: it must auto-load and show the reconciliation **without uploading any Excel**, with results consistent with the previous Excel-based output.

- [ ] **Step 5: Final commit / tag**

```bash
git commit --allow-empty -m "chore: conciliador connected to zoho-hub (validated)"
```

---

## Deferred / out of scope
- Migrating the other portal apps to the hub (reuse this pattern, one spec each).
- Real auth integrating the portal login into `hub-api` (replaces the client-embedded API key).
- Payload pagination/streaming (only if volume demands; `from/to` param already present).
