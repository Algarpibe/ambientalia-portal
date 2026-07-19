# salestracker → Portal — Plan 1: Vertical Slice (spine end-to-end)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la app `salestracker` aparezca en el portal, autenticada con el JWT compartido, mostrando ventas reales del `zoho-hub` a través de un endpoint nuevo de hub-api — probando de punta a punta el patrón backend + frontend + registro + deploy.

**Architecture:** hub-api gana un `createSalestrackerRouter` (Express) que expone `GET /api/salestracker/sales`, portando el SQL de agregación existente `HUB_SALES_AGG_SQL` sobre `zoho-hub` (solo lectura, con `cached()`). Una nueva sub-app Vite React `apps/salestracker` se monta perezosamente en el portal en `/salestracker/*` detrás de `<AppGuard appId="salestracker">`, lee el JWT de `localStorage` y renderiza una página Home con un KPI + un gráfico recharts alimentados por el endpoint. Esto establece todos los patrones; las páginas restantes vienen en planes posteriores.

**Tech Stack:** hub-api (Express + TypeScript NodeNext, Vitest, `@algarpibe/zoho-sync` Pool, `cached()`); portal (Vite + React 19 + react-router-dom + Tailwind); patrón espejo de `apps/contabilidad` y `apps/hub-api/src/contabilidad`.

**Alcance de este plan (Plan 1 de 5):**
1. **Vertical slice** ← este documento
2. Páginas core (home completa, tablas, articulos, clientes + drill-down, cliente-articulo)
3. Analítica pesada (analytics / margen / forecast)
4. Config & estado escribible (categorías/agrupaciones + favoritos + vistas guardadas)
5. Cutover (paridad, retiro de BD/better-auth/servicio Next)

---

## File Structure

**Backend (hub-api) — nuevo módulo `apps/hub-api/src/salestracker/`:**
- `sales.ts` — porta `HUB_SALES_AGG_SQL`; expone `getSalesRows(db)` + la función pura `mapSalesRow(raw)`. Una responsabilidad: leer/formar las filas de ventas agregadas.
- `sales.test.ts` — Vitest de `mapSalesRow` (coerción/validación de tipos).
- `router.ts` — `createSalestrackerRouter(db)`: monta `GET /salestracker/sales` con `requireAuth` + `requireApp('salestracker')` + `cached()`.
- `types.ts` — `SalesRow` (contrato compartido, espejado en el frontend).

**Backend — modificar:**
- `apps/hub-api/src/index.ts` — importar y montar el router tras `initDb()`.

**Frontend — nueva sub-app `apps/salestracker/` (workspace Vite, espejo de `apps/contabilidad`):**
- `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx` — scaffold copiado de contabilidad.
- `src/App.tsx` — router interno (react-router) con la ruta Home.
- `src/api.ts` — cliente de API (`fetchSales`), espejo de `contabilidad/src/api.ts`.
- `src/pages/Home.tsx` — KPI + un gráfico recharts consumiendo `fetchSales`.
- `src/lib/rollup.ts` + `src/lib/rollup.test.ts` — rollup puro de `SalesRow[]` → totales por categoría (portado/reducido del `lib` de salestracker).

**Frontend (portal) — modificar (checklist de registro):**
- `apps/portal/src/lib/apps.ts` — entrada `salestracker` en `APPS`.
- `apps/portal/src/App.tsx` — import lazy + `<Route>` con `AppGuard`.
- `apps/portal/src/pages/Aplicaciones.tsx` — tarjeta.
- `Dockerfile` (raíz) — `COPY apps/salestracker/package*.json`.
- `apps/portal/tailwind.config.js` — content glob.

---

## Task 0: Resolver el repo git anidado y crear rama de trabajo

**Files:**
- Modify: `apps/salestracker/.git` (respaldo + neutralización)

- [ ] **Step 1: Verificar el estado del repo anidado y respaldar la app Next actual**

