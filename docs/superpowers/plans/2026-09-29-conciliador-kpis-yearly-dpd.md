# Payment Reconciliation KPIs Tab (Yearly DPD Trend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a KPIs tab to the Payment Reconciliation app that shows, per due-date year, the simple and value-weighted average DPD and the % of invoices paid on time.

**Architecture:** A pure metrics module (`computeYearlyTrend`) does all the math and is unit-tested first. A small `KpisTab` component renders loading/empty states and a table, and lazy-loads `YearlyTrendCharts` (the only file that imports Recharts). `App.tsx` adds the tab. The dead `mode='kpis'` branch in `GeneralAnalysis.tsx` is removed.

**Tech Stack:** React 19, TypeScript 5.9 (`noUnusedLocals` on), Vite 7, Vitest 2 + jsdom + React Testing Library, Tailwind 4, Recharts 3 (new), npm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-29-conciliador-kpis-yearly-dpd-design.md`

**Conventions for this repo:**
- Run app commands from `apps/payment-reconciliation`; run `npm install` from the repo root.
- Commit messages: conventional commits, no AI attribution lines.
- Never edit files with PowerShell `Set-Content` (it corrupts accented characters). Use the Edit tool or `sed` from Bash.
- Pushing to `main` deploys (EasyPanel builds `origin/main`).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/payment-reconciliation/src/customerAnalysisUtils.ts` | Modify | `calculateInvoiceDPD` gets an optional `now` parameter (backward compatible) so the yearly trend is deterministic. |
| `apps/payment-reconciliation/src/metrics/yearlyTrendMetrics.ts` | Create | Pure `computeYearlyTrend(rows, today)` and the `YearlyTrendRow` type. |
| `apps/payment-reconciliation/src/metrics/yearlyTrendMetrics.test.ts` | Create | Unit tests for the metric. |
| `apps/payment-reconciliation/package.json`, root `package-lock.json` | Modify | Add `recharts`. |
| `apps/payment-reconciliation/src/YearlyTrendCharts.tsx` | Create | The two Recharts line charts. Default export (for `React.lazy`). |
| `apps/payment-reconciliation/src/KpisTab.tsx` | Create | Loading/empty states, table, lazy charts. |
| `apps/payment-reconciliation/src/KpisTab.test.tsx` | Create | Component test with the charts mocked. |
| `apps/payment-reconciliation/src/App.tsx` | Modify | New `kpis` view and tab button. |
| `apps/payment-reconciliation/src/GeneralAnalysis.tsx` | Modify | Remove the dead `mode='kpis'` branch, its memos, imports and the `mode` prop. |

---

### Task 1: Make `calculateInvoiceDPD` accept a reference date

**Files:**
- Modify: `apps/payment-reconciliation/src/customerAnalysisUtils.ts:283-301`
- Test: `apps/payment-reconciliation/src/customerAnalysisUtils.test.ts`

Why: for an unpaid invoice it measures days until `new Date()`, which makes any test that depends on it non-deterministic.

- [ ] **Step 1: Write the failing test**

Append to `apps/payment-reconciliation/src/customerAnalysisUtils.test.ts` (add `calculateInvoiceDPD` to its existing import from `./customerAnalysisUtils` and `ReconciledRow` type import from `./types` if they are not already there):

```ts
describe('calculateInvoiceDPD with a reference date', () => {
  it('measures an unpaid invoice against the given date', () => {
    const invoice = {
      invoiceNumber: 'X', orderNumber: '', clientName: 'ACME',
      invoiceDate: '1 sep 2026', dueDate: '15 sep 2026', status: 'open',
      total: 50, balance: 50,
      paymentDates: [], paymentAmounts: [], totalPaid: 0,
      isOverdue: true, maxDelayDays: 0, paymentDetails: [],
    } as ReconciledRow;
    expect(calculateInvoiceDPD(invoice, new Date(2026, 8, 29))).toBe(14);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/customerAnalysisUtils.test.ts`
Expected: FAIL — the result depends on the real current date, not 14 (or a TypeScript arity error from `tsc` later).

- [ ] **Step 3: Implement**

In `customerAnalysisUtils.ts`, change the signature and the one line that uses the current date:

