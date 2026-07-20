# salestracker → Portal — Plan 2E: página "Tablas"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Portar la página **Tablas** (`/salestracker/tablas`): pivote **Categoría × 12 meses** con columna **Total anual**, filas de pie **TOTAL MENSUAL** y **TOTAL ACUMULADO**, filtros año + tipo (Facturas/Órdenes/Backlog), y export CSV/copiar.

**Architecture:** SIN backend nuevo. Reusa `GET /api/salestracker/sales` y `fetchSales` (de Plan 1), que devuelve `SalesRow[] {categoryName, recordType, month, year, amountUsd}`. Se añade una lib pura testeada `category-month-pivot.ts` que arma el pivote client-side (mejora sobre la app Next, que tenía el pivote inline sin tests). Página en **Tailwind plano** (sin shadcn; xlsx diferido, CSV+copiar). Nav ABSOLUTA (`APP_BASE`).

**Decisión de datos:** se pivota directamente sobre `categoryName` del endpoint `/sales` (la app Next remapeaba a las categorías de su propia BD, que es config del **Plan 4**). Para 2E, `categoryName` del hub es suficiente.

**Alcance:** una página. Cierra el bloque de páginas core (2A–2E).

**Tech Stack:** sub-app Vite (React 19, react-router 7, @tanstack/react-query v5). Patrón idéntico a 2A–2D.

---

## File Structure
**Frontend (`apps/salestracker/src/`):**
- `lib/category-month-pivot.ts` + `.test.ts` (nuevo).
- `pages/Tablas.tsx` (nuevo).
- `components/Nav.tsx` (modificar) — enlace "Tablas".
- `App.tsx` (modificar) — ruta `tablas`.

No cambia backend. `fetchSales`, `SalesRow`, `RecordType`, `format.ts` (`formatUSD`, `MONTHS`) ya existen.

---

## Task 1: Lib pura `category-month-pivot.ts` (TDD)

**Files:** Create `apps/salestracker/src/lib/category-month-pivot.ts` + `.test.ts`.

- [ ] **Step 1: Test que falla**
```typescript
// apps/salestracker/src/lib/category-month-pivot.test.ts
import { describe, it, expect } from 'vitest';
import { availableYears, buildCategoryMonthPivot, pivotToCsv } from './category-month-pivot';
import type { SalesRow } from '../api';

const rows: SalesRow[] = [
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 100 },
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 2, year: 2026, amountUsd: 50 },
  { categoryName: 'Servicios', recordType: 'INVOICE', month: 1, year: 2026, amountUsd: 30 },
  { categoryName: 'Equipos', recordType: 'INVOICE', month: 1, year: 2025, amountUsd: 999 }, // otro año
  { categoryName: 'Equipos', recordType: 'BACKLOG', month: 1, year: 2026, amountUsd: 999 }, // otro tipo
];

describe('availableYears', () => {
  it('devuelve los años presentes, desc', () => {
    expect(availableYears(rows)).toEqual([2026, 2025]);
  });
});

describe('buildCategoryMonthPivot', () => {
  it('pivota por categoría × mes filtrando por año y tipo', () => {
    const p = buildCategoryMonthPivot(rows, 2026, 'INVOICE');
    expect(p.rows.map((r) => r.categoryName)).toEqual(['Equipos', 'Servicios']); // ordenado por total desc
    const equipos = p.rows[0];
    expect(equipos.months[0]).toBe(100);
    expect(equipos.months[1]).toBe(50);
    expect(equipos.total).toBe(150);
    expect(p.monthlyTotals[0]).toBe(130); // 100 + 30
    expect(p.cumulative[1]).toBe(180);    // (100+30) + (50)
    expect(p.grandTotal).toBe(180);
  });
  it('año/tipo sin datos → filas vacías', () => {
    expect(buildCategoryMonthPivot(rows, 2099, 'INVOICE').rows).toEqual([]);
  });
});

describe('pivotToCsv', () => {
  it('incluye cabecera, categorías, TOTAL MENSUAL y TOTAL ACUMULADO', () => {
    const csv = pivotToCsv(buildCategoryMonthPivot(rows, 2026, 'INVOICE'));
    const lines = csv.split('\n');
    expect(lines[0].startsWith('Categoría;Ene;')).toBe(true);
    expect(lines.some((l) => l.startsWith('TOTAL MENSUAL;'))).toBe(true);
    expect(lines.some((l) => l.startsWith('TOTAL ACUMULADO;'))).toBe(true);
  });
});
```
Correr → FALLA (módulo no existe).

