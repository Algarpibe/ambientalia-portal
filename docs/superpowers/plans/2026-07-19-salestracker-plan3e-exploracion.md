# salestracker → Portal — Plan 3E: Análisis → pestaña "Exploración" (read-only)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Añadir la 4ª pestaña **Exploración** a Análisis con sus 2 tarjetas read-only: (1) **Comparativa mensual global** (barras año A vs año B por mes) y (2) **ST vs C&R** (análisis financiero Servicio Técnico vs Consumibles, con toggle Mensual/Trimestral/Anual: barras apiladas A/B + línea acumulada + tabla con YoY). Las tarjetas de agrupaciones de esta pestaña quedan para el Plan 3D (tras Plan 4).

**Architecture:** SIN backend nuevo — reusa `fetchSales()`. El ST/C&R se clasifica con las listas de nombres `ST_CATEGORIES`/`CR_CATEGORIES` directamente sobre `SalesRow.categoryName` (la app Next mapeaba category_id→nombre vía su tabla `categories`; aquí el nombre ya viene en el feed → read-only puro, sin config). Se crea una lib pura testeada `analytics-exploracion.ts`. Se añade un control **año B** (default yearA-1) para esta pestaña. Tarjetas en **Tailwind plano + recharts** (sin shadcn).

**Tech Stack:** sub-app Vite (React 19, react-router 7, @tanstack/react-query v5, recharts). Nav ABSOLUTA.

---

## File Structure
**Frontend (`apps/salestracker/src/`):**
- `lib/analytics-exploracion.ts` + `.test.ts` (nuevo).
- `pages/exploracion/` (nuevo) — `GlobalMonthlyCard.tsx` + `TechServiceCard.tsx`.
- `pages/Analisis.tsx` (modificar) — 4ª pestaña + control año B.

No cambia backend. Reusa `monthlyByYear` de `lib/forecast-input.ts`, `fetchSales`, `SalesRow`, `RecordType`, `format.ts` (`formatUSD`, `formatCompactUSD`, `MONTHS`).

---

## Task 1: Lib pura `analytics-exploracion.ts` (TDD)

- [ ] **Step 1: Test que falla** — `analytics-exploracion.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { slotsForViewMode, buildTechService, ST_CATEGORIES, CR_CATEGORIES } from './analytics-exploracion';
import type { SalesRow } from '../api';

const rows: SalesRow[] = [
  { categoryName: 'CAL PM', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 100 }, // ST
  { categoryName: 'C&R EDM 180', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 40 }, // C&R
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 999 }, // ni ST ni C&R → ignorado
  { categoryName: 'CAL PM', recordType: 'INVOICE', month: 4, year: 2025, amountUsd: 60 }, // ST año B, T2
];

describe('slotsForViewMode', () => {
  it('QUARTERLY → 4 trimestres', () => { expect(slotsForViewMode('QUARTERLY').map((s) => s.label)).toEqual(['T1', 'T2', 'T3', 'T4']); });
  it('ANNUAL → 1 slot con 12 meses', () => { expect(slotsForViewMode('ANNUAL')[0].months).toHaveLength(12); });
  it('MONTHLY → 12 slots', () => { expect(slotsForViewMode('MONTHLY')).toHaveLength(12); });
});

describe('buildTechService', () => {
  it('clasifica ST/C&R por nombre, ignora otras, acumula, y trae año B', () => {
    const pts = buildTechService(rows, { yearA: 2026, yearB: 2025, tipo: 'INVOICE', viewMode: 'QUARTERLY' });
    const t1 = pts[0];
    expect(t1.st).toBe(100); expect(t1.cr).toBe(40); expect(t1.total).toBe(140); expect(t1.acum).toBe(140);
    const t2 = pts[1];
    expect(t2.st_prev).toBe(60); // año B, T2
    expect(pts[3].acum).toBe(140); // acumulado A sin cambios en T2..T4
  });
});
```

