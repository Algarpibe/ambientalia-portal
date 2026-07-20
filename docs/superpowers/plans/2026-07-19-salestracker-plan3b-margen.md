# salestracker → Portal — Plan 3B: Análisis → pestaña "Margen"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Añadir la pestaña **Margen** a la página Análisis: 4 tarjetas — KPI de margen por año (tiles + línea), Margen por artículo (barra horizontal top 15), Importe vs margen (scatter), Margen por cliente (barra horizontal top 15, clic → ficha). Cada tarjeta con toggle **$ / %**. Comparten los controles tipo/año de la página.

**Architecture:** 2 endpoints nuevos en hub-api (`/margin-by-year` [solo tipo], `/margin-by-item` [tipo+año]); `margin-by-customer` ya existe (2C). Se extiende la lib `analytics-margin.ts` (ya tiene `deriveMargin`) con `buildMarginByYear`/`buildMarginItems`/`buildMarginCustomers`. Tarjetas en **Tailwind plano + recharts** (sin shadcn). Se activa el sistema de pestañas de `Analisis.tsx` (Comercial | Margen).

**Tech Stack:** hub-api (Express TS, Vitest); sub-app Vite (React 19, react-router 7, @tanstack/react-query v5, recharts). Nav ABSOLUTA (`APP_BASE`).

**Nota costo/margen:** el costo es el **estándar del maestro** (`items.raw->>'purchase_rate'`), solo bienes con `purchase_rate>0` (excluye servicios). Aclararlo en subtítulos, como en la ficha de cliente.

---

## File Structure
**Backend (`apps/hub-api/src/salestracker/`):**
- `margin-by-year.ts` + `.test.ts` (nuevo) — `mapMarginYearRow` + `getMarginByYearRows(db,{tipo})`.
- `margin-by-item.ts` + `.test.ts` (nuevo) — `mapMarginItemRow` + `getMarginByItemRows(db,{tipo,anio})`.
- `types.ts` (modificar) — `MarginYearRow`, `MarginItemRow`.
- `router.ts` (modificar) — 2 rutas.

**Frontend (`apps/salestracker/src/`):**
- `lib/analytics-margin.ts` + `.test.ts` (extender: 3 build fns + tests).
- `api.ts` (modificar) — `MarginYearRow`, `MarginItemRow` + `fetchMarginByYear`, `fetchMarginByItem`.
- `pages/margen/` (nuevo) — `AmountToggle.tsx` + 4 tarjetas.
- `pages/Analisis.tsx` (modificar) — activar pestañas (Comercial | Margen) + grid de margen.

---

## Task 1: Backend — 2 endpoints (TDD)

- [ ] **Step 1: Tipos en `types.ts`**
```typescript
export interface MarginYearRow { year: number; ventas: number; costo: number; }
export interface MarginItemRow { itemId: string; sku: string | null; nombre: string; ventas: number; costo: number; }
```

- [ ] **Step 2: `margin-by-year.ts` (TDD)** — test primero:
```typescript
import { describe, it, expect } from 'vitest';
import { mapMarginYearRow } from './margin-by-year.js';
describe('mapMarginYearRow', () => {
  it('coacciona', () => { expect(mapMarginYearRow({ year: '2026', ventas: '1000', costo: '600' })).toEqual({ year: 2026, ventas: 1000, costo: 600 }); });
  it('no numéricos → 0', () => { expect(mapMarginYearRow({ year: 2025, ventas: null, costo: 'x' })).toEqual({ year: 2025, ventas: 0, costo: 0 }); });
});
```
Implementar (SQL verbatim de `getHubMarginByYear` en `reference/.../src/db/hub-margin.ts` — incluye `VENTAS`/`COSTO`/`COMMON_WHERE`; **sin parámetro** — agrupa por año en toda la historia):
```typescript
import type { Pool } from '@algarpibe/zoho-sync';
import type { MarginYearRow, RecordTypeIO } from './types.js';

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

export function mapMarginYearRow(r: Record<string, unknown>): MarginYearRow {
  const ventas = Number(r.ventas); const costo = Number(r.costo);
  return { year: Number(r.year), ventas: Number.isFinite(ventas) ? ventas : 0, costo: Number.isFinite(costo) ? costo : 0 };
}

export async function getMarginByYearRows(db: Pool, f: { tipo: RecordTypeIO }): Promise<MarginYearRow[]> {
  const s = f.tipo === 'SALES_ORDER' ? SOURCES.SALES_ORDER : SOURCES.INVOICE;
  const sql = `
    SELECT extract(year from h.date)::int AS year, ${VENTAS} AS ventas, ${COSTO} AS costo
    FROM ${s.lines} l
    JOIN ${s.header} h ON h.${s.fk} = l.${s.fk}
    JOIN books.items it ON it.item_id = l.item_id
    WHERE ${COMMON_WHERE}
    GROUP BY 1
    ORDER BY 1`;
  const { rows } = await db.query(sql);
  return (rows as Record<string, unknown>[]).map(mapMarginYearRow);
}
```

