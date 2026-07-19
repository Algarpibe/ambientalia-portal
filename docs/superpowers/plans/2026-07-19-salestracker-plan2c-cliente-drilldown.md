# salestracker → Portal — Plan 2C: ficha de cliente (drill-down)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Portar la **ficha de cliente** (`/salestracker/clientes/:customer`): 6 tarjetas — KPIs (ventas año, margen %, ventas histórico, cliente desde), evolución anual (barras), mix por categoría/bucket (pie), top artículos (barras), margen (KPIs), estacionalidad (barras por mes) — con selectores tipo OV/FAC + año. Alimentada por 3 endpoints nuevos de hub-api + el `customer-sales` ya existente. Además, hacer **clicables** las filas de la matriz Clientes hacia la ficha.

**Architecture:** 3 endpoints nuevos en hub-api (`customer-item-sales`, `customer-month-sales`, `margin-by-customer`), SQL portado de `reference/salestracker-next/src/db/hub-{customer-item-sales,customer-month-sales,margin}.ts`. En la sub-app se portan **verbatim** las libs puras `customer-item.ts`, `customer-detail.ts` y una `analytics-margin.ts` mínima (`deriveMargin`), con tests. La página se construye con **Tailwind plano + recharts** (misma decisión que 2A/2B: sin shadcn). react-query y la nav absoluta ya están.

**Nota de navegación:** la app se monta bajo `/salestracker` con nav ABSOLUTA (ver `apps/salestracker/src/appBase.ts` y su test). Los enlaces a la ficha usan `${APP_BASE}/clientes/${encodeURIComponent(nombre)}`. NO usar `customerHref` (devuelve `/clientes/...` sin el prefijo del portal) para navegar; solo se porta para paridad/tests.

**Tech Stack:** hub-api (Express TS NodeNext, Vitest); sub-app Vite (React 19, react-router 7, @tanstack/react-query v5, recharts). Patrón idéntico a 2A/2B.

---

## File Structure

**Backend (`apps/hub-api/src/salestracker/`):**
- `customer-item-sales.ts` + `.test.ts` (nuevo) — `mapCustomerItemRow` + `getCustomerItemSalesRows(db,{tipo,anio})`.
- `customer-month-sales.ts` + `.test.ts` (nuevo) — `mapCustomerMonthRow` + `getCustomerMonthSalesRows(db,{tipo,anio})`.
- `margin-by-customer.ts` + `.test.ts` (nuevo) — `mapMarginCustomerRow` + `getMarginByCustomerRows(db,{tipo,anio})`.
- `types.ts` (modificar) — añadir `CustomerItemRow`, `CustomerMonthRow`, `MarginCustomerRow`.
- `router.ts` (modificar) — 3 rutas nuevas (reusa el helper `parseAnio` ya presente de 2B).

**Frontend (`apps/salestracker/src/`):**
- `lib/analytics-margin.ts` + `.test.ts` (portar mínimo: `deriveMargin`).
- `lib/customer-item.ts` + `.test.ts` (portar verbatim).
- `lib/customer-detail.ts` + `.test.ts` (portar verbatim).
- `api.ts` (modificar) — tipos + `fetchCustomerItemSales`, `fetchCustomerMonthSales`, `fetchMarginByCustomer`.
- `pages/ClienteDetalle.tsx` (nuevo) — la ficha (6 tarjetas).
- `pages/Clientes.tsx` (modificar) — celda de cliente como `<Link>` a la ficha.
- `App.tsx` (modificar) — ruta `clientes/:customer`.

---

## Task 1: Backend — 3 endpoints (tipos + módulos + rutas, TDD)

**Files:** Modify `types.ts`, `router.ts`; Create 3 módulos + 3 tests en `apps/hub-api/src/salestracker/`.

