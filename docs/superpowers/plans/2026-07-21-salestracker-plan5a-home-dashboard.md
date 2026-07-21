# salestracker → Portal — Plan 5a: Home dashboard rico (paridad para cutover)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Reemplazar el `Home` mínimo (KPI + top categorías) por un **dashboard consolidado** a la par del `/home` de la app Next, para dejar la sub-app con paridad total antes de retirar la app antigua. Todo **frontend**, sin backend nuevo (reusa `/sales` y `/customer-sales`).

**Contenido del nuevo Home:** selector de año + fila de **4 KPIs con Δ YoY** (Facturado, Órdenes OV, Backlog, % Ejecución) + 4 gráficos desde `/sales` (barras OV/FAC mensual, acumulado interanual, ejecución mensual, dona mix de categorías) + top clientes desde `/customer-sales`.

**Architecture:** SIN backend. Cálculos en una lib pura testeada (`home-metrics.ts`). Tailwind plano + recharts. Deploy = **solo PORTAL**.

**Tech Stack:** sub-app Vite (React 19, react-query v5, recharts). Nav ABSOLUTA.

---

## File Structure
**Frontend (`apps/salestracker/src/`):**
- `lib/home-metrics.ts` (nuevo) — cálculos puros desde `SalesRow[]`.
- `lib/home-metrics.test.ts` (nuevo) — tests.
- `pages/home/KpiTile.tsx` (nuevo) — tile KPI (valor + Δ%).
- `pages/home/MonthlyOvFacCard.tsx`, `CumulativeYoYCard.tsx`, `ExecutionMonthlyCard.tsx`, `CategoryMixCard.tsx` (nuevos) — 4 tarjetas desde `/sales`.
- `pages/home/TopClientesCard.tsx` (nuevo) — top 10 clientes desde `/customer-sales`.
- `pages/Home.tsx` (reescribir) — selector de año + fila de KPIs + grid de tarjetas.

Reusa `formatUSD`/`formatCompactUSD`/`MONTHS`/`PALETTE`/`OTROS_COLOR` de `format.ts`, `computeDelta`/`formatDeltaPct` de `compare.ts`, `availableYears` de `category-month-pivot.ts`, `ChartCard` (`pages/comercial/ChartCard`), y de `api.ts`: `fetchSales`, `fetchCustomerSales`, `type SalesRow`, `type RecordTypeIO`.

---

## Task 1: lib pura `home-metrics.ts` + tests

- [ ] **Step 1: `lib/home-metrics.ts`** — tipos + funciones puras (todas filtran `rows` por año/tipo internamente; `amountUsd` de `SalesRow`):
```typescript
import type { SalesRow } from '../api';
import { MONTHS } from './format';

export interface HomeKpis {
  facturado: number; facturadoPrev: number;   // INVOICE año / año-1
  ordenes: number; ordenesPrev: number;        // SALES_ORDER año / año-1
  backlog: number;                             // BACKLOG año
  ejecucion: number; ejecucionPrev: number;    // 0..100 = facturado/ordenes*100 (0 si ordenes 0)
}
export interface MonthPoint { mes: string; ov: number; fac: number }         // 12
export interface CumPoint { mes: string; actual: number; previo: number }    // 12 (INVOICE acumulado)
export interface ExecPoint { mes: string; pct: number }                      // 12 (fac/ov*100, 0 si ov 0)
export interface CatSlice { categoria: string; importe: number }             // topN + 'Otros'

const sumBy = (rows: SalesRow[], year: number, type: SalesRow['recordType']) =>
  rows.reduce((s, r) => (r.year === year && r.recordType === type ? s + r.amountUsd : s), 0);

export function buildHomeKpis(rows: SalesRow[], year: number): HomeKpis { /* usa sumBy; ejecucion = ordenes>0 ? facturado/ordenes*100 : 0 */ }
export function buildMonthlyOvFac(rows: SalesRow[], year: number): MonthPoint[] { /* 12 meses; ov=SALES_ORDER, fac=INVOICE por mes */ }
export function buildCumulativeYoY(rows: SalesRow[], year: number): CumPoint[] { /* INVOICE acumulado mes a mes, year vs year-1 */ }
export function buildExecutionMonthly(rows: SalesRow[], year: number): ExecPoint[] { /* por mes: facMonth/ovMonth*100, 0 si ov 0 */ }
export function buildCategoryMix(rows: SalesRow[], year: number, topN = 8): CatSlice[] { /* INVOICE por categoryName, desc, top N + 'Otros' si sobra */ }
```
Detalles: los meses se etiquetan con `MONTHS[i]`; `buildCategoryMix` agrega por `categoryName` (INVOICE del año), ordena desc, toma `topN` y agrupa el resto en `{ categoria: 'Otros', importe }` solo si `> 0`.

