# salestracker → Portal — Plan 3A: Análisis → pestaña "Comercial"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Crear la página **Análisis** (`/salestracker/analisis`) con una barra de pestañas, y su primera pestaña **Comercial**: 9 tarjetas — Bucket-mix por año (área apilada), Pareto de clientes, Top artículos, Pareto de SKU, Bucket por cliente, Mix de marcas (dona), Nuevos vs recurrentes, Heatmap por mes, Estacionalidad por bucket. Filtros compartidos: tipo (OV/FAC) + año A.

**Architecture:** 1 endpoint nuevo en hub-api (`/category-month-sales`, SQL portado). Se porta la lib pura `analytics-comercial.ts` (verbatim salvo `buildBucketMixByYear`, que se **adapta** a nuestro `SalesRow`). Las 8 tarjetas restantes reusan fetchers ya existentes (sales, customer-sales, item-sales, customer-item, customer-month). Página en **Tailwind plano + recharts** (sin shadcn). La pestaña "Margen" y "Forecast" se añaden en 3B/3C.

**Tech Stack:** hub-api (Express TS, Vitest); sub-app Vite (React 19, react-router 7, @tanstack/react-query v5, recharts). Nav ABSOLUTA (`APP_BASE`).

---

## File Structure
**Backend (`apps/hub-api/src/salestracker/`):**
- `category-month-sales.ts` + `.test.ts` (nuevo) — `mapCategoryMonthRow` + `getCategoryMonthSalesRows(db,{tipo,anio})`.
- `types.ts` (modificar) — añadir `CategoryMonthRow`.
- `router.ts` (modificar) — ruta `/category-month-sales`.

**Frontend (`apps/salestracker/src/`):**
- `lib/analytics-comercial.ts` + `.test.ts` (portar; adaptar `buildBucketMixByYear`).
- `lib/format.ts` (modificar) — añadir `formatCompactUSD` y `SERIES`/paletas.
- `api.ts` (modificar) — `CategoryMonthRow` + `fetchCategoryMonthSales`.
- `pages/Analisis.tsx` (nuevo) — page shell con pestañas + controles compartidos.
- `pages/comercial/` (nuevo) — 9 componentes de tarjeta + un `ChartCard` wrapper.
- `components/Nav.tsx` (modificar) — enlace "Análisis".
- `App.tsx` (modificar) — ruta `analisis`.

---

## Task 1: Backend — endpoint `/category-month-sales` (TDD)

- [ ] **Step 1: Tipo en `types.ts`**
```typescript
// Ventas por (mes, categoría) en un año. GET /api/salestracker/category-month-sales.
export interface CategoryMonthRow {
  mes: number; // 1-12
  categoria: string | null;
  importe: number;
}
```

- [ ] **Step 2: Test que falla — `category-month-sales.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import { mapCategoryMonthRow } from './category-month-sales.js';
describe('mapCategoryMonthRow', () => {
  it('coacciona', () => {
    expect(mapCategoryMonthRow({ mes: '3', categoria: 'Equipos', importe: '500.5' })).toEqual({ mes: 3, categoria: 'Equipos', importe: 500.5 });
  });
  it('categoria null + importe no numérico → 0', () => {
    expect(mapCategoryMonthRow({ mes: 1, categoria: null, importe: null })).toEqual({ mes: 1, categoria: null, importe: 0 });
  });
});
```