- [ ] **Step 1: Tipos en `types.ts`** (añadir al final)
```typescript
// Ventas por (cliente, artículo) en un año. GET /api/salestracker/customer-item-sales.
export interface CustomerItemRow {
  customer: string;
  sku: string | null;
  marca: string | null;
  nombre: string;
  categoria: string | null;
  cantidad: number;
  importe: number;
}

// Ventas por (cliente, mes) en un año. GET /api/salestracker/customer-month-sales.
export interface CustomerMonthRow {
  customer: string;
  mes: number; // 1-12
  importe: number;
}

// Ventas y costo estándar por cliente en un año. GET /api/salestracker/margin-by-customer.
export interface MarginCustomerRow {
  customer: string;
  ventas: number;
  costo: number;
}
```

- [ ] **Step 2: `customer-item-sales.ts` (TDD)** — test primero:
```typescript
// apps/hub-api/src/salestracker/customer-item-sales.test.ts
import { describe, it, expect } from 'vitest';
import { mapCustomerItemRow } from './customer-item-sales.js';

describe('mapCustomerItemRow', () => {
  it('coacciona una fila cruda', () => {
    const raw = { customer: 'ACME', sku: 'A1', marca: 'X', nombre: 'Sensor', categoria: 'Equipos', cantidad: '2', importe: '500.5' };
    expect(mapCustomerItemRow(raw)).toEqual({ customer: 'ACME', sku: 'A1', marca: 'X', nombre: 'Sensor', categoria: 'Equipos', cantidad: 2, importe: 500.5 });
  });
  it('normaliza nulos', () => {
    expect(mapCustomerItemRow({ customer: 'X', sku: null, marca: null, nombre: null, categoria: null, cantidad: null, importe: null }))
      .toEqual({ customer: 'X', sku: null, marca: null, nombre: '', categoria: null, cantidad: 0, importe: 0 });
  });
});
```
Correr → FALLA. Implementar (SQL verbatim de `reference/.../src/db/hub-customer-item-sales.ts`, año bound `$1`):
```typescript
// apps/hub-api/src/salestracker/customer-item-sales.ts
import type { Pool } from '@algarpibe/zoho-sync';
import type { CustomerItemRow, RecordTypeIO } from './types.js';

const SOURCES = {
  SALES_ORDER: { lines: 'books.salesorder_line_items', header: 'books.sales_orders', fk: 'salesorder_id' },
  INVOICE: { lines: 'books.invoice_line_items', header: 'books.invoices', fk: 'invoice_id' },
} as const;

export function mapCustomerItemRow(r: Record<string, unknown>): CustomerItemRow {
  const cantidad = Number(r.cantidad);
  const importe = Number(r.importe);
  return {
    customer: String(r.customer),
    sku: (r.sku as string | null) ?? null,
    marca: (r.marca as string | null) ?? null,
    nombre: String(r.nombre ?? ''),
    categoria: (r.categoria as string | null) ?? null,
    cantidad: Number.isFinite(cantidad) ? cantidad : 0,
    importe: Number.isFinite(importe) ? importe : 0,
  };
}

export async function getCustomerItemSalesRows(db: Pool, f: { tipo: RecordTypeIO; anio: number }): Promise<CustomerItemRow[]> {
  const src = f.tipo === 'SALES_ORDER' ? SOURCES.SALES_ORDER : SOURCES.INVOICE;
  const sql = `
    SELECT h.customer_name AS customer, it.sku, it.raw->>'manufacturer' AS marca,
           it.name AS nombre, it.category_name AS categoria,
           sum(l.quantity) AS cantidad,
           round(sum(l.bcy_rate * l.quantity *
             COALESCE(1 - COALESCE((h.raw->>'bcy_discount_total')::numeric,0) / NULLIF(h.bcy_sub_total,0), 1)
           )::numeric, 2)::float8 AS importe
    FROM ${src.lines} l
    JOIN ${src.header} h ON h.${src.fk} = l.${src.fk}
    JOIN books.items it ON it.item_id = l.item_id
    WHERE extract(year from h.date) = $1
      AND l.bcy_rate IS NOT NULL
      AND h.status NOT IN ('void','draft')
      AND h.customer_name IS NOT NULL
    GROUP BY h.customer_name, it.sku, it.raw->>'manufacturer', it.name, it.category_name`;
  const { rows } = await db.query(sql, [f.anio]);
  return (rows as Record<string, unknown>[]).map(mapCustomerItemRow);
}
```
Correr → PASA (2).