- [ ] **Step 3: `margin-by-item.ts` (TDD)** — test primero (`mapMarginItemRow`: item_id→itemId, sku null-safe, nombre→'', ventas/costo→Number/0). Implementar (SQL verbatim de `getHubMarginByItem`; año bound `$1`):
```typescript
import type { Pool } from '@algarpibe/zoho-sync';
import type { MarginItemRow, RecordTypeIO } from './types.js';
// (mismos SOURCES/VENTAS/COSTO/COMMON_WHERE que margin-by-year.ts)

export function mapMarginItemRow(r: Record<string, unknown>): MarginItemRow {
  const ventas = Number(r.ventas); const costo = Number(r.costo);
  return {
    itemId: String(r.item_id),
    sku: (r.sku as string | null) ?? null,
    nombre: String(r.nombre ?? ''),
    ventas: Number.isFinite(ventas) ? ventas : 0,
    costo: Number.isFinite(costo) ? costo : 0,
  };
}

export async function getMarginByItemRows(db: Pool, f: { tipo: RecordTypeIO; anio: number }): Promise<MarginItemRow[]> {
  const s = f.tipo === 'SALES_ORDER' ? SOURCES.SALES_ORDER : SOURCES.INVOICE;
  const sql = `
    SELECT it.item_id, it.sku, it.name AS nombre, ${VENTAS} AS ventas, ${COSTO} AS costo
    FROM ${s.lines} l
    JOIN ${s.header} h ON h.${s.fk} = l.${s.fk}
    JOIN books.items it ON it.item_id = l.item_id
    WHERE extract(year from h.date) = $1
      AND ${COMMON_WHERE}
    GROUP BY it.item_id, it.sku, it.name`;
  const { rows } = await db.query(sql, [f.anio]);
  return (rows as Record<string, unknown>[]).map(mapMarginItemRow);
}
```
> Duplicar los fragmentos `VENTAS`/`COSTO`/`COMMON_WHERE`/`SOURCES` en cada módulo (como ya hace `margin-by-customer.ts`). No extraer a compartido en este plan.

- [ ] **Step 4: Rutas en `router.ts`** (reusa `parseAnio`)
```typescript
import { getMarginByYearRows } from './margin-by-year.js';
import { getMarginByItemRows } from './margin-by-item.js';
// ...
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
```

- [ ] **Step 5: Verificar** `cd apps/hub-api && npx tsc --noEmit && npx vitest run src/salestracker/`. Confirmar SQL verbatim.
- [ ] **Step 6: Commit** `feat(hub-api): endpoints margin-by-year/margin-by-item (SQL portado)`.

---

## Task 2: Frontend — extender lib analytics-margin + fetchers

