# salestracker → Portal — Plan 3D: analítica por Agrupaciones

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Añadir a la pestaña **Exploración** de Análisis 2 tarjetas que consumen `/grouping-analysis` (Plan 4C): (1) **Análisis por agrupaciones** — tabla grupos × años (monto + total + % participación) + dona de participación promedio; (2) **Evolución por grupo** — barras apiladas de los grupos por año (con toggle Anual/Trimestral/Mensual). Usa las agrupaciones que el admin configura en Categorías (4C).

**Architecture:** SIN backend nuevo — reusa `GET /api/salestracker/grouping-analysis?tipo=`. Fetcher + tipos en `api.ts`. 2 tarjetas en **Tailwind plano + recharts** (las de referencia usan shadcn/framer-motion; se reimplementan planas conservando la lógica de datos). Se añaden a la pestaña Exploración del `Analisis.tsx` existente (usan el control `tipo` compartido). Estado vacío si no hay grupos (enlaza a `${APP_BASE}/categorias`).

**Diferido (anotado):** `GroupForecastCard` (forecast por grupo, pestaña Forecast) → follow-up posterior.

**Tech Stack:** sub-app Vite (React 19, @tanstack/react-query v5, recharts). Nav ABSOLUTA.

---

## File Structure
**Frontend (`apps/salestracker/src/`):**
- `api.ts` (modificar) — tipos `GroupingAnalysis`/`GroupingRow` + `fetchGroupingAnalysis`.
- `pages/exploracion/GroupingAnalysisCard.tsx` (nuevo) — tabla + dona.
- `pages/exploracion/GroupEvolutionCard.tsx` (nuevo) — barras apiladas.
- `pages/Analisis.tsx` (modificar) — añadir las 2 tarjetas a la pestaña Exploración.

No cambia backend. Reusa `formatUSD`/`formatCompactUSD`/`MONTHS` de `format.ts`, `ChartCard`, `APP_BASE`.

---

## Task 1: Fetcher + tipos

- [ ] **Step 1: `api.ts` — tipos + fetcher** (espejo del backend `grouping-analysis.ts`)
```typescript
export interface GroupYear { amount: number; percentage: number }
export interface GroupingRow {
  groupId: string; groupName: string; color: string;
  years: Record<number, GroupYear>;
  months: Record<number, Record<number, number>>;
  average: { amount: number; percentage: number };
}
export interface GroupingAnalysis { rows: GroupingRow[]; years: number[]; yearTotals: Record<number, number>; }

export async function fetchGroupingAnalysis(tipo: RecordTypeIO): Promise<GroupingAnalysis> {
  const res = await fetch(`${API_BASE}/api/salestracker/grouping-analysis?tipo=${tipo}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as GroupingAnalysis;
}
```
- [ ] **Step 2: Verificar** `cd apps/salestracker && npx tsc --noEmit`.
- [ ] **Step 3: Commit** `feat(salestracker): fetcher + tipos de grouping-analysis`.

---

## Task 2: GroupingAnalysisCard (tabla + dona) + wire

- [ ] **Step 1: `pages/exploracion/GroupingAnalysisCard.tsx`** (props `{tipo}`)
- Fetch `useQuery({ queryKey: ['grouping-analysis', tipo], queryFn: () => fetchGroupingAnalysis(tipo) })`.
- Estados: carga "Cargando…"; error `(q.error as Error).message`; **vacío** (`data.rows.length === 0`) → mensaje "Sin agrupaciones definidas. Créalas en la sección Agrupaciones de Categorías." con `<Link to={`${APP_BASE}/categorias`}>Ir a Categorías</Link>`.
- Derivaciones:
  - `const { rows, years, yearTotals } = data;`
  - Por fila: `total = years.reduce((s,y)=> s + (row.years[y]?.amount ?? 0), 0)`.
  - Dona: `pie = rows.filter(r => r.average.percentage > 0).map(r => ({ name: r.groupName, value: r.average.percentage, color: r.color }))`.
  - Fila TOTAL: por año `sum(rows[*].years[y].amount)` (= `yearTotals[y]` incluye no agrupadas, pero mostrar la suma de las filas visibles); `grandTotal = sum(rows totals)`.
- Render en `ChartCard title="Análisis por agrupaciones"`:
  - **Tabla** (`overflow-x-auto`): columnas `Grupo | {cada año: monto} | Total | % part.`. Cada fila: swatch de color + `groupName`; por año `formatUSD(row.years[y]?.amount ?? 0)`; `Total` en negrita `formatUSD(total)`; `% part.` = `row.average.percentage.toFixed(1)%`. Fila **TOTAL** al pie (`border-t-2 font-bold`) con las sumas por año + gran total. Cabeceras clicables opcionales (ordenar por total/nombre) — opcional; si se omite, ordenar por `total` desc por defecto.
  - **Dona** (recharts `PieChart`, height 320): `<Pie data={pie} dataKey="value" nameKey="name" innerRadius={80} outerRadius={130}>` con `<Cell fill={p.color}>` por sector; `<Tooltip formatter={(v)=>`${Number(v).toFixed(1)}%`}/>`; `<Legend/>`. Subtítulo "Participación promedio por grupo (% del total anual).".

- [ ] **Step 2: `Analisis.tsx`** — importar y añadir `<GroupingAnalysisCard tipo={tipo} />` al bloque de la pestaña Exploración (tras las tarjetas existentes global-monthly/ST-C&R).

- [ ] **Step 3: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run && cd ../.. && npm run build --workspace=apps/portal`.
- [ ] **Step 4: Commit** `feat(salestracker): tarjeta Análisis por agrupaciones (tabla + dona)`.