- [ ] **Step 3: `customer-month-sales.ts` (TDD)** — test primero:
```typescript
// apps/hub-api/src/salestracker/customer-month-sales.test.ts
import { describe, it, expect } from 'vitest';
import { mapCustomerMonthRow } from './customer-month-sales.js';

describe('mapCustomerMonthRow', () => {
  it('coacciona', () => {
    expect(mapCustomerMonthRow({ customer: 'ACME', mes: '3', importe: '900.5' })).toEqual({ customer: 'ACME', mes: 3, importe: 900.5 });
  });
  it('importe no numérico → 0', () => {
    expect(mapCustomerMonthRow({ customer: 'X', mes: 1, importe: null }).importe).toBe(0);
  });
});
```
Implementar (SQL verbatim de `reference/.../hub-customer-month-sales.ts`):
```typescript
// apps/hub-api/src/salestracker/customer-month-sales.ts
import type { Pool } from '@algarpibe/zoho-sync';
import type { CustomerMonthRow, RecordTypeIO } from './types.js';

const SOURCES = {
  SALES_ORDER: { lines: 'books.salesorder_line_items', header: 'books.sales_orders', fk: 'salesorder_id' },
  INVOICE: { lines: 'books.invoice_line_items', header: 'books.invoices', fk: 'invoice_id' },
} as const;

export function mapCustomerMonthRow(r: Record<string, unknown>): CustomerMonthRow {
  const importe = Number(r.importe);
  return { customer: String(r.customer), mes: Number(r.mes), importe: Number.isFinite(importe) ? importe : 0 };
}

export async function getCustomerMonthSalesRows(db: Pool, f: { tipo: RecordTypeIO; anio: number }): Promise<CustomerMonthRow[]> {
  const src = f.tipo === 'SALES_ORDER' ? SOURCES.SALES_ORDER : SOURCES.INVOICE;
  const sql = `
    SELECT h.customer_name AS customer,
           extract(month from h.date)::int AS mes,
           round(sum(l.bcy_rate * l.quantity *
             COALESCE(1 - COALESCE((h.raw->>'bcy_discount_total')::numeric, 0) / NULLIF(h.bcy_sub_total, 0), 1)
           )::numeric, 2)::float8 AS importe
    FROM ${src.lines} l
    JOIN ${src.header} h ON h.${src.fk} = l.${src.fk}
    WHERE extract(year from h.date) = $1
      AND l.bcy_rate IS NOT NULL
      AND h.status NOT IN ('void','draft')
      AND h.customer_name IS NOT NULL
    GROUP BY h.customer_name, extract(month from h.date)`;
  const { rows } = await db.query(sql, [f.anio]);
  return (rows as Record<string, unknown>[]).map(mapCustomerMonthRow);
}
```

