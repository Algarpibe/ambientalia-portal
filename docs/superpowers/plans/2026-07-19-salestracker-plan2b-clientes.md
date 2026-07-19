# salestracker → Portal — Plan 2B: página "Clientes" (matriz)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Portar la página **Clientes** (la matriz): tabla Cliente × año (rango) con Total y % de participación, filtros (tipo OV/FAC, rango de años, búsqueda), ordenación por columna (nombre / año / total / Δ%), modo comparar (año A vs B → columna Δ%), y export CSV/copiar — alimentada por un nuevo endpoint de hub-api.

**Architecture:** Nuevo `GET /api/salestracker/customer-sales` en hub-api (SQL portado de `reference/salestracker-next/src/db/hub-customer-sales.ts`, neto de descuento de cabecera). En la sub-app se porta **verbatim** la lib pura `customer-sales.ts` (ya testeada; depende de `compare`/`excel-types` ya portados en 2A) y se añade la página `Clientes` en **Tailwind plano + controles nativos** (misma decisión que 2A: sin shadcn, export CSV+copiar, xlsx diferido). react-query ya está.

**Alcance:** SOLO la matriz. El drill-down `clientes/:customer` (6 tarjetas + 3 endpoints) es el **Plan 2C**; ahí las filas se vuelven clicables. Favoritos y vistas guardadas se **difieren al Plan 4** (dependen de tablas escribibles en hub-api).

**Tech Stack:** hub-api (Express TS NodeNext, Vitest); sub-app Vite (React 19, react-router 7, @tanstack/react-query v5). Patrón idéntico a Plan 2A.

---

## File Structure

**Backend (`apps/hub-api/src/salestracker/`):**
- `customer-sales.ts` (nuevo) — `mapCustomerYearRow` puro + `getCustomerSalesRows(db, {tipo, desdeAnio, hastaAnio})`; SQL portado.
- `customer-sales.test.ts` (nuevo) — Vitest del mapper.
- `types.ts` (modificar) — añadir `CustomerYearRow`.
- `router.ts` (modificar) — `GET /salestracker/customer-sales`.

**Frontend (`apps/salestracker/src/`):**
- `lib/customer-sales.ts` + `lib/customer-sales.test.ts` (portar verbatim de reference; ajustar imports).
- `api.ts` (modificar) — `CustomerYearRow` + `fetchCustomerSales`.
- `pages/Clientes.tsx` (nuevo) — la matriz (Tailwind plano).
- `App.tsx` (modificar) — ruta `clientes`.
- `components/Nav.tsx` (modificar) — enlace "Clientes".

---

## Task 1: Backend — tipos + `customer-sales.ts` (TDD)

**Files:** Modify `types.ts`; Create `customer-sales.ts` + `customer-sales.test.ts` (en `apps/hub-api/src/salestracker/`).

- [ ] **Step 1: Añadir tipo en `types.ts`**
```typescript
// Fila de ventas por cliente y año. Contrato de GET /api/salestracker/customer-sales.
export interface CustomerYearRow {
  customer: string;
  year: number;
  ventas: number;
}
```

- [ ] **Step 2: Test que falla — `customer-sales.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import { mapCustomerYearRow } from './customer-sales.js';

describe('mapCustomerYearRow', () => {
  it('coacciona una fila cruda al contrato CustomerYearRow', () => {
    const raw = { customer: 'ACME', year: '2026', ventas: '9990.5' };
    expect(mapCustomerYearRow(raw)).toEqual({ customer: 'ACME', year: 2026, ventas: 9990.5 });
  });
  it('ventas no numérico → 0', () => {
    expect(mapCustomerYearRow({ customer: 'X', year: 2025, ventas: null }).ventas).toBe(0);
  });
});
```
Run `cd apps/hub-api && npx vitest run src/salestracker/customer-sales.test.ts` → FAIL.