- [ ] **Step 1: `api.ts` — tipos + fetchers**
```typescript
export interface MarginYearRow { year: number; ventas: number; costo: number; }
export interface MarginItemRow { itemId: string; sku: string | null; nombre: string; ventas: number; costo: number; }
export const fetchMarginByYear = (p: { tipo: RecordTypeIO }) =>
  fetchRows<MarginYearRow>('/api/salestracker/margin-by-year', { tipo: p.tipo }, 'margen por año');
export const fetchMarginByItem = (p: { tipo: RecordTypeIO; anio: number }) =>
  fetchRows<MarginItemRow>('/api/salestracker/margin-by-item', { tipo: p.tipo, anio: String(p.anio) }, 'margen por artículo');
```

- [ ] **Step 2: Extender `lib/analytics-margin.ts`** — añadir (verbatim de `reference/.../src/lib/analytics-margin.ts`, cambiando imports a `../api`):
```typescript
import type { MarginYearRow, MarginItemRow, MarginCustomerRow } from '../api';
// (deriveMargin ya existe arriba)

export interface MarginYearPoint { year: number; ventas: number; costo: number; margen: number; margenPct: number }
export interface MarginTotals { ventas: number; costo: number; margen: number; margenPct: number }
export function buildMarginByYear(rows: MarginYearRow[]): { series: MarginYearPoint[]; totals: MarginTotals } {
  const series = [...rows].sort((a, b) => a.year - b.year).map((r) => ({ year: r.year, ventas: r.ventas, costo: r.costo, ...deriveMargin(r.ventas, r.costo) }));
  const ventas = rows.reduce((s, r) => s + r.ventas, 0);
  const costo = rows.reduce((s, r) => s + r.costo, 0);
  return { series, totals: { ventas, costo, ...deriveMargin(ventas, costo) } };
}
export interface MarginItemPoint { label: string; sku: string | null; ventas: number; costo: number; margen: number; margenPct: number }
export function buildMarginItems(rows: MarginItemRow[]): MarginItemPoint[] {
  return rows.map((r) => ({ label: r.nombre, sku: r.sku, ventas: r.ventas, costo: r.costo, ...deriveMargin(r.ventas, r.costo) }))
    .sort((a, b) => b.margen - a.margen || a.label.localeCompare(b.label));
}
export interface MarginCustomerPoint { customer: string; ventas: number; costo: number; margen: number; margenPct: number }
export function buildMarginCustomers(rows: MarginCustomerRow[]): MarginCustomerPoint[] {
  return rows.map((r) => ({ customer: r.customer, ventas: r.ventas, costo: r.costo, ...deriveMargin(r.ventas, r.costo) }))
    .sort((a, b) => b.margen - a.margen || a.customer.localeCompare(b.customer));
}
```
Añadir tests (del reference `analytics-margin.test.ts`, las secciones de estas 3 fns, ajustando imports/fixtures a nuestros tipos).