- [ ] **Step 4: `margin-by-customer.ts` (TDD)** — test primero:
```typescript
// apps/hub-api/src/salestracker/margin-by-customer.test.ts
import { describe, it, expect } from 'vitest';
import { mapMarginCustomerRow } from './margin-by-customer.js';

describe('mapMarginCustomerRow', () => {
  it('coacciona', () => {
    expect(mapMarginCustomerRow({ customer: 'ACME', ventas: '1000', costo: '600' })).toEqual({ customer: 'ACME', ventas: 1000, costo: 600 });
  });
  it('no numéricos → 0', () => {
    expect(mapMarginCustomerRow({ customer: 'X', ventas: null, costo: 'x' })).toEqual({ customer: 'X', ventas: 0, costo: 0 });
  });
});
```
Implementar (SQL verbatim de `getHubMarginByCustomer` en `reference/.../hub-margin.ts` — incluye las constantes `VENTAS`, `COSTO`, `COMMON_WHERE`):
```typescript
// apps/hub-api/src/salestracker/margin-by-customer.ts
import type { Pool } from '@algarpibe/zoho-sync';
import type { MarginCustomerRow, RecordTypeIO } from './types.js';

const SOURCES = {
  SALES_ORDER: { lines: 'books.salesorder_line_items', header: 'books.sales_orders', fk: 'salesorder_id' },
  INVOICE: { lines: 'books.invoice_line_items', header: 'books.invoices', fk: 'invoice_id' },
} as const;

const VENTAS = `round(sum(l.bcy_rate * l.quantity *
  COALESCE(1 - COALESCE((h.raw->>'bcy_discount_total')::numeric, 0) / NULLIF(h.bcy_sub_total, 0), 1)
)::numeric, 2)::float8`;
const COSTO = `round(sum(NULLIF(it.raw->>'purchase_rate','')::numeric * l.quantity)::numeric, 2)::float8`;
const COMMON_WHERE = `l.bcy_rate IS NOT NULL
      AND h.status NOT IN ('void','draft')
      AND NULLIF(it.raw->>'purchase_rate','')::numeric > 0`;

export function mapMarginCustomerRow(r: Record<string, unknown>): MarginCustomerRow {
  const ventas = Number(r.ventas);
  const costo = Number(r.costo);
  return { customer: String(r.customer), ventas: Number.isFinite(ventas) ? ventas : 0, costo: Number.isFinite(costo) ? costo : 0 };
}

export async function getMarginByCustomerRows(db: Pool, f: { tipo: RecordTypeIO; anio: number }): Promise<MarginCustomerRow[]> {
  const s = f.tipo === 'SALES_ORDER' ? SOURCES.SALES_ORDER : SOURCES.INVOICE;
  const sql = `
    SELECT h.customer_name AS customer, ${VENTAS} AS ventas, ${COSTO} AS costo
    FROM ${s.lines} l
    JOIN ${s.header} h ON h.${s.fk} = l.${s.fk}
    JOIN books.items it ON it.item_id = l.item_id
    WHERE extract(year from h.date) = $1
      AND h.customer_name IS NOT NULL
      AND ${COMMON_WHERE}
    GROUP BY h.customer_name`;
  const { rows } = await db.query(sql, [f.anio]);
  return (rows as Record<string, unknown>[]).map(mapMarginCustomerRow);
}
```

- [ ] **Step 5: Rutas en `router.ts`** — importar los 3 `get*Rows` y añadir (reusa el `parseAnio` ya definido en 2B; `RecordTypeIO` ya importado):
```typescript
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
```
> Si `parseAnio` no está a nivel de módulo (se definió dentro de otro sitio), muévelo a nivel de módulo en `router.ts`.

- [ ] **Step 6: Verificar** `cd apps/hub-api && npx tsc --noEmit && npx vitest run src/salestracker/` → limpio + tests pasan (mappers). Confirmar que cada SQL coincide **verbatim** con su origen en `reference/`.
- [ ] **Step 7: Commits** (uno por endpoint o uno agrupado):
  - `feat(hub-api): endpoints customer-item-sales/customer-month-sales/margin-by-customer (SQL portado)`

---

## Task 2: Frontend — libs portadas + fetchers

**Files:** Create `apps/salestracker/src/lib/{analytics-margin,customer-item,customer-detail}.ts` (+ tests); Modify `api.ts`.

- [ ] **Step 1: Tipos + fetchers en `api.ts`** (reusa `API_BASE`/`authHeaders`/`mensajeDeError`/`RecordTypeIO`; `CustomerYearRow` ya existe):
```typescript
export interface CustomerItemRow { customer: string; sku: string | null; marca: string | null; nombre: string; categoria: string | null; cantidad: number; importe: number; }
export interface CustomerMonthRow { customer: string; mes: number; importe: number; }
export interface MarginCustomerRow { customer: string; ventas: number; costo: number; }

async function fetchRows<T>(path: string, params: Record<string, string>, contexto: string): Promise<T[]> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${API_BASE}${path}?${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const data = (await res.json()) as { rows?: T[] };
  if (!Array.isArray(data.rows)) throw new Error(`Formato inesperado del hub (${contexto}).`);
  return data.rows;
}

export const fetchCustomerItemSales = (p: { tipo: RecordTypeIO; anio: number }) =>
  fetchRows<CustomerItemRow>('/api/salestracker/customer-item-sales', { tipo: p.tipo, anio: String(p.anio) }, 'cliente×artículo');
export const fetchCustomerMonthSales = (p: { tipo: RecordTypeIO; anio: number }) =>
  fetchRows<CustomerMonthRow>('/api/salestracker/customer-month-sales', { tipo: p.tipo, anio: String(p.anio) }, 'estacionalidad');
export const fetchMarginByCustomer = (p: { tipo: RecordTypeIO; anio: number }) =>
  fetchRows<MarginCustomerRow>('/api/salestracker/margin-by-customer', { tipo: p.tipo, anio: String(p.anio) }, 'margen');
```
> Nota: `fetchRows` es un helper genérico nuevo. Si prefieres mantener el estilo explícito de `fetchSales`/`fetchItemSales`, escribe los 3 fetchers a mano — pero `fetchRows` es DRY y equivalente. El revisor aceptará cualquiera de las dos.