Run:
```bash
cd "c:/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git -C apps/salestracker status --short   # confirmar que es un repo propio con commits
git -C apps/salestracker log --oneline -1
```
Expected: muestra el HEAD de la app Next (repo independiente).

- [ ] **Step 2: Copiar la app Next a una ruta de referencia fuera del monorepo trackeable**

Movemos la app Next full-stack a `reference/salestracker-next/` (fuera de `apps/`, no compilada por el portal) para conservarla como **oráculo de paridad**. `reference/` se ignora en git.

Run:
```bash
mkdir -p reference
cp -r apps/salestracker reference/salestracker-next
rm -rf reference/salestracker-next/node_modules reference/salestracker-next/.next
echo "reference/" >> .gitignore
```
Expected: `reference/salestracker-next/` existe con el código Next; sigue teniendo su `.git` (no importa, está ignorado).

- [ ] **Step 3: Vaciar `apps/salestracker` para el scaffold Vite (conservando solo lo que se porta)**

La sub-app Vite se construye limpia. Eliminamos el `.git` anidado y el andamiaje Next; el código a portar ya está en `reference/`.

Run:
```bash
rm -rf apps/salestracker/.git apps/salestracker/.next apps/salestracker/node_modules
rm -rf apps/salestracker/drizzle apps/salestracker/next-env.d.ts apps/salestracker/next.config.ts
# deja README/docs si quieres; el resto se reemplaza en las tareas siguientes
```
Expected: `git -C . status` ya NO muestra `apps/salestracker/` como submódulo/repo anidado; sus archivos aparecen como untracked normales del monorepo.

- [ ] **Step 4: Crear rama de trabajo del monorepo**

Run:
```bash
git checkout -b feat/salestracker-portal
```
Expected: rama creada.

- [ ] **Step 5: Commit del punto de partida**

```bash
git add .gitignore
git commit -m "chore(salestracker): mover app Next a reference/ y limpiar workspace para sub-app Vite"
```

---

## Task 1: Contrato de tipos del backend (`SalesRow`)

**Files:**
- Create: `apps/hub-api/src/salestracker/types.ts`

- [ ] **Step 1: Escribir el tipo compartido**

```typescript
// apps/hub-api/src/salestracker/types.ts
// Fila de ventas agregada por (categoría Zoho, tipo, mes, año). Contrato del
// endpoint GET /api/salestracker/sales. Espejado en apps/salestracker/src/api.ts.
export type RecordType = 'SALES_ORDER' | 'INVOICE' | 'BACKLOG';

export interface SalesRow {
  categoryName: string;
  recordType: RecordType;
  month: number; // 1-12
  year: number;
  amountUsd: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/hub-api/src/salestracker/types.ts
git commit -m "feat(hub-api): tipo SalesRow para el endpoint de salestracker"
```

---

## Task 2: Módulo de datos `sales.ts` (SQL portado + mapper puro)

**Files:**
- Create: `apps/hub-api/src/salestracker/sales.ts`
- Test: `apps/hub-api/src/salestracker/sales.test.ts`

- [ ] **Step 1: Escribir el test que falla (mapper puro)**

```typescript
// apps/hub-api/src/salestracker/sales.test.ts
import { describe, it, expect } from 'vitest';
import { mapSalesRow } from './sales.js';

describe('mapSalesRow', () => {
  it('coacciona los campos crudos del hub al contrato SalesRow', () => {
    const raw = {
      category_name: 'Equipos',
      record_type: 'INVOICE',
      record_month: '3',
      record_year: '2026',
      amount_usd: '1234.5',
    };
    expect(mapSalesRow(raw)).toEqual({
      categoryName: 'Equipos',
      recordType: 'INVOICE',
      month: 3,
      year: 2026,
      amountUsd: 1234.5,
    });
  });

  it('trata amount no numérico como 0', () => {
    const raw = { category_name: 'X', record_type: 'BACKLOG', record_month: 1, record_year: 2026, amount_usd: null };
    expect(mapSalesRow(raw).amountUsd).toBe(0);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd apps/hub-api && npx vitest run src/salestracker/sales.test.ts`