- [ ] **Step 2: Implementar `analytics-exploracion.ts`** (listas verbatim de `reference/.../analytics/page.tsx` líneas 124-133)
```typescript
import type { SalesRow, RecordType } from '../api';
import { MONTHS } from './format';

export const ST_CATEGORIES = [
  'Alquileres', 'CAL CO', 'CAL NOx', 'CAL O3', 'CAL PM', 'CAL SO2', 'ST',
  'ST APMA', 'ST APNA', 'ST APOA', 'ST APSA', 'ST EDM 180',
];
export const CR_CATEGORIES = [
  'C&R AP Series', 'C&R APMA-370', 'C&R APNA-370', 'C&R APOA-370', 'C&R APSA-370',
  'C&R D-R 290', 'C&R EDM 180', 'C&R ENDA Series', 'C&R Enviro', 'C&R OCMA-500',
  'C&R PG Series', 'C&R Series 6103', 'C&R Series 7000', 'C&R Shelter', 'C&R U-50 Series',
];

export type TechViewMode = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
export interface TechSlot { label: string; months: number[] }
export interface TechPoint {
  label: string; st: number; cr: number; total: number; acum: number;
  st_prev: number; cr_prev: number; total_prev: number; acum_prev: number;
}

export function slotsForViewMode(mode: TechViewMode): TechSlot[] {
  if (mode === 'MONTHLY') return MONTHS.map((m, i) => ({ label: m, months: [i + 1] }));
  if (mode === 'QUARTERLY') return [
    { label: 'T1', months: [1, 2, 3] }, { label: 'T2', months: [4, 5, 6] },
    { label: 'T3', months: [7, 8, 9] }, { label: 'T4', months: [10, 11, 12] },
  ];
  return [{ label: 'Anual', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }];
}

const stSet = new Set(ST_CATEGORIES);
const crSet = new Set(CR_CATEGORIES);

/** Serie ST/C&R por slot (año A) con comparativa del año B y acumulados. Ignora categorías fuera de ST/C&R. */
export function buildTechService(
  rows: SalesRow[],
  opts: { yearA: number; yearB: number; tipo: RecordType; viewMode: TechViewMode },
): TechPoint[] {
  const { yearA, yearB, tipo, viewMode } = opts;
  const slots = slotsForViewMode(viewMode);
  let acum = 0, acum_prev = 0;
  return slots.map((slot) => {
    const inSlot = (r: SalesRow, y: number) => r.year === y && r.recordType === tipo && slot.months.includes(r.month);
    let st = 0, cr = 0, st_prev = 0, cr_prev = 0;
    for (const r of rows) {
      if (inSlot(r, yearA)) { if (stSet.has(r.categoryName)) st += r.amountUsd; else if (crSet.has(r.categoryName)) cr += r.amountUsd; }
      else if (inSlot(r, yearB)) { if (stSet.has(r.categoryName)) st_prev += r.amountUsd; else if (crSet.has(r.categoryName)) cr_prev += r.amountUsd; }
    }
    const total = st + cr, total_prev = st_prev + cr_prev;
    acum += total; acum_prev += total_prev;
    return { label: slot.label, st, cr, total, acum, st_prev, cr_prev, total_prev, acum_prev };
  });
}

/** YoY % (null si base 0 y actual 0). */
export function yoy(current: number, prev: number): number | null {
  if (prev === 0) return current > 0 ? 100 : null;
  return ((current - prev) / prev) * 100;
}
```

