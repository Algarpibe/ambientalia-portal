# salestracker → Portal — Plan 2A: página "Artículos"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar la página **Artículos** de salestracker al portal: tabla de ventas por SKU/artículo (cantidad, importe, precio promedio) con filtros (tipo OV/FAC, rango de fechas, búsqueda), ordenación, modo comparar año A vs B, y export CSV/copiar — alimentada por un nuevo endpoint de hub-api que lee del `zoho-hub`.

**Architecture:** Se añade `GET /api/salestracker/item-sales` a hub-api (SQL portado de `reference/salestracker-next/src/db/hub-item-sales.ts`). En la sub-app Vite se portan **verbatim** las libs puras ya testeadas (`compare.ts`, `item-sales.ts`, `item-compare.ts`) con sus tests, se añade un provider de `@tanstack/react-query`, una navegación interna mínima (Home / Artículos), y la página `Articulos` construida con **Tailwind plano + controles nativos** (sin primitivas shadcn/base-ui, para evitar la reconciliación Tailwind v4→v3). Export CSV + copiar al portapapeles en cliente; **xlsx se difiere**.

**Tech Stack:** hub-api (Express + TS NodeNext, Vitest); sub-app Vite (React 19, react-router-dom 7, @tanstack/react-query, recharts ya presente). Patrón establecido en el Plan 1.

**Decisiones de diseño (vs. la app Next de referencia):**
- **UI en Tailwind plano + controles nativos** (`<select>`, `<input>`, `<table>`), NO se portan las primitivas `@/components/ui/*` (shadcn sobre base-ui + tokens Tailwind v4). La Home del Plan 1 ya probó que Tailwind plano renderiza bien en el portal.
- **Export:** CSV (descarga) + copiar (TSV al portapapeles), ambos en cliente. **xlsx diferido** a un plan de fundaciones posterior (evita exceljs/server-action ahora).
- **react-query** se introduce aquí como fundación compartida (lo reusarán los planes 2B–2E).
- Se añade **navegación interna** a la sub-app (hoy solo tiene Home).

---

## File Structure

**Backend (hub-api) — módulo `apps/hub-api/src/salestracker/`:**
- `item-sales.ts` (nuevo) — porta `getHubItemSales` (SQL de `hub-item-sales.ts`); `mapItemSalesRow` puro + `getItemSalesRows(db, {tipo, desde, hasta})`.
- `item-sales.test.ts` (nuevo) — Vitest de `mapItemSalesRow`.
- `router.ts` (modificar) — añadir `GET /salestracker/item-sales`.
- `types.ts` (modificar) — añadir `ItemSalesRow` + `RecordTypeIO`.

**Frontend (sub-app `apps/salestracker/src/`):**
- `lib/compare.ts` + `lib/compare.test.ts` (portar verbatim de reference).
- `lib/item-sales.ts` + `lib/item-sales.test.ts` (portar; adaptar imports; conservar `itemsToCsv`; se mantiene `itemsToExcel`+`excel-types` para reuso futuro pero no se cablea xlsx).
- `lib/excel-types.ts` (portar verbatim — 3 tipos).
- `lib/item-compare.ts` + `lib/item-compare.test.ts` (portar verbatim).
- `lib/format.ts` (nuevo) — `formatUSD`, `MONTHS`, `yearRange` (constantes mínimas que la página necesita; portadas de `lib/constants`).
- `api.ts` (modificar) — añadir `ItemSalesRow`, `RecordTypeIO`, `fetchItemSales`.
- `components/QueryProvider.tsx` (nuevo) — provider de react-query.
- `components/Nav.tsx` (nuevo) — navegación interna (Home / Artículos) con `NavLink`.
- `pages/Articulos.tsx` (nuevo) — la página (Tailwind plano).
- `pages/ItemCompareTable.tsx` (nuevo) — sub-tabla de comparación (Tailwind plano).
- `App.tsx` (modificar) — envolver en QueryProvider + layout con Nav + rutas `/` y `/articulos`.