- [ ] **Step 2: Implementar**
```typescript
// apps/salestracker/src/lib/category-month-pivot.ts
import type { SalesRow, RecordType } from '../api';
import { MONTHS } from './format';

export interface CategoryRow { categoryName: string; months: number[]; total: number } // months: 12
export interface CategoryMonthPivot {
  rows: CategoryRow[];
  monthlyTotals: number[]; // 12
  cumulative: number[];    // 12 (suma corrida de monthlyTotals)
  grandTotal: number;
}

/** Años presentes en las filas, descendente. */
export function availableYears(rows: SalesRow[]): number[] {
  return [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a);
}

/** Pivote Categoría × 12 meses para un año y tipo dados. Categorías ordenadas por total desc. */
export function buildCategoryMonthPivot(rows: SalesRow[], year: number, type: RecordType): CategoryMonthPivot {
  const byCat = new Map<string, number[]>();
  for (const r of rows) {
    if (r.year !== year || r.recordType !== type) continue;
    let m = byCat.get(r.categoryName);
    if (!m) { m = new Array(12).fill(0) as number[]; byCat.set(r.categoryName, m); }
    if (r.month >= 1 && r.month <= 12) m[r.month - 1] += r.amountUsd;
  }
  const catRows: CategoryRow[] = [...byCat.entries()]
    .map(([categoryName, months]) => ({ categoryName, months, total: months.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.total - a.total || a.categoryName.localeCompare(b.categoryName));

  const monthlyTotals = new Array(12).fill(0) as number[];
  for (const cr of catRows) for (let i = 0; i < 12; i++) monthlyTotals[i] += cr.months[i];
  const cumulative: number[] = [];
  let acc = 0;
  for (let i = 0; i < 12; i++) { acc += monthlyTotals[i]; cumulative.push(acc); }
  const grandTotal = monthlyTotals.reduce((s, v) => s + v, 0);
  return { rows: catRows, monthlyTotals, cumulative, grandTotal };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV del pivote: cabecera + categorías + TOTAL MENSUAL + TOTAL ACUMULADO. */
export function pivotToCsv(p: CategoryMonthPivot): string {
  const header = ['Categoría', ...MONTHS, 'Total'];
  const body = p.rows.map((r) => [r.categoryName, ...r.months.map((v) => v.toFixed(2)), r.total.toFixed(2)]);
  const mensual = ['TOTAL MENSUAL', ...p.monthlyTotals.map((v) => v.toFixed(2)), p.grandTotal.toFixed(2)];
  const acumulado = ['TOTAL ACUMULADO', ...p.cumulative.map((v) => v.toFixed(2)), p.grandTotal.toFixed(2)];
  return [header, ...body, mensual, acumulado].map((row) => row.map(csvCell).join(';')).join('\n');
}
```
Correr → PASA.

- [ ] **Step 3: Verificar** `cd apps/salestracker && npx tsc --noEmit && npx vitest run src/lib/category-month-pivot.test.ts`.
- [ ] **Step 4: Commit** `feat(salestracker): lib pura de pivote categoría×mes + test`.

---

## Task 2: Página Tablas + ruta/nav

**Files:** Create `pages/Tablas.tsx`; Modify `Nav.tsx`, `App.tsx`.

- [ ] **Step 1: `Tablas.tsx`** (Tailwind plano)