- [ ] **Step 3: Implementar `category-month-sales.ts`** (SQL verbatim de `reference/salestracker-next/src/db/hub-category-month-sales.ts`)
```typescript
import type { Pool } from '@algarpibe/zoho-sync';
import type { CategoryMonthRow, RecordTypeIO } from './types.js';

const SOURCES = {
  SALES_ORDER: { lines: 'books.salesorder_line_items', header: 'books.sales_orders', fk: 'salesorder_id' },
  INVOICE: { lines: 'books.invoice_line_items', header: 'books.invoices', fk: 'invoice_id' },
} as const;

export function mapCategoryMonthRow(r: Record<string, unknown>): CategoryMonthRow {
  const importe = Number(r.importe);
  return { mes: Number(r.mes), categoria: (r.categoria as string | null) ?? null, importe: Number.isFinite(importe) ? importe : 0 };
}

export async function getCategoryMonthSalesRows(db: Pool, f: { tipo: RecordTypeIO; anio: number }): Promise<CategoryMonthRow[]> {
  const src = f.tipo === 'SALES_ORDER' ? SOURCES.SALES_ORDER : SOURCES.INVOICE;
  const sql = `
    SELECT extract(month from h.date)::int AS mes,
           it.category_name AS categoria,
           round(sum(l.bcy_rate * l.quantity *
             COALESCE(1 - COALESCE((h.raw->>'bcy_discount_total')::numeric, 0) / NULLIF(h.bcy_sub_total, 0), 1)
           )::numeric, 2)::float8 AS importe
    FROM ${src.lines} l
    JOIN ${src.header} h ON h.${src.fk} = l.${src.fk}
    JOIN books.items it ON it.item_id = l.item_id
    WHERE extract(year from h.date) = $1
      AND l.bcy_rate IS NOT NULL
      AND h.status NOT IN ('void','draft')
    GROUP BY extract(month from h.date), it.category_name`;
  const { rows } = await db.query(sql, [f.anio]);
  return (rows as Record<string, unknown>[]).map(mapCategoryMonthRow);
}
```

- [ ] **Step 4: Ruta en `router.ts`** (reusa `parseAnio`)
```typescript
import { getCategoryMonthSalesRows } from './category-month-sales.js';
// ...
  router.get('/salestracker/category-month-sales', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const tipo = req.query.tipo === 'SALES_ORDER' ? 'SALES_ORDER' : 'INVOICE';
      const anio = parseAnio(req.query.anio);
      if (anio === null) return void res.status(400).json({ error: 'anio inválido (2000-2100)' });
      const rows = await cached(`salestracker:category-month-sales:${tipo}:${anio}`, () => getCategoryMonthSalesRows(db, { tipo: tipo as RecordTypeIO, anio }));
      res.json({ rows });
    } catch (e) { sendError(res, e, 'salestracker_category_month_sales'); }
  });
```

- [ ] **Step 5: Verificar** `cd apps/hub-api && npx tsc --noEmit && npx vitest run src/salestracker/`. Confirmar SQL verbatim vs referencia.
- [ ] **Step 6: Commit** `feat(hub-api): endpoint category-month-sales (SQL portado)`.

---

## Task 2: Frontend — lib comercial + formato + fetcher

- [ ] **Step 1: `format.ts` — añadir helpers**
```typescript
/** USD compacto para ejes/tooltips: $1,2 M / $980 K. */
export const formatCompactUSD = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** Paleta de series por bucket (mano_obra, cr, equipos, operacion). */
export const SERIES = ['#6366f1', '#10b981', '#f59e0b', '#ef4444'] as const;
/** Paleta para categorías/marcas (dona) + color "Otros". */
export const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6'] as const;
export const OTROS_COLOR = '#94a3b8';
```

- [ ] **Step 2: `api.ts` — tipo + fetcher**
```typescript
export interface CategoryMonthRow { mes: number; categoria: string | null; importe: number; }
export const fetchCategoryMonthSales = (p: { tipo: RecordTypeIO; anio: number }) =>
  fetchRows<CategoryMonthRow>('/api/salestracker/category-month-sales', { tipo: p.tipo, anio: String(p.anio) }, 'estacionalidad por categoría');
```
(reusa el helper `fetchRows` creado en 2C.)

- [ ] **Step 3: Portar `analytics-comercial.ts` + test — con UNA adaptación**

Copiar `reference/salestracker-next/src/lib/analytics-comercial.ts` → `apps/salestracker/src/lib/analytics-comercial.ts`. Cambiar imports: tipos (`CustomerYearRow, ItemSalesRow, CustomerItemRow, CustomerMonthRow, CategoryMonthRow`) desde `../api`; `bucketForCategory` desde `./customer-item`.