---

## Task 1: Backend — tipos + módulo `item-sales.ts` (TDD)

**Files:**
- Modify: `apps/hub-api/src/salestracker/types.ts`
- Create: `apps/hub-api/src/salestracker/item-sales.ts`
- Test: `apps/hub-api/src/salestracker/item-sales.test.ts`

- [ ] **Step 1: Añadir tipos en `types.ts`**

Añade al final de `apps/hub-api/src/salestracker/types.ts`:
```typescript
// Tipo de registro para las vistas OV/FAC (BACKLOG no aplica a item-sales).
export type RecordTypeIO = 'SALES_ORDER' | 'INVOICE';

// Fila de ventas por artículo. Contrato de GET /api/salestracker/item-sales.
export interface ItemSalesRow {
  itemId: string;
  sku: string | null;
  nombre: string;
  categoria: string | null;
  cantidad: number;
  importe: number;
}
```

- [ ] **Step 2: Escribir el test que falla**

```typescript
// apps/hub-api/src/salestracker/item-sales.test.ts
import { describe, it, expect } from 'vitest';
import { mapItemSalesRow } from './item-sales.js';

describe('mapItemSalesRow', () => {
  it('coacciona una fila cruda al contrato ItemSalesRow', () => {
    const raw = { item_id: 42, sku: 'ABC-1', nombre: 'Sensor', categoria: 'Equipos', cantidad: '3', importe: '1500.5' };
    expect(mapItemSalesRow(raw)).toEqual({
      itemId: '42', sku: 'ABC-1', nombre: 'Sensor', categoria: 'Equipos', cantidad: 3, importe: 1500.5,
    });
  });

  it('normaliza nulos: sku/categoria null, nombre vacío, números a 0', () => {
    const raw = { item_id: 7, sku: null, nombre: null, categoria: null, cantidad: null, importe: null };
    expect(mapItemSalesRow(raw)).toEqual({
      itemId: '7', sku: null, nombre: '', categoria: null, cantidad: 0, importe: 0,
    });
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `cd apps/hub-api && npx vitest run src/salestracker/item-sales.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 4: Implementar `item-sales.ts`**

SQL portado de `reference/salestracker-next/src/db/hub-item-sales.ts` (la tabla se elige en servidor por `tipo`, sin input de usuario → sin inyección; fechas parametrizadas `$1,$2`).
```typescript
// apps/hub-api/src/salestracker/item-sales.ts
import type { Pool } from '@algarpibe/zoho-sync';
import type { ItemSalesRow, RecordTypeIO } from './types.js';

// Tablas por tipo elegidas en servidor (NO input de usuario → sin inyección).
const SOURCES = {
  SALES_ORDER: { lines: 'books.salesorder_line_items', header: 'books.sales_orders', fk: 'salesorder_id' },
  INVOICE: { lines: 'books.invoice_line_items', header: 'books.invoices', fk: 'invoice_id' },
} as const;

/** Coacciona una fila cruda del hub al contrato ItemSalesRow (pura, testeable). */
export function mapItemSalesRow(r: Record<string, unknown>): ItemSalesRow {
  const cantidad = Number(r.cantidad);
  const importe = Number(r.importe);
  return {
    itemId: String(r.item_id),
    sku: (r.sku as string | null) ?? null,
    nombre: String(r.nombre ?? ''),
    categoria: (r.categoria as string | null) ?? null,
    cantidad: Number.isFinite(cantidad) ? cantidad : 0,
    importe: Number.isFinite(importe) ? importe : 0,
  };
}

/** Ventas por artículo entre dos fechas, para OV o FAC. Lee del zoho-hub. */
export async function getItemSalesRows(
  db: Pool,
  f: { tipo: RecordTypeIO; desde: string; hasta: string },
): Promise<ItemSalesRow[]> {
  const src = f.tipo === 'SALES_ORDER' ? SOURCES.SALES_ORDER : SOURCES.INVOICE;
  const sql = `
    SELECT it.item_id, it.sku, it.name AS nombre, it.category_name AS categoria,
           sum(l.quantity) AS cantidad,
           round(sum(l.bcy_rate * l.quantity)::numeric, 2)::float8 AS importe
    FROM ${src.lines} l
    JOIN ${src.header} h ON h.${src.fk} = l.${src.fk}
    JOIN books.items it ON it.item_id = l.item_id
    WHERE h.date BETWEEN $1 AND $2
      AND l.bcy_rate IS NOT NULL
      AND h.status NOT IN ('void','draft')
    GROUP BY it.item_id, it.sku, it.name, it.category_name
    ORDER BY importe DESC`;
  const { rows } = await db.query(sql, [f.desde, f.hasta]);
  return (rows as Record<string, unknown>[]).map(mapItemSalesRow);
}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `cd apps/hub-api && npx vitest run src/salestracker/item-sales.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**
```bash
git add apps/hub-api/src/salestracker/types.ts apps/hub-api/src/salestracker/item-sales.ts apps/hub-api/src/salestracker/item-sales.test.ts
git commit -m "feat(hub-api): item-sales de salestracker (SQL portado + mapper)"
```