```ts
export const calculateInvoiceDPD = (invoice: ReconciledRow, now: Date = new Date()): number => {
    const dueDate = parseExcelDate(invoice.dueDate);
    if (!dueDate) return 0;

    // If invoice has payments, use the latest payment date
    if (invoice.paymentDetails && invoice.paymentDetails.length > 0) {
        // Find the maximum delay from all payments
        const maxDelay = Math.max(...invoice.paymentDetails.map(pd => pd.delay));
        return maxDelay;
    }

    // If no payments and there's a balance, calculate DPD from the reference date
    if (invoice.balance > 0) {
        return calculateDPD(dueDate, now);
    }

    return 0;
};
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/customerAnalysisUtils.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/customerAnalysisUtils.ts apps/payment-reconciliation/src/customerAnalysisUtils.test.ts
git commit -m "refactor(payment-reconciliation): calculateInvoiceDPD acepta fecha de referencia"
```

---

### Task 2: `computeYearlyTrend` metric

**Files:**
- Create: `apps/payment-reconciliation/src/metrics/yearlyTrendMetrics.ts`
- Test: `apps/payment-reconciliation/src/metrics/yearlyTrendMetrics.test.ts`

Reference dataset used by the tests (today = 29 Sep 2026):

| Invoice | Due date | DPD | Total | Year |
|---|---|---|---|---|
| A | 10 mar 2025 | 10 (payment delay) | 100 | 2025 |
| B | 20 jun 2025 | 0 (on time) | 300 | 2025 |
| G | 19 ene 2025 (invoiced 20 dic 2024) | 0 | 100 | 2025 |
| C | 5 ene 2026 | 30 (payment delay) | 200 | 2026 |
| D | 15 sep 2026, unpaid, balance 50 | 14 (to today) | 50 | 2026 |
| E | 15 oct 2026 | not due → excluded | — | — |
| F | unreadable | excluded | — | — |

Expected: 2025 → count 3, simple 10/3, weighted 1000/500 = 2, on time 2/3 = 66.67 %.
2026 → count 2, simple 22, weighted (6000 + 700)/250 = 26.8, on time 0 %, partial.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import type { ReconciledRow } from '../types';
import { computeYearlyTrend } from './yearlyTrendMetrics';

function row(over: Partial<ReconciledRow> = {}): ReconciledRow {
  return {
    invoiceNumber: 'INV', orderNumber: 'OC', clientName: 'ACME',
    invoiceDate: '1 ene 2025', dueDate: '1 ene 2025', status: 'paid',
    total: 0, balance: 0,
    paymentDates: [], paymentAmounts: [], totalPaid: 0,
    isOverdue: false, maxDelayDays: 0, paymentDetails: [],
    ...over,
  };
}

const paidWithDelay = (delay: number) => [{ date: '01/01/2025', delay }];
const TODAY = new Date(2026, 8, 29); // 29 Sep 2026

const DATASET: ReconciledRow[] = [
  row({ invoiceNumber: 'A', dueDate: '10 mar 2025', total: 100, paymentDetails: paidWithDelay(10) }),
  row({ invoiceNumber: 'B', dueDate: '20 jun 2025', total: 300, paymentDetails: paidWithDelay(0) }),
  row({ invoiceNumber: 'G', invoiceDate: '20 dic 2024', dueDate: '19 ene 2025', total: 100, paymentDetails: paidWithDelay(0) }),
  row({ invoiceNumber: 'C', dueDate: '5 ene 2026', total: 200, paymentDetails: paidWithDelay(30) }),
  row({ invoiceNumber: 'D', dueDate: '15 sep 2026', total: 50, balance: 50 }),
  row({ invoiceNumber: 'E', dueDate: '15 oct 2026', total: 999, balance: 999 }),
  row({ invoiceNumber: 'F', dueDate: null, total: 999 }),
];