**Adaptación de `buildBucketMixByYear`** (el resto es verbatim): la referencia consume un shape crudo `MixRecord {categories?:{name}, record_type, record_year, amount_usd}`. Cámbialo para consumir nuestro `SalesRow` (`{categoryName, recordType, year, amountUsd}`):
```typescript
import type { SalesRow } from '../api';
export function buildBucketMixByYear(records: SalesRow[], tipo: string): BucketMixYear[] {
  const map = new Map<number, BucketMixYear>();
  for (const r of records) {
    if (r.recordType !== tipo) continue;
    if (r.year < 2021) continue;
    let row = map.get(r.year);
    if (!row) { row = { year: r.year, mano_obra: 0, cr: 0, equipos: 0, operacion: 0 }; map.set(r.year, row); }
    row[bucketForCategory(r.categoryName)] += r.amountUsd;
  }
  return [...map.values()].sort((a, b) => a.year - b.year);
}
```
Elimina el tipo `MixRecord` (ya no se usa). Las demás funciones (`buildClientPareto`, `topItems`, `buildItemPareto`, `buildBrandMix`, `buildBucketByClient`, `buildNewVsRecurring`, `buildMonthHeatmap`, `buildBucketSeason`) van **verbatim** (consumen `CustomerYearRow`/`ItemSalesRow`/`CustomerItemRow`/`CustomerMonthRow`/`CategoryMonthRow` de `../api`).

Copiar el test `reference/.../src/lib/__tests__/analytics-comercial.test.ts` → `apps/salestracker/src/lib/analytics-comercial.test.ts`, ajustando imports. **Ojo:** el test de `buildBucketMixByYear` usará el shape viejo (`categories`/`record_type`/…); adáptalo al nuevo `SalesRow` (`categoryName`/`recordType`/`year`/`amountUsd`) manteniendo los asserts equivalentes. El resto de tests, verbatim (solo imports).

- [ ] **Step 4: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run src/lib/`.
- [ ] **Step 5: Commit** `feat(salestracker): endpoint category-month + lib analytics-comercial portada (+ tests)`.

---

## Task 3: Página Análisis (shell + controles) + tarjetas 1–4

**Files:** Create `pages/Analisis.tsx`, `pages/comercial/ChartCard.tsx`, `pages/comercial/{BucketMixCard,ClientParetoCard,TopItemsCard,SkuParetoCard}.tsx`; Modify `Nav.tsx`, `App.tsx`.

**Controles compartidos (estado en Analisis.tsx, pasados por props a las tarjetas):** `tipo` (`RecordTypeIO`, default INVOICE), `yearA` (default año actual). Años del `<select>`: 2021..año actual (o `availableYears` de un `fetchSales`). Pestañas: barra con botones; en 3A solo "Comercial" (deja el andamiaje para añadir "Margen"/"Forecast" luego).

- [ ] **Step 1: `ChartCard.tsx`** (wrapper común)
```tsx
import type { ReactNode } from 'react';
export default function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-white p-6">
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 mb-3">{subtitle}</p>}
      <div className={subtitle ? '' : 'mt-3'}>{children}</div>
    </div>
  );
}
```
Cada tarjeta hace su propio `useQuery`, y muestra "Sin datos." (gris) cuando corresponda, "Cargando…" mientras carga y `(error as Error).message` en error.

- [ ] **Step 2: Tarjeta 1 — `BucketMixCard`** (área apilada por año)
- Fetch: `useQuery({ queryKey: ['sales'], queryFn: fetchSales })` (toda la historia; se comparte con otras vistas). Datos: `buildBucketMixByYear(data ?? [], tipo)`.
- Chart: recharts `AreaChart` (height 340). X `year`; 4 `<Area stackId="1" fillOpacity={0.5}>` para `mano_obra`/`cr`/`equipos`/`operacion` con `SERIES[0..3]`; Y `tickFormatter={formatCompactUSD}`; `<Tooltip formatter={(v)=>formatUSD(Number(v))}/>`. Props: `{ tipo }`.

- [ ] **Step 3: Tarjeta 2 — `ClientParetoCard`** (Pareto, top 20) — ejemplo completo:
```tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { fetchCustomerSales, type RecordTypeIO } from '../../api';
import { buildClientPareto } from '../../lib/analytics-comercial';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import ChartCard from './ChartCard';