- [ ] **Step 2: `lib/analytics-margin.ts` (mínimo) + test**
```typescript
// apps/salestracker/src/lib/analytics-margin.ts
export interface MarginDerived { margen: number; margenPct: number }
export function deriveMargin(ventas: number, costo: number): MarginDerived {
  const margen = ventas - costo;
  return { margen, margenPct: ventas > 0 ? (margen / ventas) * 100 : 0 };
}
```
Test `analytics-margin.test.ts`: `deriveMargin(1000,600)` → `{margen:400, margenPct:40}`; `deriveMargin(0,0)` → `{margen:0, margenPct:0}`; costo>ventas → margen negativo.
> Nota: solo se porta `deriveMargin` (lo que necesita la ficha). `buildMarginByYear/Items/Customers` se portarán en el Plan 3.

- [ ] **Step 3: `lib/customer-item.ts` + test (verbatim)**

Copiar `reference/.../src/lib/customer-item.ts` → target. Cambiar imports: `CustomerItemRow` desde `../api`; `ExcelSheet, ExcelRow` desde `./excel-types`. Resto verbatim (`bucketForCategory`, `BUCKET_LABELS`, `Bucket`, `filterRows`, `groupByCustomer`, `computeGrandTotals`, `customerItemToCsv`, `customerItemToExcel`). Copiar su test `customer-item.test.ts`, adaptar imports.

- [ ] **Step 4: `lib/customer-detail.ts` + test (verbatim)**

Copiar `reference/.../src/lib/customer-detail.ts` → target. Cambiar imports: tipos (`CustomerYearRow, CustomerItemRow, CustomerMonthRow, MarginCustomerRow`) desde `../api`; `bucketForCategory` desde `./customer-item`; `deriveMargin` desde `./analytics-margin`. Resto verbatim (`customerYearSeries`, `customerFirstYear`, `customerTotalVentas`, `customerBuckets`, `customerTopItems`, `customerMonths`, `customerMarginKpi`, `customerHref`). Copiar su test `customer-detail.test.ts`, adaptar imports.

- [ ] **Step 5: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run src/lib/` → todo pasa.
- [ ] **Step 6: Commit** `feat(salestracker): fetchers + portar libs customer-item/customer-detail/analytics-margin (+ tests)`.

---

## Task 3: Frontend — página ClienteDetalle (6 tarjetas) + ruta + filas clicables

**Files:** Create `pages/ClienteDetalle.tsx`; Modify `pages/Clientes.tsx`, `App.tsx`.

- [ ] **Step 1: `ClienteDetalle.tsx`** — estructura de datos + 6 tarjetas (Tailwind plano + recharts, estilo Home/Articulos).

Esqueleto de datos (usar las libs, no reimplementar):
```tsx
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { APP_BASE } from '../appBase';
import { fetchCustomerSales, fetchCustomerItemSales, fetchCustomerMonthSales, fetchMarginByCustomer, type RecordTypeIO } from '../api';
import { customerYearSeries, customerFirstYear, customerTotalVentas, customerBuckets, customerTopItems, customerMonths, customerMarginKpi } from '../lib/customer-detail';
import { BUCKET_LABELS } from '../lib/customer-item';
import { formatUSD, MONTHS } from '../lib/format';

const anioActual = new Date().getFullYear();