- [ ] **Step 3: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run src/lib/`.
- [ ] **Step 4: Commit** `feat(salestracker): margin-by-year/item fetchers + extender lib analytics-margin (+ tests)`.

---

## Task 3: Pestaña Margen (4 tarjetas) + activar pestañas

**Files:** Create `pages/margen/{AmountToggle,MarginKpiCard,MarginByItemCard,MarginScatterCard,MarginByCustomerCard}.tsx`; Modify `pages/Analisis.tsx`.

Todas las tarjetas: `useQuery` propio, estados carga/"Sin datos."/error dentro de `ChartCard` (de `../comercial/ChartCard`), `ResponsiveContainer`, toggle `$`/`%` con `AmountToggle`. Costo = estándar del maestro (subtítulo).

- [ ] **Step 1: `AmountToggle.tsx`** (toggle plano)
```tsx
export type AmountMode = 'money' | 'pct';
export default function AmountToggle({ value, onChange }: { value: AmountMode; onChange: (m: AmountMode) => void }) {
  const btn = (m: AmountMode, label: string) =>
    `px-2.5 py-1 text-xs font-medium rounded-md ${value === m ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`;
  return (
    <div className="inline-flex rounded-lg border p-0.5">
      <button className={btn('money', '$')} onClick={() => onChange('money')}>$</button>
      <button className={btn('pct', '%')} onClick={() => onChange('pct')}>%</button>
    </div>
  );
}
```

- [ ] **Step 2: `MarginKpiCard`** (tiles + línea; props `{tipo}`)
- Fetch: `useQuery({ queryKey: ['margin-year', tipo], queryFn: () => fetchMarginByYear({ tipo }) })`. `const { series, totals } = buildMarginByYear(data ?? []);` Estado `mode` (default 'pct').
- Render: 4 tiles (Ventas bienes, Costo, Margen, Margen %) con `formatUSD`/`toFixed(1)%`, + `LineChart` (height 240) de `series`, `<Line dataKey={mode==='pct'?'margenPct':'margen'} stroke="#10b981">`, Y domain `[0,100]` si pct (ticks 0/25/50/75/100) o auto si money (`tickFormatter` `formatCompactUSD`). Tooltip muestra ventas/costo/margen/margen%. Título "Margen bruto estimado (solo bienes)".

- [ ] **Step 3: `MarginByItemCard`** (barra horizontal top 15; props `{tipo, year}`)
- Fetch: `useQuery({ queryKey: ['margin-item', tipo, year], queryFn: () => fetchMarginByItem({ tipo, anio: year }) })`. Estado `mode` (default 'money'). `const items = buildMarginItems(data ?? []); const top = (mode==='pct' ? [...items].sort((a,b)=>b.margenPct-a.margenPct||a.label.localeCompare(b.label)) : items).slice(0,15);`
- Chart: `BarChart layout="vertical"` (height 440). X numérico `tickFormatter` (`${Math.round(v)}%` si pct, `formatCompactUSD` si money); Y `dataKey="label"` width 160; `<Bar dataKey={mode==='pct'?'margenPct':'margen'} fill="#10b981" radius={[0,4,4,0]}>`. Título "Margen por artículo {year} (top 15)".

- [ ] **Step 4: `MarginScatterCard`** (scatter; props `{tipo, year}`) — comparte la query de MarginByItem (mismo queryKey `['margin-item', tipo, year]`).
```tsx
import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { fetchMarginByItem, type RecordTypeIO } from '../../api';
import { buildMarginItems, deriveMargin } from '../../lib/analytics-margin';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import ChartCard from '../comercial/ChartCard';
import AmountToggle, { type AmountMode } from './AmountToggle';