export default function ClientParetoCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['customer-sales', tipo, year, year], queryFn: () => fetchCustomerSales({ tipo, desdeAnio: year, hastaAnio: year }) });
  const data = buildClientPareto(q.data ?? []).slice(0, 20);
  return (
    <ChartCard title="Pareto de clientes" subtitle="Top 20 · la línea es el % acumulado (referencia 80%).">
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : data.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={data} margin={{ bottom: 60 }}>
            <XAxis dataKey="customer" angle={-40} textAnchor="end" height={80} interval={0} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="l" tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v, n) => (n === 'cumPct' ? `${Number(v).toFixed(1)}%` : formatUSD(Number(v)))} />
            <ReferenceLine yAxisId="r" y={80} stroke="#ef4444" strokeDasharray="4 4" />
            <Bar yAxisId="l" dataKey="ventas" fill="#2563eb" />
            <Line yAxisId="r" dataKey="cumPct" stroke="#f59e0b" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
```
(El `onClick` de barra para drill-down es opcional; si se implementa, navegar a `${APP_BASE}/clientes/${encodeURIComponent(customer)}`.)

- [ ] **Step 4: Tarjeta 3 — `TopItemsCard`** (barra horizontal, top 15, toggle importe/cantidad)
- Fetch: `useQuery({ queryKey: ['item-sales', tipo, `${year}-01-01`, `${year}-12-31`], queryFn: () => fetchItemSales({ tipo, desde: `${year}-01-01`, hasta: `${year}-12-31` }) })`. Datos: `topItems(data ?? [], metric, 15)` con estado local `metric: 'importe'|'cantidad'`.
- Chart: `BarChart layout="vertical"` (height 420). Y `dataKey="nombre"` width 180; X numérico `dataKey={metric}` con `tickFormatter` = `formatCompactUSD` si importe, número si cantidad; `Bar` color `#0ea5e9`. Dos botones para alternar `metric`.

- [ ] **Step 5: Tarjeta 4 — `SkuParetoCard`** (Pareto, top 30) — misma query que TopItems (comparte queryKey → dedupe). Datos: `buildItemPareto(data ?? []).slice(0, 30)`. Chart: igual patrón que ClientParetoCard pero X `dataKey="label"` (angle -45, height 90), Bar `importe`, Line `cumPct`, ReferenceLine 80.

- [ ] **Step 6: `Analisis.tsx` (shell)** — barra de pestañas + controles + grid de tarjetas
```tsx
import { useState } from 'react';
import type { RecordTypeIO } from '../api';
import BucketMixCard from './comercial/BucketMixCard';
import ClientParetoCard from './comercial/ClientParetoCard';
import TopItemsCard from './comercial/TopItemsCard';
import SkuParetoCard from './comercial/SkuParetoCard';
// (tarjetas 5–9 se importan en la Task 4)

const anioActual = new Date().getFullYear();
const YEARS: number[] = [];
for (let y = anioActual; y >= 2021; y--) YEARS.push(y);

export default function Analisis() {
  const [tipo, setTipo] = useState<RecordTypeIO>('INVOICE');
  const [yearA, setYearA] = useState(anioActual);
  const [tab] = useState<'comercial'>('comercial'); // 'margen'/'forecast' en 3B/3C

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Análisis</h1>
        <p className="text-gray-500">Analítica comercial en vivo del hub.</p>
      </header>
      {/* Pestañas (solo Comercial por ahora) */}
      <div className="flex gap-2 border-b">
        <button className="px-3 py-2 text-sm font-medium border-b-2 border-blue-600 text-blue-600">Comercial</button>
      </div>
      {/* Controles compartidos */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={tipo} onChange={(e) => setTipo(e.target.value as RecordTypeIO)} className="rounded-md border px-3 py-1.5 text-sm">
          <option value="INVOICE">Facturas (FAC)</option>
          <option value="SALES_ORDER">Órdenes de Venta (OV)</option>
        </select>
        <select value={yearA} onChange={(e) => setYearA(Number(e.target.value))} className="rounded-md border px-3 py-1.5 text-sm">
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      {/* Grid de tarjetas comerciales */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <BucketMixCard tipo={tipo} />
        <ClientParetoCard tipo={tipo} year={yearA} />
        <TopItemsCard tipo={tipo} year={yearA} />
        <SkuParetoCard tipo={tipo} year={yearA} />
        {/* tarjetas 5–9 en Task 4 */}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: `Nav.tsx` + `App.tsx`**
  - Nav: `<NavLink to={`${APP_BASE}/analisis`} className={link}>Análisis</NavLink>`.
  - App: `import Analisis from './pages/Analisis';` + `<Route path="analisis" element={<Analisis />} />` dentro del Layout.

- [ ] **Step 8: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run && cd ../.. && npm run build --workspace=apps/portal`.
- [ ] **Step 9: Commit** `feat(salestracker): página Análisis (shell + pestaña Comercial, tarjetas 1-4)`.

