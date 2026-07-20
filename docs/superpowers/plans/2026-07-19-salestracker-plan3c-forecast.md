# salestracker → Portal — Plan 3C: Análisis → pestaña "Forecast"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Añadir la pestaña **Forecast** a Análisis: 2 tarjetas de proyección (cierre del **mes** actual y del **año**, con run-rate + banda + on-track vs año anterior) y un gráfico de **proyección estacional** (barras Año A vs Año B + línea de tendencia/forecast). En vivo del feed de ventas.

**Architecture:** SIN backend nuevo — reusa `fetchSales()` (toda la historia). Se portan **verbatim** las libs puras testeadas `math-utils.ts` + `forecast.ts`, y se crea un helper puro testeado `forecast-input.ts` que ensambla el `ForecastInput` desde `SalesRow[]` (matrices mensuales por año + estacionalidad de los 3 años previos, pesos [3,2,1]). La tarjeta de run-rate se reimplementa en **Tailwind plano** (la de referencia usa framer-motion + shadcn). Se añade la 3ª pestaña al `Analisis.tsx` (Comercial | Margen | Forecast).

**Tech Stack:** sub-app Vite (React 19, react-router 7, @tanstack/react-query v5, recharts). Nav ABSOLUTA.

**Diferido (anotado):** `ForecastSalesCategory` (forecast por categoría) y las piezas read-only de la pestaña Exploración (barra global A-vs-B, ST-vs-C&R) → mini-plan posterior. El **forecast por grupos** es Plan 3D (tras Plan 4).

---

## File Structure
**Frontend (`apps/salestracker/src/`):**
- `lib/math-utils.ts` + `.test.ts` (portar verbatim).
- `lib/forecast.ts` + `.test.ts` (portar verbatim; import a `./math-utils`).
- `lib/forecast-input.ts` + `.test.ts` (nuevo, puro) — `monthlyByYear` + `buildForecastInput`.
- `pages/forecast/` (nuevo) — `RunRateCard.tsx` + `ForecastTab.tsx` (o tarjetas sueltas).
- `pages/Analisis.tsx` (modificar) — 3ª pestaña Forecast.

No cambia backend. `fetchSales`, `SalesRow`, `RecordType`, `format.ts` (`formatUSD`, `formatCompactUSD`, `MONTHS`) ya existen.

---

## Task 1: Portar libs forecast + helper de ensamblaje (TDD)

- [ ] **Step 1: Portar `math-utils.ts` + test (verbatim)**

Copiar `reference/salestracker-next/src/lib/math-utils.ts` → `apps/salestracker/src/lib/math-utils.ts` (sin imports, verbatim: `calculateLinearRegression`, `getTrendPoints`, `calculateRunRate`, `calculateSeasonalityFactors`, `getSeasonalForecast`). Copiar su test `reference/.../__tests__/math-utils.test.ts` → `math-utils.test.ts` (ajustar import a `./math-utils`).

- [ ] **Step 2: Portar `forecast.ts` + test (verbatim)**

Copiar `reference/.../src/lib/forecast.ts` → `apps/salestracker/src/lib/forecast.ts`. Cambiar el import a `import { calculateSeasonalityFactors, calculateRunRate } from './math-utils';`. Resto verbatim (`computeForecast`, tipos `ForecastNow`/`ForecastInput`/`ProjectionStat`/`ForecastResult`). Copiar su test → `forecast.test.ts` (ajustar imports).

- [ ] **Step 3: Crear `forecast-input.ts` + test (nuevo, puro)**