- [ ] **Step 2: `lib/home-metrics.test.ts`** — con fixtures mínimos de `SalesRow[]`, testear: KPIs (facturado/ordenes/backlog correctos + ejecución con guard ordenes=0 → 0); `buildMonthlyOvFac` coloca el importe en el mes correcto por tipo; `buildCumulativeYoY` acumula y separa year/year-1; `buildExecutionMonthly` guard division-by-zero; `buildCategoryMix` ordena desc y agrupa 'Otros' cuando hay más de `topN`.

- [ ] **Step 3: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run`.
- [ ] **Step 4: Commit** `feat(salestracker): lib home-metrics (KPIs + series del dashboard)`.

---

## Task 2: KpiTile + 4 tarjetas `/sales` + reescritura de Home

- [ ] **Step 1: `pages/home/KpiTile.tsx`** — props `{ label: string; value: string; deltaPct?: number | null; hint?: string }`. Render: tarjeta `rounded-xl border bg-white p-5`; `label` gris pequeño; `value` grande `text-2xl font-bold`; si `deltaPct != null`, badge Δ con color (`>=0` verde, `<0` rojo) usando `formatDeltaPct` (import de `compare.ts`); `hint` opcional gris.

- [ ] **Step 2: 4 tarjetas** (cada una recibe `{ rows: SalesRow[]; year: number }` — Home hace UN solo `fetchSales` y se lo pasa a todas; NO cada tarjeta su fetch):
  - `MonthlyOvFacCard` — `ChartCard title="Ventas mensuales OV vs FAC"`: `BarChart` de `buildMonthlyOvFac(rows,year)`, dos `<Bar>` (`ov` y `fac`), XAxis `mes`, YAxis `formatCompactUSD`, Tooltip `formatUSD`, Legend.
  - `CumulativeYoYCard` — `ChartCard title="Facturación acumulada (interanual)"`: `LineChart` de `buildCumulativeYoY(rows,year)`, dos `<Line>` (`actual`=year, `previo`=year-1), etiquetas con los años reales en `name`.
  - `ExecutionMonthlyCard` — `ChartCard title="Ejecución mensual (FAC/OV)"`: `LineChart`/`BarChart` de `buildExecutionMonthly(rows,year)`, `pct` con YAxis en % (`tickFormatter={(v)=>`${v.toFixed(0)}%`}`) y Tooltip `%`.
  - `CategoryMixCard` — `ChartCard title="Mix de categorías (FAC)"`: `PieChart` dona de `buildCategoryMix(rows,year,8)`, `<Cell>` con `PALETTE`/`OTROS_COLOR` (como `BrandMixCard`), Tooltip `formatUSD`, Legend.

- [ ] **Step 3: `pages/Home.tsx` (reescritura)**:
  - `const q = useQuery({ queryKey: ['sales'], queryFn: fetchSales });` (misma queryKey que el resto → dedupe). `const rows = q.data ?? [];`
  - Selector de año: `const years = availableYears(rows);` (de `category-month-pivot`), `const [year, setYear] = useState<number>(anioActual)`, `const yearSel = years.includes(year) ? year : (years[0] ?? anioActual)`.
  - Estados `q.isLoading`/`q.error` como el resto.
  - Header + `<select>` de año.
  - **Fila de KPIs** (grid `grid-cols-2 md:grid-cols-4 gap-4`) con `buildHomeKpis(rows, yearSel)`: `Facturado` (value `formatUSD(k.facturado)`, deltaPct `computeDelta(k.facturado, k.facturadoPrev).pct`), `Órdenes (OV)` (idem con ordenes), `Backlog` (value `formatUSD(k.backlog)`, sin delta), `% Ejecución` (value `${k.ejecucion.toFixed(1)}%`, deltaPct = diferencia en puntos `k.ejecucion - k.ejecucionPrev` — pásalo como número; el badge lo pinta igual). Usa `KpiTile`.
  - **Grid de tarjetas** `grid grid-cols-1 xl:grid-cols-2 gap-6`: `MonthlyOvFacCard`, `CumulativeYoYCard`, `ExecutionMonthlyCard`, `CategoryMixCard`, y `TopClientesCard` (Task 3), todas con `year={yearSel}` (las 4 primeras además `rows={rows}`).
  - Conservar nav absoluta; NO romper la ruta index.

- [ ] **Step 4: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run && cd ../.. && npm run build --workspace=apps/portal`.
- [ ] **Step 5: Commit** `feat(salestracker): Home dashboard (KPIs + 4 gráficos desde /sales)`.