---

## Task 4: Tarjetas comerciales 5–9

**Files:** Create `pages/comercial/{BucketByClientCard,BrandMixCard,NewVsRecurringCard,MonthHeatmapCard,SeasonByBucketCard}.tsx`; Modify `Analisis.tsx` (importarlas + añadir al grid).

- [ ] **Step 1: `BucketByClientCard`** (barra horizontal apilada, top 15)
- Fetch: `useQuery({ queryKey: ['customer-item-sales', tipo, year], queryFn: () => fetchCustomerItemSales({ tipo, anio: year }) })`. Datos: `buildBucketByClient(data ?? []).slice(0, 15)`.
- Chart: `BarChart layout="vertical"` (height 440). Y `dataKey="customer"` width 160; X `formatCompactUSD`; 4 `<Bar stackId="1">` (`mano_obra`/`cr`/`equipos`/`operacion`) con `SERIES`. Props `{ tipo, year }`.

- [ ] **Step 2: `BrandMixCard`** (dona, top 8 + "Otros") — comparte la query de BucketByClient (mismo queryKey).
- Datos: `const all = buildBrandMix(data ?? []); const top = all.slice(0, 8); const restSum = all.slice(8).reduce((s, b) => s + b.importe, 0); const slices = restSum > 0 ? [...top, { marca: 'Otros', importe: restSum }] : top;`
- Chart: `PieChart` (height 440), `<Pie data={slices} dataKey="importe" nameKey="marca" innerRadius={70} outerRadius={120} label>` con `<Cell fill={s.marca==='Otros' ? OTROS_COLOR : PALETTE[i % PALETTE.length]}>`; `<Tooltip formatter={(v)=>formatUSD(Number(v))}/>`.

- [ ] **Step 3: `NewVsRecurringCard`** (barras apiladas + línea de conteo)
- Fetch: `useQuery({ queryKey: ['customer-sales', tipo, 2021, anioActual], queryFn: () => fetchCustomerSales({ tipo, desdeAnio: 2021, hastaAnio: anioActual }) })` (usa el año actual, NO yearA). Datos: `buildNewVsRecurring(data ?? [])`.
- Chart: `ComposedChart` (height 380). X `year`; `<Bar stackId="1" dataKey="nuevos" fill="#10b981">` + `<Bar stackId="1" dataKey="recurrentes" fill="#6366f1">` en Y izq; `<Line yAxisId="r" dataKey="countNuevos" stroke="#f59e0b">` en Y der (`allowDecimals={false}`). Props `{ tipo }`.