```typescript
// apps/salestracker/src/lib/forecast-input.ts
import type { SalesRow, RecordType } from '../api';
import type { ForecastInput } from './forecast';

/** Suma mensual (12) de un año/tipo desde el feed de ventas. */
export function monthlyByYear(rows: SalesRow[], year: number, tipo: RecordType): number[] {
  const m = new Array(12).fill(0) as number[];
  for (const r of rows) {
    if (r.year === year && r.recordType === tipo && r.month >= 1 && r.month <= 12) m[r.month - 1] += r.amountUsd;
  }
  return m;
}

/** Ensambla el ForecastInput para el año A (vs A-1, estacionalidad de A-1..A-3, pesos [3,2,1]). `now` se inyecta para testear. */
export function buildForecastInput(
  rows: SalesRow[],
  opts: { yearA: number; tipo: RecordType; now: Date },
): ForecastInput {
  const { yearA, tipo, now } = opts;
  return {
    currentYearMonthly: monthlyByYear(rows, yearA, tipo),
    lastYearMonthly: monthlyByYear(rows, yearA - 1, tipo),
    historicalMatrix: [yearA - 1, yearA - 2, yearA - 3].map((y) => monthlyByYear(rows, y, tipo)),
    weights: [3, 2, 1],
    now: {
      monthIdx: now.getMonth(),
      day: now.getDate(),
      daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
    },
    isCurrentActualYear: yearA === now.getFullYear(),
  };
}
```
Test `forecast-input.test.ts`: (a) `monthlyByYear` filtra por año+tipo y suma por mes (índice mes-1); ignora otros años/tipos/meses fuera de rango. (b) `buildForecastInput` con `now = new Date(2026, 5, 15)` (15-jun-2026) y filas de ejemplo → `currentYearMonthly` = meses de 2026, `lastYearMonthly` = 2025, `historicalMatrix` = [2025,2024,2023] (3 arrays de 12), `weights=[3,2,1]`, `now.monthIdx=5`, `now.day=15`, `now.daysInMonth=30`, `isCurrentActualYear=true`. (En Vitest/node `new Date(...)` sí funciona.)