export default function ClienteDetalle() {
  const { customer = '' } = useParams();
  const nombre = decodeURIComponent(customer);
  const [tipo, setTipo] = useState<RecordTypeIO>('INVOICE');
  const [anio, setAnio] = useState(anioActual);

  const qYears = useQuery({ queryKey: ['customer-sales', tipo, anioActual - 6, anioActual], queryFn: () => fetchCustomerSales({ tipo, desdeAnio: anioActual - 6, hastaAnio: anioActual }) });
  const qItems = useQuery({ queryKey: ['customer-item-sales', tipo, anio], queryFn: () => fetchCustomerItemSales({ tipo, anio }) });
  const qMonths = useQuery({ queryKey: ['customer-month-sales', tipo, anio], queryFn: () => fetchCustomerMonthSales({ tipo, anio }) });
  const qMargin = useQuery({ queryKey: ['margin-by-customer', tipo, anio], queryFn: () => fetchMarginByCustomer({ tipo, anio }) });

  const evolucion = customerYearSeries(qYears.data ?? [], nombre);
  const ventasAnio = evolucion.find((p) => p.year === anio)?.ventas ?? 0;
  const ventasHist = customerTotalVentas(qYears.data ?? [], nombre);
  const clienteDesde = customerFirstYear(qYears.data ?? [], nombre);
  const buckets = customerBuckets(qItems.data ?? [], nombre);
  const topItems = customerTopItems(qItems.data ?? [], nombre, 15);
  const meses = customerMonths(qMonths.data ?? [], nombre);
  const margen = customerMarginKpi(qMargin.data ?? [], nombre);

  const cargando = qYears.isLoading || qItems.isLoading || qMonths.isLoading || qMargin.isLoading;
  const error = (qYears.error ?? qItems.error ?? qMonths.error ?? qMargin.error) as Error | undefined;

  // ... render (ver abajo)
}
```

Render (plain Tailwind). Cabecera con `<Link to={`${APP_BASE}/clientes`}>← Volver a Clientes</Link>`, `<h1>{nombre}</h1>`, y selectores `<select>` tipo + `<input type="number">` año. Estados: si `error` → mensaje rojo `error.message`; si `cargando` → "Cargando ficha…". Luego 6 tarjetas (cada una `rounded-xl border bg-white p-6`):

1. **KPIs (fila de 4 tiles):** "Ventas {anio}" = `formatUSD(ventasAnio)`; "Margen %" = `${margen.margenPct.toFixed(1)}%`; "Ventas histórico" = `formatUSD(ventasHist)`; "Cliente desde" = `clienteDesde ?? '—'`.

2. **Evolución anual** (barras): `data={evolucion}` (year→ventas). Ejemplo completo:
```tsx
<div className="rounded-xl border bg-white p-6">
  <h2 className="text-lg font-semibold mb-4">Evolución anual</h2>
  <ResponsiveContainer width="100%" height={280}>
    <BarChart data={evolucion}>
      <XAxis dataKey="year" />
      <YAxis tickFormatter={(v) => formatUSD(Number(v))} width={90} />
      <Tooltip formatter={(v) => formatUSD(Number(v))} />
      <Bar dataKey="ventas" fill="#2563eb" radius={[4, 4, 0, 0]} />
    </BarChart>
  </ResponsiveContainer>