Expected: FAIL — `mapSalesRow` no existe.

- [ ] **Step 3: Escribir la implementación mínima**

SQL portado **verbatim** de `reference/salestracker-next/src/db/hub-sales.ts` (`HUB_SALES_AGG_SQL`). El `cached()` de hub-api reemplaza el cache in-memory de 30s del original.

```typescript
// apps/hub-api/src/salestracker/sales.ts
import type { Pool } from '@algarpibe/zoho-sync';
import type { SalesRow, RecordType } from './types.js';

// Portado de salestracker-next/src/db/hub-sales.ts (HUB_SALES_AGG_SQL), sin cambios
// de lógica: INVOICE/SALES_ORDER = bcy_rate*qty neto del descuento de cabecera;
// BACKLOG = porción no facturada por orden (invoiced_status). Excluye void/draft.
const HUB_SALES_AGG_SQL = `
WITH ord AS (
  SELECT s.salesorder_id, s.date, (s.raw->>'invoiced_status') st,
    sum(l.bcy_rate*l.quantity) gross
  FROM books.salesorder_line_items l JOIN books.sales_orders s ON s.salesorder_id=l.salesorder_id
  WHERE s.date IS NOT NULL AND l.bcy_rate IS NOT NULL AND s.status NOT IN ('void','draft')
  GROUP BY 1,2,3
),
oi AS (
  SELECT i.salesorder_id, sum(li.bcy_rate*li.quantity) inv
  FROM books.invoice_line_items li JOIN books.invoices i ON i.invoice_id=li.invoice_id
  WHERE i.salesorder_id IS NOT NULL AND i.salesorder_id<>'' AND li.bcy_rate IS NOT NULL AND i.status NOT IN ('void','draft')
  GROUP BY 1
),
frac AS (
  SELECT o.salesorder_id, o.date,
    CASE WHEN o.st='not_invoiced' THEN 1
         WHEN o.st='partially_invoiced' AND o.gross>0 THEN greatest(0,(o.gross-coalesce(oi.inv,0))/o.gross)
         ELSE 0 END f
  FROM ord o LEFT JOIN oi ON oi.salesorder_id=o.salesorder_id
),
lines AS (
  SELECT it.category_name cat,'INVOICE' rt, extract(year from i.date)::int yy, extract(month from i.date)::int mm,
    l.bcy_rate*l.quantity * COALESCE(1 - COALESCE((i.raw->>'bcy_discount_total')::numeric,0)/NULLIF(i.bcy_sub_total,0),1) amt
  FROM books.invoice_line_items l JOIN books.invoices i ON i.invoice_id=l.invoice_id LEFT JOIN books.items it ON it.item_id=l.item_id
  WHERE i.date IS NOT NULL AND l.bcy_rate IS NOT NULL AND i.status NOT IN ('void','draft')
  UNION ALL
  SELECT it.category_name,'SALES_ORDER', extract(year from s.date)::int, extract(month from s.date)::int,
    l.bcy_rate*l.quantity * COALESCE(1 - COALESCE((s.raw->>'bcy_discount_total')::numeric,0)/NULLIF(s.bcy_sub_total,0),1)
  FROM books.salesorder_line_items l JOIN books.sales_orders s ON s.salesorder_id=l.salesorder_id LEFT JOIN books.items it ON it.item_id=l.item_id
  WHERE s.date IS NOT NULL AND l.bcy_rate IS NOT NULL AND s.status NOT IN ('void','draft')
  UNION ALL
  SELECT it.category_name,'BACKLOG', extract(year from f.date)::int, extract(month from f.date)::int,
    l.bcy_rate*l.quantity * f.f
  FROM books.salesorder_line_items l JOIN frac f ON f.salesorder_id=l.salesorder_id LEFT JOIN books.items it ON it.item_id=l.item_id
  WHERE l.bcy_rate IS NOT NULL AND f.f > 0
)
SELECT cat AS category_name, rt AS record_type, mm AS record_month, yy AS record_year, round(sum(amt),2)::float8 AS amount_usd
FROM lines WHERE cat IS NOT NULL GROUP BY cat, rt, mm, yy
`;

/** Coacciona una fila cruda del hub al contrato SalesRow (función pura, testeable). */
export function mapSalesRow(r: Record<string, unknown>): SalesRow {
  const amount = Number(r.amount_usd);
  return {
    categoryName: String(r.category_name),
    recordType: r.record_type as RecordType,
    month: Number(r.record_month),
    year: Number(r.record_year),
    amountUsd: Number.isFinite(amount) ? amount : 0,
  };
}

/** Ejecuta la agregación de ventas sobre el hub y devuelve las filas ya mapeadas. */
export async function getSalesRows(db: Pool): Promise<SalesRow[]> {
  const { rows } = await db.query(HUB_SALES_AGG_SQL);
  return (rows as Record<string, unknown>[]).map(mapSalesRow);
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `cd apps/hub-api && npx vitest run src/salestracker/sales.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/salestracker/sales.ts apps/hub-api/src/salestracker/sales.test.ts
git commit -m "feat(hub-api): agregación de ventas de salestracker (SQL portado + mapper)"
```

---

## Task 3: Router `createSalestrackerRouter`

**Files:**
- Create: `apps/hub-api/src/salestracker/router.ts`

- [ ] **Step 1: Escribir el router (patrón espejo de createContabilidadRouter)**

```typescript
// apps/hub-api/src/salestracker/router.ts
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
```

- [ ] **Step 2: Verificar que compila**

Run: `cd apps/hub-api && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/hub-api/src/salestracker/router.ts
git commit -m "feat(hub-api): createSalestrackerRouter con GET /salestracker/sales"
```

---

## Task 4: Montar el router en index.ts

**Files:**
- Modify: `apps/hub-api/src/index.ts:10` (imports) y `:186` (montaje)

- [ ] **Step 1: Añadir el import**

En `apps/hub-api/src/index.ts`, tras la línea 10 (`import { createContabilidadRouter } ...`):

```typescript
import { createSalestrackerRouter } from './salestracker/router.js';
```

- [ ] **Step 2: Montar el router tras initDb (junto a los demás)**

Tras la línea `app.use('/api', createContabilidadRouter(getHubPool()));` (≈línea 186):

```typescript
    app.use('/api', createSalestrackerRouter(getHubPool()));