- [ ] **Step 3: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run src/lib/`.
- [ ] **Step 4: Commit** `feat(salestracker): lib pura analytics-exploracion (ST/C&R) + test`.

---

## Task 2: Pestaña Exploración (2 tarjetas) + control año B

**Files:** Create `pages/exploracion/{GlobalMonthlyCard,TechServiceCard}.tsx`; Modify `pages/Analisis.tsx`.

- [ ] **Step 1: `GlobalMonthlyCard.tsx`** (barras A vs B por mes; props `{tipo, yearA, yearB}`)
- Fetch `useQuery({ queryKey: ['sales'], queryFn: fetchSales })`. Datos con `monthlyByYear` (de `../../lib/forecast-input`): `const a = monthlyByYear(rows, yearA, tipo); const b = monthlyByYear(rows, yearB, tipo); const data = MONTHS.map((m,i)=>({ mes:m, ventasA:a[i], ventasB:b[i] }));`
- Chart en `ChartCard`: `BarChart` (height 340), X `dataKey="mes"`, Y `formatCompactUSD`, `<Bar dataKey="ventasA" name={String(yearA)} fill="#2563eb"/>` + `<Bar dataKey="ventasB" name={String(yearB)} fill="#cbd5e1"/>`, `<Legend/>`, tooltip `formatUSD`. Título "Comparativa mensual · {yearA} vs {yearB}".

- [ ] **Step 2: `TechServiceCard.tsx`** (ST vs C&R; props `{tipo, yearA, yearB}`)
- Estado local `viewMode` (default 'QUARTERLY'). Fetch `['sales']`. `const data = buildTechService(rows, { yearA, yearB, tipo, viewMode });` `const totals = data.reduce(...)` (st, cr, total, st_prev, cr_prev, total_prev).
- Toggle Mensual/Trimestral/Anual (3 botones planos que setean `viewMode`).
- **Gráfico** (`ComposedChart`, height 380): X `dataKey="label"`; Y izq `yAxisId="left"` `formatCompactUSD`; Y der `yAxisId="right"` `formatCompactUSD`. Barras apiladas año A: `<Bar yAxisId="left" dataKey="st" name={`ST ${yearA}`} stackId="a" fill="#6366f1"/>` + `<Bar ... dataKey="cr" name={`C&R ${yearA}`} stackId="a" fill="#8b5cf6"/>`; barras apiladas año B: `dataKey="st_prev"` (`#f59e0b`) + `dataKey="cr_prev"` (`#fbbf24`) `stackId="b"`. Línea acumulada `<Line yAxisId="right" dataKey="acum" name={`Acum ${yearA}`} stroke="#10b981" strokeWidth={3} dot/>`. `<Legend/>`, `<CartesianGrid strokeDasharray="3 3"/>`, tooltip `formatUSD`.
- **Tabla** (compacta, `overflow-x-auto`): filas **Servicio Técnico (ST)**, **Consumibles (C&R)**, **Total** con una columna por slot (`formatUSD(q.st/cr/total)`) + columna **YTD** (`formatUSD(totals.*)`); y una fila **Var. acumulada YoY** con `yoy(q.acum, q.acum_prev)` por slot (verde/rojo). Usa `yoy` de la lib y `formatUSD`.
- Título "Análisis ST vs C&R · {yearA} vs {yearB}", subtítulo "Servicio Técnico (mano de obra/CAL/ST) vs Consumibles y Repuestos (C&R). Clasificación por categoría.".

- [ ] **Step 3: `Analisis.tsx` — 4ª pestaña + año B**
- Ampliar `tab` a `'comercial' | 'margen' | 'forecast' | 'exploracion'`; añadir el 4º botón "Exploración".
- Añadir estado `yearB` (default `anioActual - 1`) y un `<select>` de año B en los controles compartidos (o solo visible cuando `tab==='exploracion'`; los años de `YEARS`). El resto de pestañas ignoran yearB.
- Render condicional de la pestaña Exploración:
```tsx
{tab === 'exploracion' && (
  <div className="space-y-6">
    <GlobalMonthlyCard tipo={tipo} yearA={yearA} yearB={yearB} />
    <TechServiceCard tipo={tipo} yearA={yearA} yearB={yearB} />
  </div>
)}
```

- [ ] **Step 4: Verificar**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
- [ ] **Step 5: Commit** `feat(salestracker): pestaña Exploración (comparativa mensual + ST/C&R)`.

---

## Task 3: Verificación end-to-end + handoff

- [ ] **Step 1: Verificación completa** (salestracker tsc+tests, portal build; hub-api NO cambia). Reportar salida real.
- [ ] **Step 2: Handoff:** merge/push + redeploy **solo del portal**. Verificar `/salestracker/analisis` → pestaña Exploración: comparativa mensual A vs B + ST/C&R con toggle de granularidad y tabla YoY.

---

## Self-Review (cobertura)
- Lib pura analytics-exploracion (ST/C&R por nombre, slots, YoY) + test: T1. ✅
- Pestaña Exploración (comparativa mensual + ST/C&R chart+tabla+toggle) Tailwind plano: T2. ✅
- Control año B añadido. Reusa `monthlyByYear`. Sin backend nuevo. ✅
- Diferido: grouping cards de Exploración (3D, tras Plan 4). Anotado.

Sin placeholders. Listas ST/CR verbatim. `buildTechService` clasifica por `categoryName` (read-only, sin tabla de config). Tipos consistentes (`TechPoint`).

## Próximos: **Analítica read-only COMPLETA tras 3E.** Luego Plan 4 (config/escritura) → 3D (grouping) → Plan 5 (cutover).