</div>
```

3. **Mix por categoría (pie):** `data = (['mano_obra','cr','equipos','operacion'] as const).map(k => ({ name: BUCKET_LABELS[k], value: buckets[k] })).filter(d => d.value > 0)`. `<PieChart><Pie data={...} dataKey="value" nameKey="name" outerRadius={100} label>` con `<Cell fill={...}>` por sector (paleta p. ej. `['#2563eb','#16a34a','#f59e0b','#8b5cf6']`), `<Tooltip formatter={(v)=>formatUSD(Number(v))} />`.

4. **Top artículos** (barras horizontales, top 15): `data={topItems}` (`label`, `importe`). `<BarChart layout="vertical" data={topItems}><XAxis type="number" tickFormatter={formatUSD}/><YAxis type="category" dataKey="label" width={160}/><Tooltip formatter={formatUSD}/><Bar dataKey="importe" fill="#16a34a" radius={[0,4,4,0]}/>`.

5. **Margen** (fila de KPIs): "Ventas" `formatUSD(margen.ventas)`, "Costo" `formatUSD(margen.costo)`, "Margen" `formatUSD(margen.margen)`, "Margen %" `${margen.margenPct.toFixed(1)}%`. Nota: el margen usa costo estándar (solo bienes con `purchase_rate>0`), aclararlo en un subtítulo pequeño ("Margen estimado — costo estándar del maestro").

6. **Estacionalidad** (barras por mes): `data = MONTHS.map((m, i) => ({ mes: m, importe: meses[i] }))`. `<BarChart data={...}><XAxis dataKey="mes"/><YAxis tickFormatter={formatUSD} width={90}/><Tooltip formatter={formatUSD}/><Bar dataKey="importe" fill="#0ea5e9" radius={[4,4,0,0]}/>`.

Sigue el estilo de `Home.tsx`/`Articulos.tsx`. Layout: `<div className="p-8 space-y-6">`, KPIs en `grid grid-cols-2 md:grid-cols-4 gap-4`, gráficos en `grid grid-cols-1 lg:grid-cols-2 gap-6` donde encaje.

- [ ] **Step 2: `Clientes.tsx` — celda de cliente clicable**

En la tabla de `Clientes.tsx`, la celda del nombre pasa a ser un enlace a la ficha:
```tsx
<Link to={`${APP_BASE}/clientes/${encodeURIComponent(row.customer)}`} className="text-blue-600 hover:underline">{row.customer}</Link>
```
(importa `Link` de `react-router-dom` y `APP_BASE` de `../appBase`.) La fila TOTAL NO es enlace.

- [ ] **Step 3: `App.tsx` — ruta de la ficha** (tras `clientes`):
```tsx
<Route path="clientes/:customer" element={<ClienteDetalle />} />
```
(`import ClienteDetalle from './pages/ClienteDetalle';`). Verifica el orden: `clientes` (índice de la matriz) y `clientes/:customer` (ficha) son rutas hermanas; react-router elige la más específica.

- [ ] **Step 4: Verificar**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
Expected: compila, tests pasan, build del portal exit 0.

- [ ] **Step 5: Commit** `feat(salestracker): ficha de cliente (6 tarjetas) + filas de matriz clicables`.

---

## Task 4: Verificación end-to-end + handoff

- [ ] **Step 1: Verificación completa**
```bash
cd apps/hub-api && npx tsc --noEmit && npx vitest run src/salestracker/
cd ../salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
Reportar salida real.

- [ ] **Step 2: Prueba local de endpoints (si hay BD)** con un token válido:
```bash
curl.exe -s -H "Authorization: Bearer <TOKEN>" "http://localhost:3001/api/salestracker/margin-by-customer?tipo=INVOICE&anio=2026" | head -c 300
```
- [ ] **Step 3: Handoff:** merge/push + redeploy hub-api + portal; verificar en `/salestracker/clientes` que las filas enlazan a `/salestracker/clientes/<cliente>` y que la ficha muestra las 6 tarjetas con datos reales.

---

## Self-Review (cobertura)
- 3 endpoints (SQL portado, validación anio, cached): T1. ✅
- Libs customer-item/customer-detail portadas + analytics-margin mínima + tests: T2. ✅
- Fetchers: T2. ✅
- Ficha con 6 tarjetas (recharts, Tailwind plano) + ruta + filas clicables: T3. ✅
- Nav absoluta respetada (enlaces con APP_BASE, no customerHref): T3. ✅
- Diferido: buildMarginByYear/Items (Plan 3), export de la ficha (no aplica). Anotado.

Sin placeholders. Tipos consistentes (CustomerItemRow/CustomerMonthRow/MarginCustomerRow backend→api→libs). Sin `item_id` (los shapes de estas vistas no lo llevan).

## Próximos: Plan 2D (cliente-articulo, reusa customer-item-sales + libs customer-item/customer-item-compare) · 2E (tablas) · 3 (analítica pesada: analytics/margen/forecast) · 4 (config/escritura) · 5 (cutover).