---

## Task 3: GroupEvolutionCard (barras apiladas) + wire

- [ ] **Step 1: `pages/exploracion/GroupEvolutionCard.tsx`** (props `{tipo}`)
- Fetch `useQuery({ queryKey: ['grouping-analysis', tipo], queryFn: () => fetchGroupingAnalysis(tipo) })` (comparte queryKey con la otra tarjeta → dedupe).
- Estado local: `viewMode: 'ANNUAL'|'QUARTERLY'|'MONTHLY'` (default 'ANNUAL'), `selectedYear` (default el último de `years`).
- Estados carga/error/vacío como en la otra tarjeta.
- Derivar `chartData` (transpone a filas por eje, una **clave por grupo** = groupName → amount):
  - `ANNUAL`: `years.map(y => ({ eje: String(y), ...Object.fromEntries(rows.map(r => [r.groupName, r.years[y]?.amount ?? 0])) }))`.
  - `QUARTERLY`: para `selectedYear`, 4 trimestres (`Q1..Q4`, meses [1-3],[4-6],[7-9],[10-12]): por grupo, `sum(r.months[selectedYear]?.[m] ?? 0)` sobre los meses del trimestre.
  - `MONTHLY`: para `selectedYear`, 12 meses (`MONTHS[i]`): por grupo, `r.months[selectedYear]?.[i+1] ?? 0`.
- Render en `ChartCard title="Evolución por grupo"`:
  - Controles: toggle `viewMode` (3 botones Anual/Trimestral/Mensual); si `viewMode !== 'ANNUAL'`, selector de año (botones con `years`).
  - **Barras apiladas** (recharts `BarChart`, height 420): X `dataKey="eje"`; Y `formatCompactUSD`; una `<Bar>` por grupo con `dataKey={r.groupName}` `stackId="g"` `fill={r.color}`; `<Tooltip formatter={(v)=>formatUSD(Number(v))}/>`; `<Legend/>`. (Si hay muchos grupos, la leyenda se apila; aceptable.)
  - Subtítulo según viewMode.
- Nota: los `groupName` como dataKeys deben ser estables; recharts los acepta como strings. Si un nombre tuviera caracteres raros, sigue funcionando como key de objeto.

- [ ] **Step 2: `Analisis.tsx`** — añadir `<GroupEvolutionCard tipo={tipo} />` tras la tarjeta de análisis, en la pestaña Exploración.

- [ ] **Step 3: Verificar**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
- [ ] **Step 4: Commit** `feat(salestracker): tarjeta Evolución por grupo (barras apiladas, Anual/Trim/Mensual)`.

---

## Task 4: Verificación end-to-end + handoff

- [ ] **Step 1: Verificación completa** (salestracker tsc+tests, portal build; hub-api NO cambia). Reportar salida real.
- [ ] **Step 2: Handoff:** merge/push + redeploy **solo del portal** (sin cambios en hub-api). Verificar `/salestracker/analisis` → pestaña **Exploración** → las 2 tarjetas nuevas: **Análisis por agrupaciones** (tabla grupos×años + dona) y **Evolución por grupo** (barras apiladas, con toggle Anual/Trim/Mensual). Requiere tener agrupaciones creadas (Categorías → Agrupaciones, 4C). Sin grupos → estado vacío con enlace a Categorías.

---

## Self-Review (cobertura)
- Fetcher + tipos grouping-analysis: T1. ✅
- Tarjeta análisis (tabla grupos×años + total + %part + dona) Tailwind plano: T2. ✅
- Tarjeta evolución (barras apiladas por grupo, Anual/Trim/Mensual + selector de año): T3. ✅
- Estado vacío enlaza a Categorías (config 4C). Nav absoluta. ✅
- Sin backend nuevo (reusa `/grouping-analysis`). ✅
- Diferido: GroupForecast (follow-up). Anotado.

Sin placeholders. Ambas tarjetas comparten queryKey `['grouping-analysis', tipo]` (dedupe). Tipos consistentes con el backend.

## Próximos: GroupForecast (follow-up) · polish Tablas (remap st_categories) · Plan 5 (cutover). **Con 3D, la analítica y la config quedan completas salvo el cutover.**