describe('computeYearlyTrend', () => {
  const result = computeYearlyTrend(DATASET, TODAY);
  const byYear = (y: number) => result.find((r) => r.year === y)!;

  it('groups by due-date year and sorts years ascending', () => {
    expect(result.map((r) => r.year)).toEqual([2025, 2026]);
  });

  it('uses the due-date year, not the invoice-date year', () => {
    expect(result.find((r) => r.year === 2024)).toBeUndefined();
    expect(byYear(2025).invoiceCount).toBe(3);
  });

  it('excludes invoices not yet due and unreadable due dates', () => {
    expect(byYear(2026).invoiceCount).toBe(2);
  });

  it('computes the simple average DPD', () => {
    expect(byYear(2025).averageDPD).toBeCloseTo(10 / 3, 5);
    expect(byYear(2026).averageDPD).toBeCloseTo(22, 5);
  });

  it('computes the value-weighted average DPD over all due invoices', () => {
    expect(byYear(2025).weightedDPD).toBeCloseTo(2, 5);
    expect(byYear(2026).weightedDPD).toBeCloseTo(26.8, 5);
  });

  it('computes the on-time percentage', () => {
    expect(byYear(2025).onTimePercentage).toBeCloseTo(200 / 3, 5);
    expect(byYear(2026).onTimePercentage).toBe(0);
  });

  it('flags only the current year as partial', () => {
    expect(byYear(2025).isPartialYear).toBe(false);
    expect(byYear(2026).isPartialYear).toBe(true);
  });

  it('treats a negative DPD as 0 days and on time', () => {
    const [only] = computeYearlyTrend(
      [row({ dueDate: '1 feb 2025', total: 100, paymentDetails: paidWithDelay(-3) })],
      TODAY,
    );
    expect(only.averageDPD).toBe(0);
    expect(only.onTimePercentage).toBe(100);
  });

  it('returns a weighted DPD of 0 when the year has no invoice value', () => {
    const [only] = computeYearlyTrend(
      [row({ dueDate: '1 feb 2025', total: 0, paymentDetails: paidWithDelay(12) })],
      TODAY,
    );
    expect(only.weightedDPD).toBe(0);
    expect(only.averageDPD).toBe(12);
  });

  it('excludes an invoice due today (not yet overdue)', () => {
    expect(computeYearlyTrend([row({ dueDate: '29 sep 2026', total: 10, balance: 10 })], TODAY)).toEqual([]);
  });

  it('returns an empty list for no data', () => {
    expect(computeYearlyTrend([], TODAY)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/metrics/yearlyTrendMetrics.test.ts`
Expected: FAIL — `Failed to resolve import "./yearlyTrendMetrics"`.

- [ ] **Step 3: Implement**

```ts
import type { ReconciledRow } from '../types';
import { calculateInvoiceDPD, parseExcelDate } from '../customerAnalysisUtils';

/**
 * Yearly delinquency trend for the KPIs tab.
 *
 * - An invoice belongs to the year of its DUE date (delinquency starts there).
 * - Only invoices already due before `today` count. Invoices not yet due would
 *   count as 0 days and make the current year look artificially better.
 * - The weighted average covers ALL due invoices (on-time ones weigh 0 days).
 *   It is NOT the "Índice de Severidad" (weightedDPD in customerAnalysisUtils),
 *   which only averages invoices already in arrears.
 */
export interface YearlyTrendRow {
  year: number;
  invoiceCount: number;
  averageDPD: number;
  weightedDPD: number;
  onTimePercentage: number;
  isPartialYear: boolean;
}

interface YearAccumulator {
  count: number;
  dpdSum: number;
  weightedSum: number;
  valueSum: number;
  onTime: number;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function computeYearlyTrend(rows: ReconciledRow[], today: Date): YearlyTrendRow[] {
  const cutoff = startOfDay(today);
  const byYear = new Map<number, YearAccumulator>();

  for (const row of rows) {
    const due = row.dueDate instanceof Date ? row.dueDate : parseExcelDate(row.dueDate);
    if (!due || startOfDay(due) >= cutoff) continue;

    const dpd = Math.max(0, calculateInvoiceDPD(row, cutoff));
    const acc = byYear.get(due.getFullYear()) ?? { count: 0, dpdSum: 0, weightedSum: 0, valueSum: 0, onTime: 0 };
    acc.count += 1;
    acc.dpdSum += dpd;
    acc.weightedSum += dpd * row.total;
    acc.valueSum += row.total;
    if (dpd === 0) acc.onTime += 1;
    byYear.set(due.getFullYear(), acc);
  }

  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, acc]) => ({
      year,
      invoiceCount: acc.count,
      averageDPD: acc.dpdSum / acc.count,
      weightedDPD: acc.valueSum > 0 ? acc.weightedSum / acc.valueSum : 0,
      onTimePercentage: (acc.onTime / acc.count) * 100,
      isPartialYear: year === today.getFullYear(),
    }));
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/metrics/yearlyTrendMetrics.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/metrics/yearlyTrendMetrics.ts apps/payment-reconciliation/src/metrics/yearlyTrendMetrics.test.ts
git commit -m "feat(payment-reconciliation): metrica de tendencia anual de DPD y % a tiempo"
```

---

### Task 3: Add Recharts

**Files:**
- Modify: `apps/payment-reconciliation/package.json`, `package-lock.json` (root)

The root `Dockerfile` copies `apps/payment-reconciliation/package*.json` before `npm install`, and the portal deep-imports this app, so declaring the dependency in this workspace is enough for the production build.

- [ ] **Step 1: Install**

From the repo root:

```bash
npm install recharts@^3 --workspace=apps/payment-reconciliation
```

- [ ] **Step 2: Verify**

```bash
node -e "console.log(require('recharts/package.json').version)"
```

Expected: a `3.x.y` version. `apps/payment-reconciliation/package.json` lists `"recharts": "^3.x.y"` under `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add apps/payment-reconciliation/package.json package-lock.json
git commit -m "build(payment-reconciliation): agrega recharts"
```

---

### Task 4: `YearlyTrendCharts` component

**Files:**
- Create: `apps/payment-reconciliation/src/YearlyTrendCharts.tsx`

No unit test: Recharts' `ResponsiveContainer` needs real layout that jsdom does not provide. It is covered by `tsc -b`, the portal build (Task 8) and the manual check.

- [ ] **Step 1: Create the component**

```tsx
import type React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { YearlyTrendRow } from './metrics/yearlyTrendMetrics';

const oneDecimal = (n: number) =>
  n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-6">
      <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-4">{title}</h3>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

// Loaded with React.lazy from KpisTab: Recharts is downloaded only when the tab opens.
export default function YearlyTrendCharts({ rows }: { rows: YearlyTrendRow[] }) {
  const data = rows.map((r) => ({ ...r, label: r.isPartialYear ? `${r.year}*` : String(r.year) }));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <ChartCard title="DPD promedio por año (días)">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" stroke="#64748b" />
          <YAxis stroke="#64748b" allowDecimals={false} />
          <Tooltip formatter={(v) => `${oneDecimal(Number(v))} días`} />
          <Legend />
          <Line type="monotone" dataKey="averageDPD" name="DPD promedio" stroke="#4f46e5" strokeWidth={2} dot={{ r: 4 }} />
          <Line type="monotone" dataKey="weightedDPD" name="DPD ponderado por valor" stroke="#dc2626" strokeWidth={2} dot={{ r: 4 }} />
        </LineChart>
      </ChartCard>

      <ChartCard title="% de facturas pagadas a tiempo">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" stroke="#64748b" />
          <YAxis stroke="#64748b" domain={[0, 100]} unit="%" />
          <Tooltip formatter={(v) => `${oneDecimal(Number(v))} %`} />
          <Legend />
          <Line type="monotone" dataKey="onTimePercentage" name="% a tiempo" stroke="#059669" strokeWidth={2} dot={{ r: 4 }} />
        </LineChart>
      </ChartCard>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: exit 0. If Recharts' `Tooltip` `formatter` typing rejects the arrow function, type the parameter explicitly as `(v: unknown)`; do not use `any`.

- [ ] **Step 3: Commit**

```bash
git add apps/payment-reconciliation/src/YearlyTrendCharts.tsx
git commit -m "feat(payment-reconciliation): graficos de tendencia anual con recharts"
```

---

### Task 5: `KpisTab` component

**Files:**
- Create: `apps/payment-reconciliation/src/KpisTab.tsx`
- Test: `apps/payment-reconciliation/src/KpisTab.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReconciledRow } from './types';
import KpisTab from './KpisTab';

// Recharts needs real layout; the charts are covered by the build, not here.
vi.mock('./YearlyTrendCharts', () => ({ default: () => <div data-testid="yearly-charts" /> }));

function row(over: Partial<ReconciledRow> = {}): ReconciledRow {
  return {
    invoiceNumber: 'INV', orderNumber: 'OC', clientName: 'ACME',
    invoiceDate: '1 ene 2025', dueDate: '1 ene 2025', status: 'paid',
    total: 100, balance: 0,
    paymentDates: [], paymentAmounts: [], totalPaid: 100,
    isOverdue: false, maxDelayDays: 0, paymentDetails: [{ date: '01/01/2025', delay: 0 }],
    ...over,
  };
}

const TODAY = new Date(2026, 8, 29);

describe('KpisTab', () => {
  it('shows one table row per year and marks the current year as partial', async () => {
    render(
      <KpisTab
        reconciledData={[row({ dueDate: '10 mar 2025' }), row({ dueDate: '5 ene 2026' })]}
        today={TODAY}
      />,
    );
    expect(screen.getByText('2025')).toBeInTheDocument();
    expect(screen.getByText('2026 (parcial)')).toBeInTheDocument();
    expect(await screen.findByTestId('yearly-charts')).toBeInTheDocument();
  });

  it('shows the empty state when no invoice is due yet', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '15 oct 2026' })]} today={TODAY} />);
    expect(screen.getByText(/No hay facturas vencidas/)).toBeInTheDocument();
  });

  it('shows no table while loading', () => {
    render(<KpisTab reconciledData={[row()]} loading today={TODAY} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/KpisTab.test.tsx`
Expected: FAIL — `Failed to resolve import "./KpisTab"`.

- [ ] **Step 3: Implement**

```tsx
import { lazy, Suspense, useMemo } from 'react';
import type { ReconciledRow } from './types';
import { computeYearlyTrend } from './metrics/yearlyTrendMetrics';
import { SkeletonAnalytics } from './SkeletonLoader';

const YearlyTrendCharts = lazy(() => import('./YearlyTrendCharts'));

interface KpisTabProps {
  reconciledData: ReconciledRow[];
  loading?: boolean;
  /** Reference date for "already due"; injectable for tests. */
  today?: Date;
}

const oneDecimal = (n: number) =>
  n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function KpisTab({ reconciledData, loading = false, today }: KpisTabProps) {
  const rows = useMemo(
    () => computeYearlyTrend(reconciledData, today ?? new Date()),
    [reconciledData, today],
  );

  if (loading) return <SkeletonAnalytics cards={3} />;

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-10 text-center text-slate-500">
        No hay facturas vencidas para calcular la tendencia.
      </div>
    );
  }

  const th = 'px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider';

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-slate-500">
        Cada factura cuenta en el año de su <strong>vencimiento</strong> y solo entran las ya vencidas.
        El año marcado con * está en curso.
      </p>

      <Suspense fallback={<SkeletonAnalytics cards={2} />}>
        <YearlyTrendCharts rows={rows} />
      </Suspense>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className={th}>Año</th>
              <th className={`${th} text-right`}>Facturas</th>
              <th className={`${th} text-right`}>DPD promedio</th>
              <th className={`${th} text-right`}>DPD ponderado</th>
              <th className={`${th} text-right`}>% a tiempo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.year}>
                <td className="px-6 py-4 font-medium text-slate-900">
                  {r.isPartialYear ? `${r.year} (parcial)` : r.year}
                </td>
                <td className="px-6 py-4 text-right text-slate-600">{r.invoiceCount}</td>
                <td className="px-6 py-4 text-right text-slate-900">{oneDecimal(r.averageDPD)} días</td>
                <td className="px-6 py-4 text-right text-slate-900">{oneDecimal(r.weightedDPD)} días</td>
                <td className="px-6 py-4 text-right text-slate-900">{oneDecimal(r.onTimePercentage)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/KpisTab.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/KpisTab.tsx apps/payment-reconciliation/src/KpisTab.test.tsx
git commit -m "feat(payment-reconciliation): componente de la pestana KPIs con tabla anual"
```

---

### Task 6: Wire the KPIs tab into `App.tsx`

**Files:**
- Modify: `apps/payment-reconciliation/src/App.tsx`

- [ ] **Step 1: Imports**

Add `BarChart3` to the `lucide-react` import on line 2:

```ts
import { FileDown, Table as TableIcon, AlertCircle, Filter, ArrowUpDown, BarChart3, LayoutGrid, Eye, X, GripVertical } from 'lucide-react';
```

Below `import GeneralAnalysis from './GeneralAnalysis';` add:

```ts
import KpisTab from './KpisTab';
```

- [ ] **Step 2: View type**

```ts
type ActiveView = 'reconciliation' | 'analysis' | 'general' | 'kpis';
```

- [ ] **Step 3: Tab button**

Right after the "Análisis General" button (the `</button>` that follows `Análisis General`), before the closing `</div>` of the tab bar, insert:

```tsx
          <button
            onClick={() => setActiveView('kpis')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${activeView === 'kpis'
              ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600'
              : 'text-slate-500 hover:bg-slate-50 border-b-2 border-transparent'
              }`}
          >
            <BarChart3 size={18} />
            KPIs
          </button>
```

- [ ] **Step 4: View**

Immediately before `      </main>`, insert:

```tsx
        {/* KPIs View — yearly DPD trend; ignores the period filter by design */}
        {activeView === 'kpis' && <KpisTab reconciledData={reconciledData} loading={loading} />}

```

- [ ] **Step 5: Verify**

Run: `npx tsc -b && npx vitest run`
Expected: tsc exit 0; all test files pass.

- [ ] **Step 6: Commit**

```bash
git add apps/payment-reconciliation/src/App.tsx
git commit -m "feat(payment-reconciliation): pestana KPIs con tendencia anual de DPD"
```

---

### Task 7: Remove the dead `mode='kpis'` code from `GeneralAnalysis.tsx`

**Files:**
- Modify: `apps/payment-reconciliation/src/GeneralAnalysis.tsx`
- Modify: `apps/payment-reconciliation/src/App.tsx` (drop `mode="analysis"`)

Line numbers below were measured on commit `e81ce34`. Re-check them before deleting:

```bash
awk 'NR==23||NR==36||NR==112||NR==142||NR==514||NR==842||NR==1118 {printf "%d|%s\n", NR, $0}' src/GeneralAnalysis.tsx
```

Expected output:

```
23|  mode?: 'analysis' | 'kpis';
36|  mode = 'analysis',
112|  const totalReconciledAmount = useMemo(
142|
514|          {mode === 'kpis' && (
842|          {mode !== 'kpis' && (
1118|          )}
```

If any line differs, stop and locate the same anchors by content before continuing.

- [ ] **Step 1: Delete in one pass (sed addresses refer to the original numbering)**

```bash
sed -i -e '1118d' -e '514,842d' -e '112,142d' -e '36d' -e '23d' src/GeneralAnalysis.tsx
```

This removes: the `mode` prop and its default, the eight memos only the KPIs branch used (`totalReconciledAmount` … `customerRetention`), the whole KPIs branch, and the `{mode !== 'kpis' && ( … )}` wrapper around the table.

- [ ] **Step 2: Trim the imports**

Replace the metrics import with:

```ts
import { applyExtraFilters, filterAndSortMetrics } from './metrics/generalAnalysisMetrics';
```

Replace the `lucide-react` import with:

```ts
import { ArrowUpDown, FileDown, Filter, Eye, X, GripVertical } from 'lucide-react';
```

Delete the line:

```ts
import { InfoTooltip } from './components/InfoTooltip';
```

Keep `import { SkeletonAnalytics } from './SkeletonLoader';` (still used for the loading state).

- [ ] **Step 3: Drop the prop at the call site**

In `src/App.tsx`, delete the line `            mode="analysis"` inside the `<GeneralAnalysis … />` element.

- [ ] **Step 4: Verify**

```bash
grep -n "mode" src/GeneralAnalysis.tsx
npx tsc -b
npx vitest run
npx eslint src/GeneralAnalysis.tsx src/App.tsx
```

Expected: `grep` prints nothing; `tsc` exit 0 (with `noUnusedLocals`, any leftover unused import or memo fails here — remove it); all tests pass; eslint reports 0 errors.

Note: the `compute*` functions in `metrics/generalAnalysisMetrics.ts` keep their own tests and are left in place; removing them is out of scope.

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/GeneralAnalysis.tsx apps/payment-reconciliation/src/App.tsx
git commit -m "refactor(payment-reconciliation): elimina el modo kpis muerto de GeneralAnalysis"
```

---

### Task 8: Final verification and delivery

- [ ] **Step 1: App checks** (from `apps/payment-reconciliation`)

```bash
npx tsc -b
npx vitest run
npx eslint src
```

Expected: tsc exit 0; every test file passes; eslint 0 errors (pre-existing warnings are acceptable).

- [ ] **Step 2: Production build of the portal** (from the repo root)

The portal deep-imports this app and type-checks it under its own strict tsconfig, so this is the build that deploys.

```bash
npm run build --workspace=apps/portal
```

Expected: exits 0, and the output lists a separate chunk that contains Recharts (it must not be inside the portal's entry chunk).

- [ ] **Step 3: Manual check** (`npm run dev` in `apps/payment-reconciliation`, or the deployed portal)

- The KPIs tab appears after "Análisis General".
- The chart shows two lines per year; the current year's label ends in `*`.
- The table shows the same years, with "(parcial)" on the current year.
- Changing the period filter in the other tabs does not change the KPIs.
- In DevTools → Network, the Recharts chunk downloads only when the KPIs tab is opened.

- [ ] **Step 4: Push** (this deploys)

```bash
git push
git log origin/main..main --oneline
```

Expected: the second command prints nothing.