Usa `fetchSales` de `../api`, `availableYears`/`buildCategoryMonthPivot`/`pivotToCsv` de `../lib/category-month-pivot`, `formatUSD`/`MONTHS` de `../lib/format`. Detalles:
- `const q = useQuery({ queryKey: ['sales'], queryFn: fetchSales });`
- Estado: `tipo` (`RecordType`, default `'INVOICE'`), `year` (number). Deriva `years = availableYears(q.data ?? [])`. Inicializa/ajusta `year` al primero disponible: usa un `useEffect` o, más simple, `const yearSel = years.includes(year) ? year : (years[0] ?? new Date().getFullYear());` y controla el `<select>` con `yearSel`. (Evita `year=NaN`.)
- `const pivot = buildCategoryMonthPivot(q.data ?? [], yearSel, tipo);`
- Cabecera: `<h1>Tablas</h1>` + subtítulo "Ventas por categoría y mes (USD).".
- Controles (nativos): `<select>` tipo con 3 opciones — "Facturas (FAC)"→INVOICE, "Órdenes de Venta (OV)"→SALES_ORDER, "Backlog"→BACKLOG; `<select>` año poblado con `years` (si vacío, un solo option con el año actual). Botones export "CSV" (`pivotToCsv(pivot)` → Blob `text/csv;charset=utf-8`, filename `tablas-${tipo}-${yearSel}.csv`) y "Copiar" (helper local `pivotToTsv` = `pivotToCsv(pivot)` con `;`→`\t` **seguro**, o construido a mano igual que el CSV pero con `\t`; deshabilitar si `pivot.rows.length === 0`).
- Tabla (scroll horizontal por las 14 columnas): cabecera `Categoría | Ene | … | Dic | Total`. Cuerpo: una fila por `pivot.rows` (categoría, 12 meses con `formatUSD`, total con `formatUSD`, este último en negrita). Pie (2 filas, `border-t-2 font-bold bg-gray-50`): **TOTAL MENSUAL** (`monthlyTotals` + `grandTotal`) y **TOTAL ACUMULADO** (`cumulative` + `grandTotal`). Números `text-right tabular-nums`, primera columna `text-left` sticky opcional.
- Si `pivot.rows.length === 0`: mensaje "Sin datos para {yearSel} / {tipo}." en vez de la tabla.
- Estados: carga "Cargando…"; error `(q.error as Error).message`. Estilo plano como Home/Articulos/Clientes (`p-8 space-y-6`, tabla `w-full text-sm`, cabecera `bg-gray-50`, contenedor `overflow-x-auto rounded-xl border bg-white`). Sin shadcn.

- [ ] **Step 2: `Nav.tsx` — enlace** (ubícalo tras "Inicio" o al final; sugerido tras "Artículos" para agrupar las vistas tabulares):
```tsx
      <NavLink to={`${APP_BASE}/tablas`} className={link}>Tablas</NavLink>
```

- [ ] **Step 3: `App.tsx` — ruta** (dentro del Layout):
```tsx
        <Route path="tablas" element={<Tablas />} />
```
(`import Tablas from './pages/Tablas';`)

- [ ] **Step 4: Verificar**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
Expected: compila, tests pasan, build del portal exit 0.

- [ ] **Step 5: Commit** `feat(salestracker): página Tablas (pivote categoría×mes, export)`.

---

## Task 3: Verificación end-to-end + handoff

- [ ] **Step 1: Verificación completa**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
(hub-api NO cambia en 2E.)
- [ ] **Step 2: Handoff:** merge/push + redeploy **solo del portal**. Verificar en `/salestracker/tablas`: pivote categoría×mes, filtros año/tipo, TOTAL MENSUAL + ACUMULADO, export CSV/copiar.

---

## Self-Review (cobertura)
- Lib pura de pivote + tests (TDD): T1. ✅
- Página Tablas (pivote, filtros año/tipo, totales, export) Tailwind plano: T2. ✅
- Reusa `/sales` — sin backend nuevo. ✅
- Nav absoluta (APP_BASE). ✅
- Diferido: remap a categorías de config (Plan 4), export xlsx. Anotado.

Sin placeholders. Tipos consistentes (`SalesRow`, `RecordType`, `CategoryMonthPivot`). Sin `item_id`.

## Próximos: **Bloque 2 (páginas core) COMPLETO tras 2E.** Luego Plan 3 (analítica pesada: analytics/margen/forecast) · 4 (config/escritura: migración `portal.salestracker_*`, favoritos/vistas, remap de categorías) · 5 (cutover: paridad vs `reference/`, retiro BD/better-auth/servicio Next).