---

## Task 2: Backend — endpoint en el router

**Files:**
- Modify: `apps/hub-api/src/salestracker/router.ts`

- [ ] **Step 1: Añadir el endpoint con validación de parámetros**

En `router.ts`: importar `getItemSalesRows` y `RecordTypeIO`, y añadir la ruta. Valida `tipo ∈ {SALES_ORDER, INVOICE}` y `desde/hasta` con formato fecha `YYYY-MM-DD`.
```typescript
import { getItemSalesRows } from './item-sales.js';
import type { RecordTypeIO } from './types.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ...dentro de createSalestrackerRouter, antes de `return router;`:
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
```

- [ ] **Step 2: Verificar compilación + suite backend**

Run: `cd apps/hub-api && npx tsc --noEmit && npx vitest run src/salestracker/`
Expected: compila; tests de `salestracker/` pasan.

- [ ] **Step 3: Commit**
```bash
git add apps/hub-api/src/salestracker/router.ts
git commit -m "feat(hub-api): GET /salestracker/item-sales (tipo/desde/hasta, cached)"
```

---

## Task 3: Frontend — portar libs puras + tests (verbatim)

**Files:**
- Create: `apps/salestracker/src/lib/{compare,item-sales,item-compare,excel-types}.ts`
- Create: `apps/salestracker/src/lib/{compare,item-sales,item-compare}.test.ts`
- Create: `apps/salestracker/src/lib/format.ts`

- [ ] **Step 1: Portar `excel-types.ts` verbatim**

Copiar `reference/salestracker-next/src/lib/excel-types.ts` a `apps/salestracker/src/lib/excel-types.ts` (idéntico, sin imports):
```typescript
export interface ExcelColumn { header: string; width?: number; numFmt?: string }
export interface ExcelRow { cells: (string | number | null)[]; bold?: boolean }
export interface ExcelSheet { name: string; columns: ExcelColumn[]; rows: ExcelRow[] }
```

- [ ] **Step 2: Portar `compare.ts` + su test**

Copiar `reference/.../src/lib/compare.ts` → `apps/salestracker/src/lib/compare.ts` (no tiene imports, verbatim). Copiar `reference/.../src/lib/__tests__/compare.test.ts` → `apps/salestracker/src/lib/compare.test.ts`, ajustando el import a `'./compare'`.

- [ ] **Step 3: Portar `item-sales.ts` + su test**