- [ ] **Step 3: Implementar `customer-sales.ts`** (SQL portado verbatim de `reference/salestracker-next/src/db/hub-customer-sales.ts`; tabla por `tipo` en servidor; años bound `$1,$2`)
```typescript
import type { Pool } from '@algarpibe/zoho-sync';
import type { CustomerYearRow, RecordTypeIO } from './types.js';

const SOURCES = {
  SALES_ORDER: { lines: 'books.salesorder_line_items', header: 'books.sales_orders', fk: 'salesorder_id' },
  INVOICE: { lines: 'books.invoice_line_items', header: 'books.invoices', fk: 'invoice_id' },
} as const;

/** Coacciona una fila cruda del hub al contrato CustomerYearRow (pura, testeable). */
export function mapCustomerYearRow(r: Record<string, unknown>): CustomerYearRow {
  const ventas = Number(r.ventas);
  return {
    customer: String(r.customer),
    year: Number(r.year),
    ventas: Number.isFinite(ventas) ? ventas : 0,
  };
}

/** Ventas por cliente y año (rango de años), neto de descuento de cabecera. Lee del zoho-hub. */
export async function getCustomerSalesRows(
  db: Pool,
  f: { tipo: RecordTypeIO; desdeAnio: number; hastaAnio: number },
): Promise<CustomerYearRow[]> {
  const src = f.tipo === 'SALES_ORDER' ? SOURCES.SALES_ORDER : SOURCES.INVOICE;
  const sql = `
    SELECT h.customer_name AS customer,
           extract(year from h.date)::int AS year,
           round(sum(l.bcy_rate * l.quantity *
             COALESCE(1 - COALESCE((h.raw->>'bcy_discount_total')::numeric, 0) / NULLIF(h.bcy_sub_total, 0), 1)
           )::numeric, 2)::float8 AS ventas
    FROM ${src.lines} l
    JOIN ${src.header} h ON h.${src.fk} = l.${src.fk}
    WHERE extract(year from h.date) BETWEEN $1 AND $2
      AND l.bcy_rate IS NOT NULL
      AND h.status NOT IN ('void','draft')
      AND h.customer_name IS NOT NULL
    GROUP BY h.customer_name, extract(year from h.date)`;
  const { rows } = await db.query(sql, [f.desdeAnio, f.hastaAnio]);
  return (rows as Record<string, unknown>[]).map(mapCustomerYearRow);
}
```
Run el test → PASS (2). Commit: `feat(hub-api): customer-sales de salestracker (SQL portado + mapper)`.

---

## Task 2: Backend — endpoint en el router

**Files:** Modify `apps/hub-api/src/salestracker/router.ts`.

- [ ] **Step 1: Añadir el endpoint** (valida `tipo`, y años enteros 2000–2100; `desdeAnio ≤ hastaAnio`)
```typescript
import { getCustomerSalesRows } from './customer-sales.js';
// (RecordTypeIO ya importado en Task 2 de 2A)

const parseAnio = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
};

// dentro de createSalestrackerRouter, antes de `return router;`:
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
```
> Si `RecordTypeIO` no está ya importado en `router.ts`, añádelo al import de `./types.js`.

- [ ] **Step 2: Verificar** `cd apps/hub-api && npx tsc --noEmit && npx vitest run src/salestracker/` → limpio + tests pasan.
- [ ] **Step 3: Commit** `feat(hub-api): GET /salestracker/customer-sales (tipo/desdeAnio/hastaAnio, cached)`.

---

## Task 3: Frontend — portar lib `customer-sales` + fetcher

**Files:** Create `apps/salestracker/src/lib/customer-sales.ts` + `.test.ts`; Modify `apps/salestracker/src/api.ts`.