- [ ] **Step 4: `MonthHeatmapCard`** (tabla HTML heatmap, top 15) — ejemplo completo:
```tsx
import { useQuery } from '@tanstack/react-query';
import { fetchCustomerMonthSales, type RecordTypeIO } from '../../api';
import { buildMonthHeatmap } from '../../lib/analytics-comercial';
import { formatCompactUSD, MONTHS } from '../../lib/format';
import ChartCard from './ChartCard';

export default function MonthHeatmapCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['customer-month-sales', tipo, year], queryFn: () => fetchCustomerMonthSales({ tipo, anio: year }) });
  const rows = buildMonthHeatmap(q.data ?? []).slice(0, 15);
  const max = Math.max(1, ...rows.flatMap((r) => r.months));
  return (
    <ChartCard title="Estacionalidad por cliente (heatmap)" subtitle="Top 15 clientes · intensidad = importe del mes.">
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : rows.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead><tr><th className="sticky left-0 bg-white px-2 py-1 text-left">Cliente</th>{MONTHS.map((m) => <th key={m} className="px-2 py-1 text-center">{m}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.customer}>
                  <td className="sticky left-0 bg-white px-2 py-1 whitespace-nowrap max-w-[180px] truncate">{r.customer}</td>
                  {r.months.map((v, i) => (
                    <td key={i} className="px-2 py-1 text-right tabular-nums" style={{ backgroundColor: `rgba(16,185,129,${v > 0 ? 0.08 + 0.92 * (v / max) : 0})` }}>
                      {v > 0 ? formatCompactUSD(v) : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}
```

- [ ] **Step 5: `SeasonByBucketCard`** (barras apiladas, 12 meses)
- Fetch: `useQuery({ queryKey: ['category-month-sales', tipo, year], queryFn: () => fetchCategoryMonthSales({ tipo, anio: year }) })`. Datos: `const data = buildBucketSeason(q.data ?? []).map((r) => ({ ...r, mesLabel: MONTHS[r.mes - 1] }))`. `hasData = data.some((r) => r.mano_obra || r.cr || r.equipos || r.operacion)`.
- Chart: `BarChart` (height 380). X `dataKey="mesLabel"`; 4 `<Bar stackId="1">` (`SERIES`). Empty si `!hasData`.

- [ ] **Step 6: `Analisis.tsx`** — importar las 5 y añadirlas al grid tras las primeras 4:
```tsx
        <BucketByClientCard tipo={tipo} year={yearA} />
        <BrandMixCard tipo={tipo} year={yearA} />
        <NewVsRecurringCard tipo={tipo} />
        <MonthHeatmapCard tipo={tipo} year={yearA} />
        <SeasonByBucketCard tipo={tipo} year={yearA} />
```

- [ ] **Step 7: Verificar**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
- [ ] **Step 8: Commit** `feat(salestracker): tarjetas comerciales 5-9 (bucket-por-cliente, marcas, nuevos/recurrentes, heatmap, estacionalidad)`.

---

## Task 5: Verificación end-to-end + handoff

- [ ] **Step 1: Verificación completa** (hub-api tsc+tests, salestracker tsc+tests, portal build). Reportar salida real.
- [ ] **Step 2: Prueba local del endpoint** (si hay BD): `curl.exe -s -H "Authorization: Bearer <TOKEN>" "http://localhost:3001/api/salestracker/category-month-sales?tipo=INVOICE&anio=2026" | head -c 300`.
- [ ] **Step 3: Handoff:** merge/push + redeploy hub-api (endpoint nuevo) + portal. Verificar `/salestracker/analisis` → pestaña Comercial con las 9 tarjetas y datos reales; el selector tipo/año actualiza todas.

---

## Self-Review (cobertura)
- Endpoint category-month-sales (SQL portado, validado, cached): T1. ✅
- Lib analytics-comercial portada (con adaptación de buildBucketMixByYear a SalesRow) + test + formato: T2. ✅
- Página Análisis (shell + pestaña Comercial, 9 tarjetas) recharts + Tailwind plano: T3–T4. ✅
- Nav absoluta (APP_BASE). ✅
- Diferido: pestañas Margen (3B) y Forecast (3C); grouping (3D, tras Plan 4). Anotado.

Sin placeholders. Tipos consistentes (`CategoryMonthRow` backend→api→lib). Adaptación de `buildBucketMixByYear` documentada. Sin `item_id`.

## Próximos: 3B (Margen) · 3C (Forecast) · Plan 4 (config/escritura) · 3D (grouping) · Plan 5 (cutover).
