# salestracker → Portal — Plan 3F: Diferidos (GroupForecast + Polish Tablas)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Cerrar dos diferidos, ambos **solo frontend** (sin backend nuevo), en un único branch/deploy del portal:
1. **GroupForecastCard** — forecast estacional por grupo en la pestaña **Forecast** (reusa `fetchGroupingAnalysis` de 3D + la lib `math-utils` portada en 3C).
2. **Polish Tablas** — reordenar y colorear la tabla Categoría×mes usando las categorías de config (`st_categories`: `sort_order` + `color`), reusando `fetchCategories` (4A).

**Architecture:** SIN backend. Reusa endpoints existentes `/grouping-analysis`, `/sales`, `/categories`. Tailwind plano + recharts (sin shadcn/framer-motion). Deploy = **solo PORTAL**.

**Tech Stack:** sub-app Vite (React 19, @tanstack/react-query v5, recharts). Nav ABSOLUTA.

---

## File Structure
**Frontend (`apps/salestracker/src/`):**
- `pages/forecast/GroupForecastCard.tsx` (nuevo) — forecast por grupo (barras reales apiladas + línea forecast total).
- `pages/Analisis.tsx` (modificar) — envolver la pestaña Forecast para añadir la tarjeta.
- `lib/category-month-pivot.ts` (modificar) — helper puro `orderAndColorRows(rows, categories)`.
- `lib/category-month-pivot.test.ts` (modificar/crear) — test del helper.
- `pages/Tablas.tsx` (modificar) — fetch de categorías + filas ordenadas/coloreadas + swatch.

Reusa `formatUSD`/`formatCompactUSD`/`MONTHS` de `format.ts`, `ChartCard` (`pages/comercial/ChartCard`), `APP_BASE`, y de `api.ts`: `fetchGroupingAnalysis`, `type GroupingRow`, `fetchCategories`, `type Category`. De `lib/math-utils.ts`: `calculateSeasonalityFactors`, `getSeasonalForecast`, `calculateRunRate`.

---

## Task 1: GroupForecastCard (forecast por grupo) + wire

- [ ] **Step 1: `pages/forecast/GroupForecastCard.tsx`** (props `{ tipo: RecordTypeIO; year: number }`)
- `const q = useQuery({ queryKey: ['grouping-analysis', tipo], queryFn: () => fetchGroupingAnalysis(tipo) });` (comparte queryKey con las tarjetas de 3D → dedupe).
- Estados carga/error/vacío (vacío = `!q.data || q.data.rows.length === 0`) con `<Link to={`${APP_BASE}/categorias`}>` como en `GroupingAnalysisCard`.
- Constante local `MESES = MONTHS` (Ene..Dic). `baseYear = year`.
- Derivar `chartData` (12 filas, una por mes; claves: `eje` = etiqueta de mes, una clave por `groupName` con el **valor real** del mes, `total_forecast` = suma de proyecciones del mes). Lógica **espejo de `reference/.../group-forecast-card.tsx`** pero con años históricos **relativos** a `baseYear`:
  ```
  const now = new Date();
  const isCurrentYear = baseYear === now.getFullYear();
  const currentMonthIdx = now.getMonth();               // 0..11
  const lastElapsedMonth = isCurrentYear ? currentMonthIdx + 1 : 12;
  const histYears = [baseYear - 1, baseYear - 2, baseYear - 3];
  // por cada mes idx (0..11), monthNum = idx+1:
  //   por cada row (grupo):
  //     histMatrix = histYears.map(y => MONTHS.map((_,m)=> row.months[y]?.[m+1] ?? 0));   // number[][]
  //     factors = calculateSeasonalityFactors(histMatrix, [3,2,1]);
  //     rawCur = MONTHS.map((_,m)=> row.months[baseYear]?.[m+1] ?? 0);
  //     elapsed = rawCur.slice(0, lastElapsedMonth);
  //     if (isCurrentYear && elapsed.length > currentMonthIdx) {
  //        const totalDays = new Date(now.getFullYear(), currentMonthIdx+1, 0).getDate();
  //        elapsed[currentMonthIdx] = calculateRunRate(elapsed[currentMonthIdx] ?? 0, now.getDate(), totalDays);
  //     }
  //     const projected = getSeasonalForecast(elapsed, factors);
  //     const val = Math.round((projected[idx] || 0) * 100) / 100;
  //     entry[row.groupName] = (monthNum <= lastElapsedMonth) ? (row.months[baseYear]?.[monthNum] ?? 0) : 0;   // barra = real solo meses transcurridos
  //     totalForecast += val;
  //   entry.total_forecast = totalForecast;
  ```
  Nota: `calculateSeasonalityFactors` espera `number[][]` (una fila por año histórico, 12 columnas). `getSeasonalForecast(elapsed, factors)` devuelve `number[]` de 12.
- Render en `ChartCard title="Forecast estacional por grupo" subtitle="Barras = ventas reales del año; línea = proyección total (estacionalidad histórica + run-rate del mes en curso).">`:
  - `ResponsiveContainer height={440}` con `ComposedChart data={chartData}`: `<CartesianGrid strokeDasharray="3 3" />`, `<XAxis dataKey="eje" />`, `<YAxis tickFormatter={(v)=>formatCompactUSD(Number(v))} />`, `<Tooltip formatter={(v)=>formatUSD(Number(v))} />`, `<Legend />`, una `<Bar key={r.groupId} dataKey={r.groupName} stackId="g" fill={r.color} />` por grupo (de `q.data.rows`), y `<Line type="monotone" dataKey="total_forecast" name="Forecast total" stroke="#0ea5e9" strokeWidth={3} strokeDasharray="6 4" dot={false} />`.