---

## Task 3: TopClientesCard (desde /customer-sales)

- [ ] **Step 1: `pages/home/TopClientesCard.tsx`** — props `{ tipo?: RecordTypeIO; year: number }` (default `tipo='INVOICE'`). Hace su propio `useQuery({ queryKey: ['customer-sales', tipo, year, year], queryFn: () => fetchCustomerSales({ tipo, desdeAnio: year, hastaAnio: year }) })`. Agrega por `customer` (suma `ventas` del año), ordena desc, toma top 10. Render `ChartCard title="Top clientes (FAC)"`: `BarChart` horizontal (layout="vertical") con `formatCompactUSD` en el eje y `formatUSD` en tooltip. Estados carga/error/vacío como el resto.
- [ ] **Step 2: Wire** en `Home.tsx` (añadir `<TopClientesCard year={yearSel} />` al grid — ya referenciado en Task 2 Step 3; asegurar el import).
- [ ] **Step 3: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run && cd ../.. && npm run build --workspace=apps/portal`.
- [ ] **Step 4: Commit** `feat(salestracker): Home top clientes (customer-sales)`.

---

## Task 4: Verificación e2e + handoff

- [ ] **Step 1: Verificación completa** salestracker (`tsc` + `vitest`) + portal build. Reportar salida real.
- [ ] **Step 2: Handoff:** merge/push + redeploy **solo del PORTAL**. Verificar `/salestracker` (Home): fila de 4 KPIs con Δ, 4 gráficos + top clientes, y el selector de año recalcula todo.

---

## Self-Review (cobertura)
- Fila de KPIs con Δ YoY (Facturado/Órdenes/Backlog/% Ejecución): T2. ✅
- Barras OV/FAC mensual, acumulado interanual, ejecución mensual, dona categorías: T2. ✅
- Top clientes: T3. ✅
- Lib pura testeada (KPIs + series), sin backend nuevo. ✅
- Un solo `fetchSales` compartido por las 4 tarjetas (rows como prop); TopClientes usa `/customer-sales`. ✅
- Nav absoluta, estados carga/error. ✅

Sin placeholders. Deja el Home a la par del de la app Next → habilita el cutover (Plan 5b: decomisión).

## Próximo: **Plan 5b (decomisión)** — checklist para retirar servicio/BD/better-auth de la app Next en EasyPanel (lo ejecuta el usuario).