- [ ] **Step 1: Añadir tipo + fetcher a `api.ts`**
```typescript
// Espejo de apps/hub-api/src/salestracker/types.ts
export interface CustomerYearRow {
  customer: string;
  year: number;
  ventas: number;
}

/** Ventas por cliente y año (tipo OV/FAC, rango de años). */
export async function fetchCustomerSales(params: { tipo: RecordTypeIO; desdeAnio: number; hastaAnio: number }): Promise<CustomerYearRow[]> {
  const qs = new URLSearchParams({ tipo: params.tipo, desdeAnio: String(params.desdeAnio), hastaAnio: String(params.hastaAnio) });
  const res = await fetch(`${API_BASE}/api/salestracker/customer-sales?${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const data = (await res.json()) as { rows?: CustomerYearRow[] };
  if (!Array.isArray(data.rows)) throw new Error('Formato inesperado del hub (clientes).');
  return data.rows;
}
```

- [ ] **Step 2: Portar `customer-sales.ts` + su test**

Copiar `reference/.../src/lib/customer-sales.ts` → `apps/salestracker/src/lib/customer-sales.ts`. Cambiar imports:
- `import type { CustomerYearRow } from "@/types/database"` → `import type { CustomerYearRow } from '../api'`.
- `import type { ExcelSheet } from "@/lib/excel-types"` → `from './excel-types'`.
- `import { computeDelta } from "@/lib/compare"` → `from './compare'`.
El resto (buildCustomerMatrix, computeColumnTotals, sortCustomerMatrix, filterCustomers, customerMatrixToCsv, customerMatrixToExcel, tipos `CustomerMatrixRow`/`CustomerSortKey`/`CustomerSortDir`) va verbatim.
Copiar `reference/.../src/lib/__tests__/customer-sales.test.ts` → `apps/salestracker/src/lib/customer-sales.test.ts`, ajustando imports (`./customer-sales`, `../api`).

- [ ] **Step 3: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run src/lib/` → todos los tests pasan.
- [ ] **Step 4: Commit** `feat(salestracker): fetchCustomerSales + portar lib customer-sales + test`.

---

## Task 4: Frontend — página Clientes (matriz, Tailwind plano)

**Files:** Create `apps/salestracker/src/pages/Clientes.tsx`; Modify `Nav.tsx`, `App.tsx`.

**Comportamiento:** matriz Cliente × año. Filtros: tipo (OV/FAC), rango de años (desde/hasta, default `anioActual-3`..`anioActual`), búsqueda por nombre. Columnas: Cliente, una por año del rango (importe), Total, % (participación sobre el gran total). Cabeceras clicables ordenan (`customer`/`total`/un año/`delta`). Toggle "Comparar": inputs año A / año B (dentro del rango) → muestra columna **Δ%** = `computeDelta(byYear[A], byYear[B]).deltaPct` y permite ordenar por `delta`. Export CSV (descarga) + Copiar (TSV). Estados carga/error.

- [ ] **Step 1: Implementar `Clientes.tsx`**