const FLOOR_PCT = -50;
export default function MarginScatterCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['margin-item', tipo, year], queryFn: () => fetchMarginByItem({ tipo, anio: year }) });
  const [mode, setMode] = useState<AmountMode>('pct');
  const { points, overallPct } = useMemo(() => {
    const pts = buildMarginItems(q.data ?? []).map((p) => ({ ...p, yPlot: mode === 'pct' ? Math.max(p.margenPct, FLOOR_PCT) : p.margen }));
    const totV = pts.reduce((s, p) => s + p.ventas, 0);
    const totC = pts.reduce((s, p) => s + p.costo, 0);
    return { points: pts, overallPct: deriveMargin(totV, totC).margenPct };
  }, [q.data, mode]);
  return (
    <ChartCard title={`Importe vs margen ${mode === 'pct' ? '%' : '$'} · ${year}`} subtitle="Cada punto es un artículo (bienes con costo). Gris = equilibrio; ámbar = margen % global. Bajo −50% se recorta.">
      <div className="flex justify-end mb-2"><AmountToggle value={mode} onChange={setMode} /></div>
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : points.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={440}>
          <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey="ventas" name="Ventas" tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <YAxis type="number" dataKey="yPlot" name={mode === 'pct' ? 'Margen %' : 'Margen $'} domain={mode === 'pct' ? [FLOOR_PCT, 100] : ['auto', 'auto']} ticks={mode === 'pct' ? [-50, -25, 0, 25, 50, 75, 100] : undefined} allowDataOverflow={mode === 'pct'} tickFormatter={mode === 'pct' ? (v) => `${Math.round(Number(v))}%` : (v) => formatCompactUSD(Number(v))} />
            <ZAxis range={[30, 30]} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v, n) => (n === 'Ventas' ? formatUSD(Number(v)) : n === 'Margen %' ? `${Number(v).toFixed(1)}%` : formatUSD(Number(v)))} />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" />
            {mode === 'pct' && <ReferenceLine y={overallPct} stroke="#f59e0b" strokeDasharray="4 4" />}
            <Scatter data={points} fill="#6366f1" fillOpacity={0.6} />
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
```

- [ ] **Step 5: `MarginByCustomerCard`** (barra horizontal top 15, clic → ficha; props `{tipo, year}`)
- Fetch: `useQuery({ queryKey: ['margin-customer', tipo, year], queryFn: () => fetchMarginByCustomer({ tipo, anio: year }) })` (fetcher ya existe). `const items = buildMarginCustomers(data ?? []); const top = (mode==='pct' ? [...items].sort(...) : items).slice(0,15);`
- Chart: `BarChart layout="vertical"` (height 440). Y `dataKey="customer"` width 160; X `tickFormatter` según mode; `<Bar dataKey={mode==='pct'?'margenPct':'margen'} fill="#10b981">`. `onClick` de barra → `useNavigate()` a `${APP_BASE}/clientes/${encodeURIComponent(customer)}` (NO customerHref). Subtítulo "…Clic en un cliente para ver su detalle.".

- [ ] **Step 6: `Analisis.tsx` — activar pestañas**

Cambiar el estado `tab` a `'comercial' | 'margen'` con dos botones interactivos; conservar los controles compartidos (tipo, yearA). Renderizar condicional:
```tsx
const [tab, setTab] = useState<'comercial' | 'margen'>('comercial');
// barra de pestañas: dos <button> que set-ean tab; el activo con border-b-2 border-blue-600 text-blue-600
// ...
{tab === 'comercial' ? (
  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">{/* 9 tarjetas comerciales existentes */}</div>
) : (
  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
    <MarginKpiCard tipo={tipo} />
    <MarginByItemCard tipo={tipo} year={yearA} />
    <MarginScatterCard tipo={tipo} year={yearA} />
    <MarginByCustomerCard tipo={tipo} year={yearA} />
  </div>
)}
```
Quitar el `void tab;` (ya se usa).

- [ ] **Step 7: Verificar**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
- [ ] **Step 8: Commit** `feat(salestracker): pestaña Margen (KPI, por artículo, scatter, por cliente)`.

---

## Task 4: Verificación end-to-end + handoff

- [ ] **Step 1: Verificación completa** (hub-api tsc+tests, salestracker tsc+tests, portal build). Reportar salida real.
- [ ] **Step 2: Prueba local** (si hay BD): `curl.exe -s -H "Authorization: Bearer <TOKEN>" "http://localhost:3001/api/salestracker/margin-by-year?tipo=INVOICE" | head -c 200`.
- [ ] **Step 3: Handoff:** merge/push + redeploy hub-api (2 endpoints) + portal. Verificar `/salestracker/analisis` → pestaña Margen con las 4 tarjetas + toggle $/%.

---

## Self-Review (cobertura)
- 2 endpoints (SQL portado, validado, cached): T1. ✅
- Lib analytics-margin extendida (buildMarginByYear/Items/Customers) + tests: T2. ✅
- Pestaña Margen (4 tarjetas + toggle) + activación de tabs: T3. ✅
- Nav absoluta (clic cliente → `${APP_BASE}/clientes/...`, no customerHref). ✅
- Diferido: Forecast (3C), grouping (3D). Anotado.

Sin placeholders. Tipos consistentes (MarginYearRow/MarginItemRow). MarginItemRow.item_id→itemId reconciliado (la lib no lo usa).

## Próximos: 3C (Forecast) · Plan 4 (config/escritura) · 3D (grouping) · Plan 5 (cutover).