```

- [ ] **Step 3: Verificar compilación + tests del backend**

Run: `cd apps/hub-api && npx tsc --noEmit && npx vitest run`
Expected: compila; toda la suite pasa (incluye `salestracker/sales.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add apps/hub-api/src/index.ts
git commit -m "feat(hub-api): montar el router de salestracker en /api"
```

---

## Task 5: Scaffold de la sub-app Vite `apps/salestracker`

**Files:**
- Create: `apps/salestracker/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`

- [ ] **Step 1: Leer los archivos de configuración de contabilidad como plantilla**

Run:
```bash
cd "c:/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
cat apps/contabilidad/package.json apps/contabilidad/vite.config.ts apps/contabilidad/tsconfig.json apps/contabilidad/index.html apps/contabilidad/src/main.tsx
```
Expected: ver la plantilla exacta (deps, config Vite, entry).

- [ ] **Step 2: Crear los archivos de config espejando contabilidad, cambiando el nombre**

Copiar cada archivo cambiando únicamente el `"name"` del package a `"salestracker"` y el título del `index.html` a "SalesTracker". Añadir a `dependencies` las libs que la Home necesitará: `recharts`, `@tanstack/react-query`, `react-router-dom` (si no están ya en la plantilla). NO añadir Next.js, drizzle, better-auth, pg.

Run (tras crear los archivos):
```bash
cd "c:/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
npm install
```
Expected: workspace resuelto sin errores; `apps/salestracker` aparece en el árbol de workspaces.

- [ ] **Step 3: Commit**

```bash
git add apps/salestracker/package.json apps/salestracker/vite.config.ts apps/salestracker/tsconfig.json apps/salestracker/index.html apps/salestracker/src/main.tsx package-lock.json
git commit -m "feat(salestracker): scaffold de sub-app Vite (espejo de contabilidad)"
```

---

## Task 6: Cliente de API del frontend (`fetchSales`)

**Files:**
- Create: `apps/salestracker/src/api.ts`

- [ ] **Step 1: Escribir el cliente (espejo de contabilidad/src/api.ts)**

```typescript
// apps/salestracker/src/api.ts
const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// Espejo de apps/hub-api/src/salestracker/types.ts
export type RecordType = 'SALES_ORDER' | 'INVOICE' | 'BACKLOG';
export interface SalesRow {
  categoryName: string;
  recordType: RecordType;
  month: number;
  year: number;
  amountUsd: number;
}