Copiar `reference/.../src/lib/item-sales.ts` → `apps/salestracker/src/lib/item-sales.ts`. Cambiar los imports:
- `import type { ItemSalesRow } from "@/types/database"` → `import type { ItemSalesRow } from '../api'` (el tipo vive en `api.ts`, Task 5; si aún no existe al correr el test, define `ItemSalesRow` primero en `api.ts` o impórtalo de un `types.ts` local — ver nota).
- `import type { ExcelSheet } from "@/lib/excel-types"` → `import type { ExcelSheet } from './excel-types'`.

> Nota de orden: para que este test compile, el tipo `ItemSalesRow` debe existir. Crea primero el fragmento de `api.ts` con `ItemSalesRow`/`RecordTypeIO` (Task 5 Step 1) — o define `ItemSalesRow` en `lib/item-sales.ts` e impórtalo desde `api.ts`. Recomendado: hacer Task 5 Step 1 (tipos en api.ts) antes de este paso.

Copiar `reference/.../src/lib/__tests__/item-sales.test.ts` → `apps/salestracker/src/lib/item-sales.test.ts`, ajustando imports (`./item-sales`, y el tipo desde `../api`).

- [ ] **Step 4: Portar `item-compare.ts` + su test**

Copiar `reference/.../src/lib/item-compare.ts` → `apps/salestracker/src/lib/item-compare.ts`. Cambiar imports: `ItemSalesRow` desde `../api`; `computeDelta` desde `./compare`. Copiar su test `item-compare.test.ts` ajustando imports.

- [ ] **Step 5: Crear `format.ts`**

```typescript
// apps/salestracker/src/lib/format.ts
export const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'] as const;

export const formatUSD = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/** Años [desde..hasta] descendente. */
export function yearRange(desde: number, hasta: number): number[] {
  const out: number[] = [];
  for (let y = hasta; y >= desde; y--) out.push(y);
  return out;
}
```

- [ ] **Step 6: Ejecutar los tests de libs**

Run: `cd apps/salestracker && npx vitest run src/lib/`
Expected: PASS — todos los tests portados (compare, item-sales, item-compare) + los existentes de rollup.

> Si un test portado referencia helpers no incluidos en este plan (p. ej. algo de `constants`), recórtalo a los casos de las funciones portadas o añade el helper mínimo a `format.ts`. NO borres asserts de la lógica portada.

- [ ] **Step 7: Commit**
```bash
git add apps/salestracker/src/lib/
git commit -m "feat(salestracker): portar libs puras item-sales/item-compare/compare + tests"
```

---

## Task 4: Frontend — react-query provider + navegación interna

**Files:**
- Create: `apps/salestracker/src/components/QueryProvider.tsx`
- Create: `apps/salestracker/src/components/Nav.tsx`
- Modify: `apps/salestracker/package.json` (dep `@tanstack/react-query`)

- [ ] **Step 1: Añadir la dependencia**

Añade `@tanstack/react-query` a `dependencies` en `apps/salestracker/package.json` (usa la versión que ya resuelve el monorepo — mira `apps/customer-profitability/package.json` o el root lock; NO la del reference Next). Luego `npm install` desde la raíz del monorepo.

- [ ] **Step 2: QueryProvider**
```tsx
// apps/salestracker/src/components/QueryProvider.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 } },
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 3: Nav (rutas relativas al mount del portal)**

Usa `NavLink` con rutas relativas para no acoplarse al slug `/salestracker`.
```tsx
// apps/salestracker/src/components/Nav.tsx
import { NavLink } from 'react-router-dom';