- [ ] **Step 4: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run src/lib/`.
- [ ] **Step 5: Commit** `feat(salestracker): portar libs forecast/math-utils + helper forecast-input (+ tests)`.

---

## Task 2: Pestaña Forecast (2 tarjetas run-rate + gráfico estacional) + 3ª pestaña

**Files:** Create `pages/forecast/{RunRateCard,ForecastGrid}.tsx`; Modify `pages/Analisis.tsx`.

- [ ] **Step 1: `RunRateCard.tsx`** (tarjeta de proyección, Tailwind plano)

Reimplementa `PredictiveRunRateCard` sin framer-motion/shadcn. Props derivadas de un `ProjectionStat`:
```tsx
import { formatUSD } from '../../lib/format';
export default function RunRateCard({ title, stat }: {
  title: string;
  stat: { value: number; low: number; high: number; actual: number; reference: number; deltaPct: number | null; onTrack: boolean };
}) {
  const progress = stat.value > 0 ? Math.min(100, (stat.actual / stat.value) * 100) : 0;
  const hasBand = stat.high > stat.low;
  return (
    <div className="rounded-xl border bg-white p-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500">{title}</h3>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-gray-900">{formatUSD(stat.value)}</span>
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Forecast</span>
          </div>
          {hasBand && <p className="text-xs text-gray-500 tabular-nums mt-0.5">Rango: {formatUSD(stat.low)} – {formatUSD(stat.high)}</p>}
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${stat.onTrack ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
          {stat.onTrack ? 'On track' : 'En riesgo'}
        </span>
      </div>
      <div className="mt-4 flex justify-between text-sm">
        <div><div className="text-gray-500">Actual</div><div className="font-bold tabular-nums">{formatUSD(stat.actual)}</div></div>
        <div className="text-right"><div className="text-gray-500">Año anterior</div><div className="font-bold tabular-nums text-gray-500">{formatUSD(stat.reference)}</div></div>
      </div>
      <div className="mt-3 h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full bg-blue-600" style={{ width: `${progress}%` }} />
      </div>
      {stat.deltaPct !== null && (
        <p className={`mt-2 text-xs font-medium ${stat.deltaPct >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
          {stat.deltaPct >= 0 ? '+' : ''}{(stat.deltaPct * 100).toFixed(1)}% vs mismo periodo del año anterior
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `ForecastGrid.tsx`** (ensambla forecast + render de tarjetas + chart; props `{tipo, year}`)
```tsx
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchSales, type RecordTypeIO } from '../../api';
import { buildForecastInput } from '../../lib/forecast-input';
import { computeForecast } from '../../lib/forecast';
import { formatUSD, formatCompactUSD, MONTHS } from '../../lib/format';
import ChartCard from '../comercial/ChartCard';
import RunRateCard from './RunRateCard';

export default function ForecastGrid({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['sales'], queryFn: fetchSales });
  const { forecast, chartData } = useMemo(() => {
    const rows = q.data ?? [];
    const input = buildForecastInput(rows, { yearA: year, tipo, now: new Date() });
    const fc = computeForecast(input);
    const cd = MONTHS.map((m, i) => ({
      mes: m,
      ventasA: input.currentYearMonthly[i],
      ventasB: input.lastYearMonthly[i],
      tendencia: Math.round(fc.monthlyForecast[i] * 100) / 100,
    }));
    return { forecast: fc, chartData: cd };
  }, [q.data, year, tipo]);

  if (q.isLoading) return <p className="p-8 text-gray-600">Cargando forecast…</p>;
  if (q.error) return <p className="p-8 text-red-600">{(q.error as Error).message}</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <RunRateCard title={`Proyección de cierre · mes actual`} stat={forecast.month} />
        <RunRateCard title={`Proyección de cierre · año ${year}`} stat={forecast.year} />
      </div>
      <ChartCard title={`Proyección estacional ${year}`} subtitle={`Barras: ${year} vs ${year - 1}. Línea: forecast estacional del año.`}>
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="mes" />
            <YAxis tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <Tooltip formatter={(v) => formatUSD(Number(v))} />
            <Legend />
            <Bar dataKey="ventasA" name={`${year}`} fill="#2563eb" />
            <Bar dataKey="ventasB" name={`${year - 1}`} fill="#cbd5e1" />
            <Line dataKey="tendencia" name="Forecast" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
```

- [ ] **Step 3: `Analisis.tsx` — 3ª pestaña**

Ampliar el estado `tab` a `'comercial' | 'margen' | 'forecast'`; añadir el 3er botón "Forecast"; render condicional `{tab === 'forecast' && <ForecastGrid tipo={tipo} year={yearA} />}`. Mantener los controles compartidos (tipo, yearA).

- [ ] **Step 4: Verificar**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
- [ ] **Step 5: Commit** `feat(salestracker): pestaña Forecast (run-rate mes/año + proyección estacional)`.

---

## Task 3: Verificación end-to-end + handoff

- [ ] **Step 1: Verificación completa** (salestracker tsc+tests, portal build; hub-api NO cambia). Reportar salida real.
- [ ] **Step 2: Handoff:** merge/push + redeploy **solo del portal** (sin cambios en hub-api). Verificar `/salestracker/analisis` → pestaña Forecast: 2 tarjetas de proyección (mes/año, on-track vs año anterior, banda) + gráfico estacional (barras A/B + línea forecast). Con año A = año actual, la proyección del mes usa run-rate del día.

---

## Self-Review (cobertura)
- Libs forecast/math-utils portadas verbatim + tests: T1. ✅
- Helper puro forecast-input + test: T1. ✅
- Pestaña Forecast (2 run-rate + gráfico estacional) Tailwind plano: T2. ✅
- 3ª pestaña activada. Nav absoluta (sin cambios de ruta). ✅
- Sin backend nuevo (reusa `/sales`). ✅
- Diferido: ForecastSalesCategory, Exploración read-only (mini-plan), forecast por grupos (3D). Anotado.

Sin placeholders. `now` inyectable para tests (en runtime la sub-app usa `new Date()` en el navegador). Tipos consistentes (`ForecastInput`/`ProjectionStat`).

## Próximos: mini-plan Exploración read-only (opcional) · Plan 4 (config/escritura) · 3D (grouping) · Plan 5 (cutover).