- Sin multi-selector (pocos grupos → apilar todos). Sin toggle de tipo en la tarjeta (usa el `tipo` compartido).

- [ ] **Step 2: `Analisis.tsx`** — la pestaña Forecast hoy es `{tab === 'forecast' && <ForecastGrid tipo={tipo} year={yearA} />}`. Envolver:
  ```tsx
  {tab === 'forecast' && (
    <div className="space-y-6">
      <ForecastGrid tipo={tipo} year={yearA} />
      <GroupForecastCard tipo={tipo} year={yearA} />
    </div>
  )}
  ```
  (importar `GroupForecastCard from './forecast/GroupForecastCard'`).

- [ ] **Step 3: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run && cd ../.. && npm run build --workspace=apps/portal`.
- [ ] **Step 4: Commit** `feat(salestracker): tarjeta Forecast estacional por grupo`.

---

## Task 2: Polish Tablas (orden + color por st_categories)

- [ ] **Step 1: `lib/category-month-pivot.ts` — helper puro** `orderAndColorRows`
```typescript
export interface DecoratedCategoryRow extends CategoryRow { color: string | null }
/**
 * Reordena las filas del pivote según el orden de config (st_categories.sort_order, asc) y
 * les adjunta el color de config. El match es por nombre, case-insensitive/trim.
 * Categorías presentes en ventas pero NO en config van al final, conservando su orden de entrada
 * (que ya viene por total desc). is_active se ignora (los datos se muestran igual).
 */
export function orderAndColorRows(
  rows: CategoryRow[],
  categories: { name: string; color: string | null; sort_order: number }[],
): DecoratedCategoryRow[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const cfg = new Map(categories.map((c) => [norm(c.name), c]));
  const decorated = rows.map((r, i) => {
    const c = cfg.get(norm(r.categoryName));
    return { ...r, color: c?.color ?? null, _order: c ? c.sort_order : Number.MAX_SAFE_INTEGER, _idx: i };
  });
  decorated.sort((a, b) => a._order - b._order || a._idx - b._idx); // estable: no-config al final por total desc
  return decorated.map(({ _order, _idx, ...rest }) => rest);
}
```
(usa un tipo interno para el sort; el retorno es `DecoratedCategoryRow[]` limpio.)

- [ ] **Step 2: `lib/category-month-pivot.test.ts`** — añadir tests de `orderAndColorRows`: (a) reordena según `sort_order` (no por total); (b) adjunta el color correcto por match case-insensitive; (c) categoría sin config → `color: null` y va al final; (d) no muta el array de entrada.

- [ ] **Step 3: `pages/Tablas.tsx`** — integrar:
  - Añadir `const cq = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });` (import `fetchCategories` de `../api`).
  - `const displayRows = orderAndColorRows(pivot.rows, cq.data ?? []);` (import el helper).
  - Renderizar `displayRows` en el `<tbody>` en vez de `pivot.rows`. En la celda de categoría, anteponer un swatch: `<span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ backgroundColor: r.color ?? '#94a3b8' }} />` + `r.categoryName`. `key={r.categoryName}`.
  - Los totales/mensual/acumulado y export CSV/TSV se dejan igual (siguen usando `pivot`, que no cambia sumas). Nota: el CSV mantiene el orden por total (aceptable); solo la vista se reordena. *(Si es trivial, opcional: exportar en el orden de `displayRows` — pero NO es requisito.)*
  - No filtres categorías; solo reordena/colorea.

- [ ] **Step 4: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run`.
- [ ] **Step 5: Commit** `feat(salestracker): Tablas ordenadas y coloreadas por categorías de config`.

---

## Task 3: Verificación e2e + handoff

- [ ] **Step 1: Verificación completa** salestracker (`tsc --noEmit` + `vitest run`) + portal `npm run build --workspace=apps/portal`. Reportar salida real.
- [ ] **Step 2: Handoff:** merge/push + redeploy **solo del PORTAL** (sin backend/migración). Verificar: (a) `/salestracker/analisis` → pestaña **Forecast** → nueva tarjeta "Forecast estacional por grupo" (barras reales apiladas + línea de proyección; requiere agrupaciones creadas, si no → enlace a Categorías). (b) `/salestracker/tablas` → filas ordenadas por el orden de config con swatch de color.

---

## Self-Review (cobertura)
- GroupForecast (barras reales apiladas + línea forecast total, años históricos relativos a baseYear, run-rate del mes en curso): T1. ✅
- Polish Tablas (orden por sort_order + color por config, helper puro testeado, swatch): T2. ✅
- Sin backend nuevo (reusa `/grouping-analysis`, `/sales`, `/categories`). ✅
- Estado vacío de GroupForecast enlaza a Categorías. Nav absoluta. ✅
- Diferidos NO incluidos (decisión del usuario): `HistoricalSalesCategory` + `ForecastSalesCategory` por-categoría (multi-selector de 69 cats, solapan con las tarjetas por grupo). Anotado como opcional futuro.

Sin placeholders. GroupForecast comparte queryKey `['grouping-analysis', tipo]` con 3D. El helper de Tablas no muta entradas y es puro (testeado).

## Próximos: (opcional) gemelas por-categoría · **Plan 5 (cutover)** — paridad vs `reference/` + retiro BD/better-auth/servicio Next.