const link = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium ${isActive ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`;

export default function Nav() {
  return (
    <nav className="flex gap-2 px-8 py-3 border-b bg-white">
      <NavLink to="." end className={link}>Inicio</NavLink>
      <NavLink to="articulos" className={link}>Artículos</NavLink>
    </nav>
  );
}
```

- [ ] **Step 4: Verificar compilación**

Run: `cd apps/salestracker && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**
```bash
git add apps/salestracker/src/components/ apps/salestracker/package.json package-lock.json
git commit -m "feat(salestracker): react-query provider + navegación interna"
```

---

## Task 5: Frontend — API fetcher `fetchItemSales`

**Files:**
- Modify: `apps/salestracker/src/api.ts`

- [ ] **Step 1: Añadir tipos + fetcher (patrón del `fetchSales` existente)**

Añade a `apps/salestracker/src/api.ts` (reusa `API_BASE`, `authHeaders`, `mensajeDeError` ya presentes):
```typescript
// Espejo de apps/hub-api/src/salestracker/types.ts
export type RecordTypeIO = 'SALES_ORDER' | 'INVOICE';
export interface ItemSalesRow {
  itemId: string;
  sku: string | null;
  nombre: string;
  categoria: string | null;
  cantidad: number;
  importe: number;
}

/** Ventas por artículo (tipo OV/FAC, rango de fechas YYYY-MM-DD). */
export async function fetchItemSales(params: { tipo: RecordTypeIO; desde: string; hasta: string }): Promise<ItemSalesRow[]> {
  const qs = new URLSearchParams({ tipo: params.tipo, desde: params.desde, hasta: params.hasta });
  const res = await fetch(`${API_BASE}/api/salestracker/item-sales?${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const data = (await res.json()) as { rows?: ItemSalesRow[] };
  if (!Array.isArray(data.rows)) throw new Error('Formato inesperado del hub (artículos).');
  return data.rows;
}
```

- [ ] **Step 2: Verificar compilación (incluye que las libs de Task 3 resuelvan `ItemSalesRow` desde aquí)**

Run: `cd apps/salestracker && npx tsc --noEmit && npx vitest run src/lib/`
Expected: compila; tests de libs pasan.

- [ ] **Step 3: Commit**
```bash
git add apps/salestracker/src/api.ts
git commit -m "feat(salestracker): fetchItemSales + tipos ItemSalesRow"
```

---

## Task 6: Frontend — página Articulos + tabla de comparación (Tailwind plano)

**Files:**
- Create: `apps/salestracker/src/pages/ItemCompareTable.tsx`
- Create: `apps/salestracker/src/pages/Articulos.tsx`

**Comportamiento a replicar (de la página de referencia):** filtros = tipo (OV/FAC) + rango de fechas (desde/hasta, por defecto 1 ene – 31 dic del año actual) + búsqueda (SKU/nombre) + select de categoría (derivado de las filas). Tabla ordenable por columnas (SKU, Nombre, Categoría, Cantidad, Importe, Precio promedio) con fila TOTAL. Toggle "Comparar" → muestra `ItemCompareTable` (año A vs año B, dos llamadas al fetcher por rango de año completo). Export: CSV (descarga) + Copiar (TSV al portapapeles). Estados de carga y error.

- [ ] **Step 1: ItemCompareTable (Tailwind plano)**

```tsx
// apps/salestracker/src/pages/ItemCompareTable.tsx
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchItemSales, type RecordTypeIO } from '../api';
import { buildItemCompare } from '../lib/item-compare';
import { formatUSD } from '../lib/format';
import { formatDeltaPct } from '../lib/compare';

export default function ItemCompareTable({ tipo, anioA, anioB, search }: {
  tipo: RecordTypeIO; anioA: number; anioB: number; search: string;
}) {
  const qA = useQuery({ queryKey: ['item-sales', tipo, anioA], queryFn: () => fetchItemSales({ tipo, desde: `${anioA}-01-01`, hasta: `${anioA}-12-31` }) });
  const qB = useQuery({ queryKey: ['item-sales', tipo, anioB], queryFn: () => fetchItemSales({ tipo, desde: `${anioB}-01-01`, hasta: `${anioB}-12-31` }) });

  const rows = useMemo(() => {
    if (!qA.data || !qB.data) return [];
    const q = search.trim().toLowerCase();
    return buildItemCompare(qA.data, qB.data)
      .filter((r) => !q || (r.sku ?? '').toLowerCase().includes(q) || r.nombre.toLowerCase().includes(q))
      .sort((a, b) => b.importeA - a.importeA);
  }, [qA.data, qB.data, search]);

  if (qA.isLoading || qB.isLoading) return <div className="p-6 text-gray-500">Cargando comparación…</div>;
  if (qA.error || qB.error) return <div className="p-6 text-red-600">{String((qA.error ?? qB.error as Error))}</div>;

  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-3 py-2 text-left">SKU</th>
            <th className="px-3 py-2 text-left">Nombre</th>
            <th className="px-3 py-2 text-right">{anioA}</th>
            <th className="px-3 py-2 text-right">{anioB}</th>
            <th className="px-3 py-2 text-right">Δ%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item_id} className="border-t">
              <td className="px-3 py-2">{r.sku ?? '—'}</td>
              <td className="px-3 py-2">{r.nombre}</td>
              <td className="px-3 py-2 text-right">{formatUSD(r.importeA)}</td>
              <td className="px-3 py-2 text-right">{formatUSD(r.importeB)}</td>
              <td className={`px-3 py-2 text-right ${(r.deltaPct ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{formatDeltaPct(r.deltaPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Página Articulos (Tailwind plano, controles nativos)**

Implementa `apps/salestracker/src/pages/Articulos.tsx` con:
- Estado local: `tipo` ('INVOICE'|'SALES_ORDER'), `desde`/`hasta` (default `${yearActual}-01-01` / `-12-31`), `search`, `categoria`, `sortKey`/`sortDir`, `comparar` (bool), `anioA`/`anioB`.
- `useQuery(['item-sales', tipo, desde, hasta], () => fetchItemSales({tipo, desde, hasta}))`.
- Deriva las categorías del resultado (`[...new Set(rows.map(r => r.categoria ?? 'Sin categoría'))].sort()`).
- `filterAndSortItems(rows, {search, categoria, sortKey, sortDir})` + `computeItemTotals` para la fila TOTAL. `precioPromedio` por fila. Todo de `../lib/item-sales`.
- Controles nativos: `<select>` de tipo (Facturas/Órdenes), inputs `<input type="date">` para desde/hasta, `<input>` de búsqueda, `<select>` de categoría, botón/checkbox "Comparar" (al activarlo, inputs de año A/B y render de `<ItemCompareTable>`).
- Cabeceras de tabla clicables que alternan `sortKey`/`sortDir`.
- Export: botón "CSV" → `itemsToCsv(filtered)` en un Blob `text/csv;charset=utf-8` descargado (crea `<a download>`); botón "Copiar" → `navigator.clipboard.writeText(itemsToTsv(filtered))`. Añade un pequeño `itemsToTsv` inline (mismas columnas que CSV pero unidas por `\t` y filas por `\n`) o reutiliza `itemsToCsv` reemplazando `;`→`\t` de forma segura; preferible una función corta local.
- Estados carga/error como en `Home.tsx` (mensajes en español).
- Usa `formatUSD` de `../lib/format`. Estética: mismas clases planas que `Home.tsx` (cards `rounded-xl border bg-white p-6`, tabla `w-full text-sm`, cabecera `bg-gray-50`).

Sigue el estilo visual de `apps/salestracker/src/pages/Home.tsx` (ya en el repo) para consistencia.

- [ ] **Step 3: Verificar compilación**

Run: `cd apps/salestracker && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**
```bash
git add apps/salestracker/src/pages/Articulos.tsx apps/salestracker/src/pages/ItemCompareTable.tsx
git commit -m "feat(salestracker): página Artículos (tabla, filtros, comparar, export CSV/copiar)"
```

---

## Task 7: Frontend — cablear App.tsx (provider + nav + ruta)

**Files:**
- Modify: `apps/salestracker/src/App.tsx`

- [ ] **Step 1: Envolver en QueryProvider + layout con Nav + ruta /articulos**

```tsx
// apps/salestracker/src/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { QueryProvider } from './components/QueryProvider';
import Nav from './components/Nav';
import Home from './pages/Home';
import Articulos from './pages/Articulos';

export default function App() {
  return (
    <QueryProvider>
      <Nav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="articulos" element={<Articulos />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </QueryProvider>
  );
}
```

- [ ] **Step 2: Verificar compilación + build del portal**

Run desde la raíz:
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
Expected: sub-app compila y sus tests pasan; el build del portal (tsc -b && vite build) termina en 0.

- [ ] **Step 3: Commit**
```bash
git add apps/salestracker/src/App.tsx
git commit -m "feat(salestracker): montar Artículos + QueryProvider + Nav en App"
```

---

## Task 8: Verificación end-to-end + handoff

**Files:** ninguno.

- [ ] **Step 1: Verificación completa de la rama**

Run:
```bash
cd apps/hub-api && npx tsc --noEmit && npx vitest run src/salestracker/
cd ../salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
Reportar la salida real (no afirmar éxito sin verla).

- [ ] **Step 2: Prueba local del endpoint (si hay acceso a la BD)**

Con hub-api local (ver `apps/hub-api/.env`) y un token con la app/admin:
```bash
curl.exe -s -H "Authorization: Bearer <TOKEN>" "http://localhost:3001/api/salestracker/item-sales?tipo=INVOICE&desde=2026-01-01&hasta=2026-12-31" | head -c 400
```
Expected: `{"rows":[{"itemId":…,"sku":…,"importe":…}]}`. `400` si faltan/ mal formadas las fechas; `403` sin la app.

- [ ] **Step 3: Handoff de deploy**

Push a origin, redeploy de **hub-api** (endpoint nuevo) y **portal** en EasyPanel. Verificar en `portal.ambientalia.cloud/salestracker/articulos`: tabla con datos reales, filtros, orden, comparar, export CSV/copiar.

---

## Self-Review (cobertura)

- Endpoint `item-sales` (SQL portado, validación de params, cached): Tasks 1-2. ✅
- Libs puras portadas verbatim + tests: Task 3. ✅
- Fundación react-query + nav interna: Task 4. ✅
- Fetcher + tipos: Task 5. ✅
- Página Artículos (filtros, orden, comparar, export CSV/copiar) en Tailwind plano: Task 6. ✅
- Cableado + build del portal: Task 7-8. ✅
- **Diferido (anotado):** export xlsx (necesita exceljs/endpoint — plan de fundaciones posterior); primitivas shadcn/base-ui (se usa Tailwind plano). Ambos fuera de alcance por decisión de diseño.

Sin placeholders TBD. Tipos consistentes: `ItemSalesRow`/`RecordTypeIO` (backend `types.ts` → frontend `api.ts` → libs); `ItemCompareRow.item_id` (snake, del lib portado) usado igual en `ItemCompareTable`.

---

## Próximos planes (tras Plan 2A verde)
- **Plan 2B — clientes + drill-down:** endpoints `customer-sales`, `customer-item-sales`, `customer-month-sales`, `margin-by-customer`; libs `customer-sales`/`customer-detail`/`customer-item`/`analytics-margin`; matriz + 6 tarjetas (recharts). Favoritos/vistas guardadas degradan (Plan 4).
- **Plan 2C — cliente-articulo:** reusa `customer-item-sales`; libs `customer-item`/`customer-item-compare`.
- **Plan 2D — tablas:** reusa el endpoint `/sales` existente; pivote Categoría×mes (config de categorías = Plan 4, o pivote directo sobre `categoryName`).
- **Fundaciones pendientes:** export xlsx (endpoint hub-api o exceljs cliente); enriquecer la Home.