Usa las libs (no reimplementar): `buildCustomerMatrix`, `computeColumnTotals`, `filterCustomers`, `sortCustomerMatrix`, `customerMatrixToCsv` de `../lib/customer-sales`; `formatDeltaPct` de `../lib/compare`; `formatUSD` de `../lib/format`; `fetchCustomerSales` de `../api`. Detalles:
- Estado: `tipo` ('INVOICE'), `desdeAnio` (anioActual-3), `hastaAnio` (anioActual), `search` (''), `sortKey` ('total'), `sortDir` ('desc'), `comparar` (false), `anioA` (anioActual), `anioB` (anioActual-1).
- `years = yearRange(desdeAnio, hastaAnio)` (de `../lib/format`; orden descendente para las columnas — o ascendente, elige y sé consistente con las cabeceras).
- `const q = useQuery({ queryKey: ['customer-sales', tipo, desdeAnio, hastaAnio], queryFn: () => fetchCustomerSales({ tipo, desdeAnio, hastaAnio }) });`
- `matrix = buildCustomerMatrix(q.data ?? [])`; `filtered = filterCustomers(matrix, search)`; `sorted = sortCustomerMatrix(filtered, sortKey, sortDir, comparar ? { a: anioA, b: anioB } : undefined)`; `totals = computeColumnTotals(sorted, years)`; `grand = totals.grand`.
- `pct = (n) => grand > 0 ? ((n/grand)*100).toFixed(1)+'%' : '0%'`.
- Tabla: cabecera Cliente (sort 'customer') + un `<th>` por año (sort ese año, número) + Total (sort 'total') + % + (si comparar) Δ% (sort 'delta'). Celdas con `formatUSD`. Fila TOTAL al pie (de `totals`). ▲/▼ en la columna activa. `toggleSort(key)`: nueva col → key + 'desc'; col activa → invierte dir.
- Export: "CSV" → `customerMatrixToCsv(sorted, years, grand)` en Blob `text/csv;charset=utf-8`, filename `clientes-${tipo}-${desdeAnio}_${hastaAnio}.csv`; "Copiar" → helper local `matrixToTsv(sorted, years, grand)` (mismas columnas que el CSV, unidas por `\t`) al portapapeles. Deshabilitar si no hay filas.
- Controles nativos (`<select>` tipo, `<input type="number">` desde/hasta año y A/B, `<input>` búsqueda, checkbox Comparar). Estética plana como `Home.tsx`/`Articulos.tsx` (`p-8 space-y-6`, tabla `w-full text-sm`, cabecera `bg-gray-50`). Sin shadcn. Carga: "Cargando clientes…"; error: `(q.error as Error).message`.
- NOTA: las filas NO son enlaces todavía (el drill-down es el Plan 2C).

- [ ] **Step 2: Nav — añadir enlace "Clientes"** en `apps/salestracker/src/components/Nav.tsx`, tras el de Artículos:
```tsx
      <NavLink to="clientes" className={link}>Clientes</NavLink>
```

- [ ] **Step 3: App.tsx — añadir la ruta** tras la de `articulos`:
```tsx
        <Route path="clientes" element={<Clientes />} />
```
(y `import Clientes from './pages/Clientes';`).

- [ ] **Step 4: Verificar**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
Expected: compila, tests pasan, build del portal exit 0.

- [ ] **Step 5: Commit** `feat(salestracker): página Clientes (matriz año×cliente, filtros, comparar, export)`.

---

## Task 5: Verificación end-to-end + handoff

- [ ] **Step 1: Verificación completa**
```bash
cd apps/hub-api && npx tsc --noEmit && npx vitest run src/salestracker/
cd ../salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
Reportar salida real.

- [ ] **Step 2: Prueba local del endpoint (si hay BD)**
```bash
curl.exe -s -H "Authorization: Bearer <TOKEN>" "http://localhost:3001/api/salestracker/customer-sales?tipo=INVOICE&desdeAnio=2023&hastaAnio=2026" | head -c 400
```
Expected: `{"rows":[{"customer":…,"year":…,"ventas":…}]}`. `400` si años inválidos.

- [ ] **Step 3: Handoff:** merge/push + redeploy hub-api + portal; verificar `portal.ambientalia.cloud/salestracker/clientes`.

---

## Self-Review (cobertura)
- Endpoint `customer-sales` (SQL portado, validación, cached): T1-2. ✅
- Lib `customer-sales` portada verbatim + test: T3. ✅
- Fetcher + tipo: T3. ✅
- Página matriz (filtros, orden, comparar Δ%, export CSV/copiar) Tailwind plano: T4. ✅
- Diferido: favoritos/vistas guardadas (Plan 4); filas clicables + drill-down (Plan 2C). Anotado.

Sin placeholders. Tipos consistentes: `CustomerYearRow` (backend→api→lib); `CustomerMatrixRow`/`CustomerSortKey` del lib usados en la página.

## Próximos: Plan 2C (drill-down clientes/:customer) · 2D (cliente-articulo) · tablas · 3 (analítica) · 4 (config/escritura) · 5 (cutover).