async function mensajeDeError(res: Response): Promise<string> {
  if (res.status === 401) return 'Tu sesión ha caducado. Vuelve a entrar en el portal e inténtalo de nuevo.';
  if (res.status === 403) return 'No tienes esta aplicación asignada. Pide acceso a un administrador del portal.';
  return `No se pudieron cargar los datos (error ${res.status}). Inténtalo de nuevo en un momento.`;
}

/** Carga las filas de ventas agregadas del hub. Lanza Error con mensaje en español si falla. */
export async function fetchSales(): Promise<SalesRow[]> {
  const res = await fetch(`${API_BASE}/api/salestracker/sales`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const data = (await res.json()) as { rows?: SalesRow[] };
  if (!Array.isArray(data.rows)) throw new Error('Formato inesperado del hub (ventas).');
  return data.rows;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/salestracker/src/api.ts
git commit -m "feat(salestracker): cliente de API fetchSales"
```

---

## Task 7: Rollup puro `SalesRow[]` → totales por categoría (TDD)

**Files:**
- Create: `apps/salestracker/src/lib/rollup.ts`
- Test: `apps/salestracker/src/lib/rollup.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
// apps/salestracker/src/lib/rollup.test.ts
import { describe, it, expect } from 'vitest';
import { totalsByCategory, grandTotal } from './rollup';
import type { SalesRow } from '../api';

const rows: SalesRow[] = [
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 100 },
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 2, year: 2026, amountUsd: 50 },
  { categoryName: 'Servicios', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 30 },
  { categoryName: 'Equipos', recordType: 'BACKLOG', month: 1, year: 2026, amountUsd: 999 },
];

describe('totalsByCategory', () => {
  it('suma amountUsd por categoría para el tipo dado', () => {
    expect(totalsByCategory(rows, 'INVOICE')).toEqual([
      { categoryName: 'Equipos', total: 150 },
      { categoryName: 'Servicios', total: 30 },
    ]);
  });
});

describe('grandTotal', () => {
  it('suma todo el amountUsd del tipo dado', () => {
    expect(grandTotal(rows, 'INVOICE')).toBe(180);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd apps/salestracker && npx vitest run src/lib/rollup.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Escribir la implementación mínima**

```typescript
// apps/salestracker/src/lib/rollup.ts
import type { SalesRow, RecordType } from '../api';

export interface CategoryTotal {
  categoryName: string;
  total: number;
}

/** Totales por categoría (ordenados desc por total) para un tipo de registro. */
export function totalsByCategory(rows: SalesRow[], type: RecordType): CategoryTotal[] {
  const acc = new Map<string, number>();
  for (const r of rows) {
    if (r.recordType !== type) continue;
    acc.set(r.categoryName, (acc.get(r.categoryName) ?? 0) + r.amountUsd);
  }
  return [...acc.entries()]
    .map(([categoryName, total]) => ({ categoryName, total }))
    .sort((a, b) => b.total - a.total);
}

/** Suma total del tipo de registro dado. */
export function grandTotal(rows: SalesRow[], type: RecordType): number {
  return rows.reduce((s, r) => (r.recordType === type ? s + r.amountUsd : s), 0);
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `cd apps/salestracker && npx vitest run src/lib/rollup.test.ts`
Expected: PASS (2 tests).

> Nota: si el scaffold de la plantilla no incluye Vitest, añadir `vitest` a devDependencies y un script `"test": "vitest run"` en `apps/salestracker/package.json` en este paso (mismo que usa contabilidad/salestracker-next).

- [ ] **Step 5: Commit**

```bash
git add apps/salestracker/src/lib/rollup.ts apps/salestracker/src/lib/rollup.test.ts apps/salestracker/package.json
git commit -m "feat(salestracker): rollup puro de ventas por categoría"
```

---

## Task 8: Página Home (KPI + gráfico) y router interno de la sub-app

**Files:**
- Create: `apps/salestracker/src/pages/Home.tsx`
- Create: `apps/salestracker/src/App.tsx`

- [ ] **Step 1: Escribir la página Home consumiendo fetchSales**

```tsx
// apps/salestracker/src/pages/Home.tsx
import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchSales, type SalesRow } from '../api';
import { totalsByCategory, grandTotal } from '../lib/rollup';

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export default function Home() {
  const [rows, setRows] = useState<SalesRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSales().then(setRows).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!rows) return <div className="p-8 text-gray-600">Cargando ventas…</div>;

  const facturado = grandTotal(rows, 'INVOICE');
  const porCategoria = totalsByCategory(rows, 'INVOICE').slice(0, 10);

  return (
    <div className="p-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">SalesTracker</h1>
        <p className="text-gray-500">Ventas facturadas (USD)</p>
      </header>

      <div className="rounded-xl border bg-white p-6 w-fit">
        <div className="text-sm text-gray-500">Total facturado</div>
        <div className="text-3xl font-bold text-gray-900">{fmtUsd(facturado)}</div>
      </div>

      <div className="rounded-xl border bg-white p-6">
        <h2 className="text-lg font-semibold mb-4">Top categorías (facturado)</h2>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={porCategoria} layout="vertical" margin={{ left: 24 }}>
            <XAxis type="number" tickFormatter={(v) => fmtUsd(Number(v))} />
            <YAxis type="category" dataKey="categoryName" width={140} />
            <Tooltip formatter={(v) => fmtUsd(Number(v))} />
            <Bar dataKey="total" fill="#2563eb" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Escribir el router interno de la sub-app**

Usa rutas relativas (montado bajo `/salestracker/*` en el portal). NO usar `BrowserRouter` (el portal ya provee uno) — usar `Routes` anidadas, igual que las otras sub-apps.

```tsx
// apps/salestracker/src/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      {/* páginas adicionales se añaden en el Plan 2 */}
      <Route path="*" element={<Navigate to="/salestracker" replace />} />
    </Routes>
  );
}
```

> Verificación de patrón: confirmar contra `reference/salestracker-next` y contra `apps/contabilidad/src/App.tsx` que las demás sub-apps usan `Routes` sin `BrowserRouter` propio. Si contabilidad usa un basename distinto, replicarlo.

- [ ] **Step 3: Verificar compilación de la sub-app**

Run: `cd apps/salestracker && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/salestracker/src/App.tsx apps/salestracker/src/pages/Home.tsx
git commit -m "feat(salestracker): página Home con KPI + gráfico de categorías"
```

---

## Task 9: Registrar la app en el portal (checklist de 5 puntos)

**Files:**
- Modify: `apps/portal/src/lib/apps.ts:27`
- Modify: `apps/portal/src/App.tsx:28` y `:113`
- Modify: `apps/portal/src/pages/Aplicaciones.tsx`
- Modify: `Dockerfile` (raíz)
- Modify: `apps/portal/tailwind.config.js`

- [ ] **Step 1: Añadir la entrada en el catálogo `APPS`**

En `apps/portal/src/lib/apps.ts`, dentro del array `APPS` (tras la línea 27, la de contabilidad):

```typescript
  { id: 'salestracker', label: 'SalesTracker', route: '/salestracker', category: 'aplicacion' },
```

- [ ] **Step 2: Añadir el import lazy + la ruta con AppGuard en el portal**

En `apps/portal/src/App.tsx`, tras la línea 28 (`const Contabilidad = ...`):

```typescript
const SalesTracker = lazyConReintento(() => import('../../salestracker/src/App'));
```

Y tras la línea 113 (la `<Route>` de contabilidad):

```tsx
                    <Route path="/salestracker/*" element={<AppGuard appId="salestracker"><SalesTracker /></AppGuard>} />
```

- [ ] **Step 3: Añadir la tarjeta en la página de Aplicaciones**

Leer primero `apps/portal/src/pages/Aplicaciones.tsx` para ver la forma exacta de los objetos de tarjeta (la lista está hardcodeada, separada de `apps.ts`). Añadir una tarjeta para SalesTracker replicando la forma de la de "Contabilidad" (mismo tipo de objeto: id/label/route/descripción/icono según el patrón existente), con `route: '/salestracker'`.

Run: `grep -n "contabilidad" apps/portal/src/pages/Aplicaciones.tsx`
Expected: localizar la tarjeta modelo a copiar.

- [ ] **Step 4: Añadir el COPY del package.json en el Dockerfile raíz**

En `Dockerfile` (raíz), junto a los demás `COPY apps/<app>/package*.json`:

```dockerfile
COPY apps/salestracker/package*.json ./apps/salestracker/
```

Run: `grep -n "COPY apps/contabilidad/package" Dockerfile`
Expected: localizar la línea modelo; añadir la de salestracker al lado.

- [ ] **Step 5: Añadir el content glob de Tailwind del portal**

En `apps/portal/tailwind.config.js`, en el array `content`:

```javascript
    "../salestracker/src/**/*.{js,ts,jsx,tsx}",
```

- [ ] **Step 6: Verificar el build del portal (compila e incluye la sub-app)**

Run:
```bash
cd "c:/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
npm run build --workspace=apps/portal
```
Expected: `tsc -b && vite build` termina sin errores; el chunk de `salestracker` aparece en la salida de Vite.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/lib/apps.ts apps/portal/src/App.tsx apps/portal/src/pages/Aplicaciones.tsx Dockerfile apps/portal/tailwind.config.js
git commit -m "feat(portal): registrar salestracker (catálogo, ruta, tarjeta, Docker, Tailwind)"
```

---

## Task 10: Verificación end-to-end (local) y handoff

**Files:** ninguno (verificación)

- [ ] **Step 1: Levantar hub-api local apuntando al zoho-hub**

Run (en una terminal, con `HUB_DB_URL`, `JWT_SECRET`, `ALLOWED_ORIGIN`, `AUTH_USERS` en el entorno de `apps/hub-api`):
```bash
cd apps/hub-api && npm run build && node dist/index.js
```
Expected: `migration applied: …` (sin migración nueva en este plan) y `hub-api listening on :3001`.

- [ ] **Step 2: Probar el endpoint con un JWT que tenga la app asignada**

Obtener un token (login del portal o `POST /api/login`) de un usuario **admin** (bypass de `requireApp`) o con `salestracker` en `apps[]`, y:
```bash
curl -s -H "Authorization: Bearer <TOKEN>" http://localhost:3001/api/salestracker/sales | head -c 400
```
Expected: JSON `{"rows":[{"categoryName":…,"recordType":"INVOICE",…}]}`. Con un token sin la app → `403 {"error":"forbidden"}`.

- [ ] **Step 3: Levantar el portal local y verificar la app en el navegador**

Run: `cd apps/portal && npm run dev` (con `VITE_HUB_API_URL` apuntando al hub-api local).
Verificar: login → la tarjeta "SalesTracker" aparece en /aplicaciones (si el usuario la tiene asignada) → navegar a `/salestracker` → se ve el KPI de total facturado y el gráfico de categorías con datos reales.

- [ ] **Step 4: Verificación completa de la rama**

Run:
```bash
cd "c:/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
npm run build --workspace=apps/portal
cd apps/hub-api && npx tsc --noEmit && npx vitest run
cd ../salestracker && npx tsc --noEmit && npx vitest run
```
Expected: todo compila y todos los tests pasan. Reportar la salida real (no afirmar éxito sin verla).

- [ ] **Step 5: Deploy**

Redeploy de **hub-api** (endpoint nuevo) y del **portal** en EasyPanel. Asignar la app `salestracker` a los usuarios en Admin → Usuarios; recordar que deben salir y volver a entrar para que el JWT incluya la app.

---

## Self-Review (cobertura del spec por este Plan 1)

- **Arquitectura objetivo (sub-app Vite montada en portal):** Tasks 5, 8, 9. ✅ (parcial — solo Home; resto en Plan 2-3)
- **Backend hub-api router + `zoho-hub` read-only + cached:** Tasks 1-4. ✅ (endpoint `sales`; resto de endpoints de lectura en Plan 2-3)
- **Auth por JWT compartido + requireApp:** Tasks 3 (backend), 6 y 9 (frontend usa token + AppGuard). ✅
- **Registro (checklist 5 puntos + redeploy):** Task 9 + Task 10 Step 5. ✅
- **Gotcha repo git anidado:** Task 0. ✅
- **Estado escribible (categorías/favoritos/vistas):** ❌ fuera de alcance → **Plan 4** (requiere migración `portal.salestracker_*` siguiendo el patrón `portal.contabilidad_*` de `db.ts`/`source.ts`).
- **Cutover / retiro de BD-auth-servicio Next:** ❌ fuera de alcance → **Plan 5**.
- **Alineación Tailwind v4→v3:** parcialmente ejercida en Task 5/8 (la Home usa utilidades básicas); la reconciliación completa de componentes base-ui/shadcn se aborda al portar cada página en **Plan 2-3**.

Sin placeholders TBD/TODO en los pasos. Tipos consistentes: `SalesRow` (backend `types.ts` → frontend `api.ts`), `RecordType`, `totalsByCategory`/`grandTotal` usados igual en test e implementación.

---

## Próximos planes (a escribir cuando el Plan 1 esté verde)

- **Plan 2 — Páginas core:** portar `home` (completa), `tablas`, `articulos`, `clientes` + `clientes/:customer`, `cliente-articulo`. Por cada una: endpoint de lectura en `salestracker/router.ts` (SQL desde `reference/salestracker-next/src/db/hub-*.ts`) + página portada + `lib` puro con sus tests Vitest.
- **Plan 3 — Analítica pesada:** `analytics` (Pareto, buckets, estacionalidad, new-vs-recurring), `margin` y `forecast`. Es el `lib` más denso de salestracker; se mueve casi literal con su suite Vitest.
- **Plan 4 — Config & estado escribible:** migración `009_salestracker.sql` (`portal.salestracker_categories`, `_category_groups`, `_group_mappings`, `_favorites`, `_saved_views`) siguiendo `portal.contabilidad_*`; endpoints CRUD role-gated (`requireApp` lectura, `admin`/`editor` escritura); UI de categorías/agrupaciones/favoritos/vistas.
- **Plan 5 — Cutover:** paridad contra `reference/salestracker-next`, retiro de la BD propia, better-auth y el servicio EasyPanel de la app Next.
