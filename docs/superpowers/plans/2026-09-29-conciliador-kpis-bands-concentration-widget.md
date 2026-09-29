# KPIs: Delinquency Bands, Concentration and DPD Widget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add delinquency bands and concentration to the KPIs tab, and publish the yearly DPD chart as a Dashboard widget.

**Architecture:**
- One shared universe of due invoices, `collectDueInvoices`, feeds every metric.
- New pure metrics live in `metrics/delinquencyBreakdown.ts`.
- The invoice↔payment matching moves out of `App.tsx` into a pure `reconcileInvoices`, so the widget and the app compute identical rows.
- The DPD chart becomes its own file, reused by the tab and the widget. Recharts stays lazy-loaded in both.

**Tech Stack:** React 19, TypeScript 5.9 (`noUnusedLocals`), Vitest 2 + jsdom + RTL, Tailwind 4, Recharts 3.10.

**Spec:** `docs/superpowers/specs/2026-09-29-conciliador-kpis-bands-concentration-widget-design.md`

**Conventions:**
- Run vitest/tsc/eslint from `apps/payment-reconciliation`. Run the portal build from the repo root.
- Commits: conventional, with no AI attribution lines. `git add` explicit paths only. The unrelated working-tree changes (`.gitignore`, `.atl/`, `apps/WO-sales/prompts/`, `img/`, `openspec/`) must never be staged.
- Never edit with PowerShell `Set-Content`. Pushing to `main` deploys; only Task 8 pushes.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/reconcile.ts` | Create | `reconcileInvoices(invoices, payments, now)`, `formatExcelDate`, `INTERNAL_CLIENT`. |
| `src/reconcile.test.ts` | Create | Tests for the above. |
| `src/App.tsx` | Modify | Uses `reconcileInvoices` and `formatExcelDate`; local copies removed. |
| `src/metrics/yearlyTrendMetrics.ts` | Modify | `EXCLUDED_YEARS`, `DueInvoice`, `collectDueInvoices`; `computeYearlyTrend` built on it. |
| `src/metrics/yearlyTrendMetrics.test.ts` | Modify | Tests for `collectDueInvoices` and the 2020 exclusion. |
| `src/metrics/delinquencyBreakdown.ts` | Create | `computeDelinquencyBands`, `bandShares`, `BAND_KEYS`, `computeDelinquencyConcentration`. |
| `src/metrics/delinquencyBreakdown.test.ts` | Create | Tests. |
| `src/DpdByYearChart.tsx` | Create | The DPD bar chart (Recharts), filling its parent. |
| `src/YearlyTrendCharts.tsx` | Modify | Uses `DpdByYearChart`; adds the bands chart. |
| `src/KpisTab.tsx` | Modify | Passes bands; concentration table; extended notes; drops its local 2020 filter. |
| `src/KpisTab.test.tsx` | Modify | Tests for the concentration table and the notes. |
| `src/widgets/DpdTrendWidget.tsx` | Create | Dashboard widget. |
| `src/widgets/DpdTrendWidget.test.tsx` | Create | Widget tests. |
| `src/widgets/index.ts` | Modify | Registers the widget. |

(All paths are relative to `apps/payment-reconciliation/`.)

---

### Task 1: Extract `reconcileInvoices` from App.tsx

**Files:** Create `src/reconcile.ts`, `src/reconcile.test.ts`; Modify `src/App.tsx`.

- [ ] **Step 1: Write the failing test** — `src/reconcile.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { InvoiceDetails, PaymentRecord } from './types';
import { reconcileInvoices, formatExcelDate, INTERNAL_CLIENT } from './reconcile';

function invoice(over: Partial<InvoiceDetails> = {}): InvoiceDetails {
  return {
    invoiceNumber: 'AM100', orderNumber: '', clientName: 'ACME',
    invoiceDate: '2026-09-01', dueDate: '2026-09-15', status: 'sent',
    total: 1000, balance: 0,
    ...over,
  };
}

function payment(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    paymentNumber: 'P1', clientName: 'ACME', invoiceNumber: 'AM100',
    paymentDate: '2026-09-10', amountFCY: 1000, unusedFCY: 0, amountBCY: 1000, unusedBCY: 0,
    ...over,
  };
}

const NOW = new Date(2026, 8, 29); // 29 Sep 2026

describe('formatExcelDate', () => {
  it('formats as dd/mm/yyyy and returns empty for unreadable values', () => {
    expect(formatExcelDate('2026-09-05')).toBe('05/09/2026');
    expect(formatExcelDate(new Date(2026, 0, 2))).toBe('02/01/2026');
    expect(formatExcelDate(null)).toBe('');
    expect(formatExcelDate('no es fecha')).toBe('');
  });
});

describe('reconcileInvoices', () => {
  it('excludes the internal client', () => {
    const rows = reconcileInvoices([invoice(), invoice({ clientName: INTERNAL_CLIENT })], [], NOW);
    expect(rows.map((r) => r.clientName)).toEqual(['ACME']);
  });

  it('matches payments by invoice number ignoring case and spaces', () => {
    const [row] = reconcileInvoices([invoice()], [payment({ invoiceNumber: ' am100 ' })], NOW);
    expect(row.paymentDetails).toHaveLength(1);
    expect(row.totalPaid).toBe(1000);
    expect(row.paymentAmounts).toEqual([1000]);
  });

  it('gives an on-time payment a delay of 0 and a late one its days', () => {
    const [row] = reconcileInvoices(
      [invoice()],
      [payment({ paymentDate: '2026-09-10' }), payment({ paymentNumber: 'P2', paymentDate: '2026-09-20' })],
      NOW,
    );
    expect(row.paymentDetails).toEqual([
      { date: '10/09/2026', delay: 0 },
      { date: '20/09/2026', delay: 5 },
    ]);
    expect(row.paymentDates).toEqual(['10/09/2026', '20/09/2026']);
    expect(row.isOverdue).toBe(true);
    expect(row.maxDelayDays).toBe(5);
  });

  it('ages an unpaid overdue balance up to now', () => {
    const [row] = reconcileInvoices([invoice({ balance: 1000 })], [], NOW);
    expect(row.isOverdue).toBe(true);
    expect(row.maxDelayDays).toBe(14);
    expect(row.paymentDetails).toEqual([]);
  });

  it('does not flag an invoice that is paid on time and has no balance', () => {
    const [row] = reconcileInvoices([invoice()], [payment()], NOW);
    expect(row.isOverdue).toBe(false);
    expect(row.maxDelayDays).toBe(0);
  });

  it('keeps every invoice field', () => {
    const [row] = reconcileInvoices([invoice({ status: 'partially_paid' })], [], NOW);
    expect(row.status).toBe('partially_paid');
    expect(row.invoiceNumber).toBe('AM100');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/reconcile.test.ts` → FAIL: `Failed to resolve import "./reconcile"`.

- [ ] **Step 3: Implement** — `src/reconcile.ts`

This is the logic from `App.tsx` lines 219-283, unchanged except for two things: `now` is injected, and payments are indexed once instead of filtered per invoice.

```ts
import type { InvoiceDetails, PaymentRecord, ReconciledRow } from './types';
import { parseExcelDate } from './customerAnalysisUtils';

// Invoice ↔ payment matching shared by the app and the Dashboard widgets, so
// both compute identical rows.

/** Internal movements, excluded from every analysis. */
export const INTERNAL_CLIENT = 'Ambientalia S.A.S.';

const DAY_MS = 1000 * 60 * 60 * 24;

const invoiceKey = (value: string) => value.trim().toUpperCase();

/** dd/mm/yyyy, or '' when the value is not a readable date. */
export function formatExcelDate(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : parseExcelDate(value);
  if (!date || isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

export function reconcileInvoices(
  invoices: InvoiceDetails[],
  payments: PaymentRecord[],
  now: Date = new Date(),
): ReconciledRow[] {
  const paymentsByInvoice = new Map<string, PaymentRecord[]>();
  for (const p of payments) {
    const key = invoiceKey(p.invoiceNumber);
    const list = paymentsByInvoice.get(key);
    if (list) list.push(p);
    else paymentsByInvoice.set(key, [p]);
  }

  return invoices
    .filter((invoice) => invoice.clientName !== INTERNAL_CLIENT)
    .map((invoice) => {
      const matchingPayments = paymentsByInvoice.get(invoiceKey(invoice.invoiceNumber)) ?? [];
      const dueDate = invoice.dueDate instanceof Date ? invoice.dueDate : parseExcelDate(invoice.dueDate);

      let isOverdue = false;
      let maxDelayDays = 0;

      const paymentDetails = matchingPayments.map((p) => {
        const pDate = p.paymentDate instanceof Date ? p.paymentDate : parseExcelDate(p.paymentDate);
        let delay = 0;
        if (pDate && dueDate && pDate > dueDate) {
          isOverdue = true;
          delay = Math.ceil(Math.abs(pDate.getTime() - dueDate.getTime()) / DAY_MS);
          if (delay > maxDelayDays) maxDelayDays = delay;
        }
        return { date: formatExcelDate(pDate), delay };
      });

      // An outstanding balance past its due date keeps aging, with or without payments.
      if (dueDate && now > dueDate && invoice.balance > 0) {
        isOverdue = true;
        const currentDelay = Math.ceil(Math.abs(now.getTime() - dueDate.getTime()) / DAY_MS);
        if (currentDelay > maxDelayDays) maxDelayDays = currentDelay;
      }

      return {
        ...invoice,
        paymentDates: paymentDetails.map((pd) => pd.date),
        paymentAmounts: matchingPayments.map((p) => p.amountFCY),
        totalPaid: matchingPayments.reduce((sum, p) => sum + p.amountFCY, 0),
        isOverdue,
        maxDelayDays,
        paymentDetails,
      };
    });
}
```

- [ ] **Step 4: Run** `npx vitest run src/reconcile.test.ts` → PASS (7 tests).

- [ ] **Step 5: Use it in App.tsx**

1. Add this import below the `customerAnalysisUtils` import:

```ts
import { reconcileInvoices, formatExcelDate } from './reconcile';
```

2. Delete App's local `const formatExcelDate = (date: Date | null | any) => { … };` block (about 12 lines, starting near line 206). Its uses elsewhere in App now resolve to the import.

3. Replace the whole `const reconcile = React.useCallback(() => { … }, [invoices, payments]);` block and the `React.useEffect(() => { if (invoices.length > 0) reconcile(); }, [reconcile]);` that follows it with:

```ts
  React.useEffect(() => {
    if (invoices.length > 0) setReconciledData(reconcileInvoices(invoices, payments));
  }, [invoices, payments]);
```

4. `grep -n "reconcile()\|formatExcelDate = " src/App.tsx` must print nothing.

- [ ] **Step 6: Verify** `npx tsc -b && npx vitest run` → tsc exit 0, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/payment-reconciliation/src/reconcile.ts apps/payment-reconciliation/src/reconcile.test.ts apps/payment-reconciliation/src/App.tsx
git commit -m "refactor(payment-reconciliation): el cruce de facturas y pagos sale de App a una funcion pura"
```

---

### Task 2: Shared universe `collectDueInvoices` (and 2020 exclusion in the metric)

**Files:** Modify `src/metrics/yearlyTrendMetrics.ts`, `src/metrics/yearlyTrendMetrics.test.ts`, `src/KpisTab.tsx`.

- [ ] **Step 1: Write the failing tests** — append to `src/metrics/yearlyTrendMetrics.test.ts` (reuse the file's `row`, `paidWithDelay` and `TODAY` helpers). Add `collectDueInvoices` and `EXCLUDED_YEARS` to its import from `./yearlyTrendMetrics`.

```ts
describe('collectDueInvoices', () => {
  it('returns year, DPD and value for each due invoice', () => {
    const due = collectDueInvoices(
      [row({ invoiceNumber: 'A', dueDate: '10 mar 2025', total: 100, paymentDetails: paidWithDelay(10) })],
      TODAY,
    );
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ year: 2025, dpd: 10, value: 100 });
    expect(due[0].row.invoiceNumber).toBe('A');
  });

  it('applies the same exclusions as the yearly trend', () => {
    const due = collectDueInvoices(
      [
        row({ dueDate: '15 oct 2026', total: 1, balance: 1 }), // not due yet
        row({ dueDate: null }), // unreadable
        row({ dueDate: '1 feb 2025', status: 'void' }),
        row({ dueDate: '1 feb 2025', status: 'draft' }),
        row({ dueDate: '10 mar 2020', paymentDetails: paidWithDelay(3) }), // excluded year
      ],
      TODAY,
    );
    expect(due).toEqual([]);
  });
});

describe('excluded years', () => {
  it('leaves 2020 out of the yearly trend', () => {
    expect(EXCLUDED_YEARS).toContain(2020);
    const result = computeYearlyTrend(
      [row({ dueDate: '10 mar 2020', total: 10 }), row({ dueDate: '10 mar 2021', total: 10 })],
      TODAY,
    );
    expect(result.map((r) => r.year)).toEqual([2021]);
  });
});
```

- [ ] **Step 2: Run and confirm it fails:** `npx vitest run src/metrics/yearlyTrendMetrics.test.ts` → FAIL, because `collectDueInvoices` and `EXCLUDED_YEARS` are not exported.

- [ ] **Step 3: Implement.** Replace the part of `src/metrics/yearlyTrendMetrics.ts` from `interface YearAccumulator` to the end of the file with the code below. Keep the header doc comment and `YearlyTrendRow`, and add this bullet to the doc comment: `- Years in EXCLUDED_YEARS (incomplete history) are left out.`

```ts
/** Years with incomplete invoice history; comparing them with full years would distort the trend. */
export const EXCLUDED_YEARS: readonly number[] = [2020];

/** One invoice of the shared KPI universe, with its due-date year, DPD and weight. */
export interface DueInvoice {
  row: ReconciledRow;
  year: number;
  dpd: number;
  value: number;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * The invoices every KPI is computed on: due strictly before `today`, not void
 * or draft, not in an excluded year. DPD is measured at the start of `today`.
 */
export function collectDueInvoices(rows: ReconciledRow[], today: Date): DueInvoice[] {
  const cutoff = startOfDay(today);
  const result: DueInvoice[] = [];

  for (const row of rows) {
    const status = (row.status ?? '').trim().toLowerCase();
    if (status === 'void' || status === 'draft') continue;

    const due = row.dueDate instanceof Date ? row.dueDate : parseExcelDate(row.dueDate);
    if (!due || startOfDay(due) >= cutoff) continue;

    const year = due.getFullYear();
    if (EXCLUDED_YEARS.includes(year)) continue;

    const raw = calculateInvoiceDPD(row, cutoff);
    const dpd = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    const value = Number.isFinite(row.total) && row.total > 0 ? row.total : 0;
    result.push({ row, year, dpd, value });
  }

  return result;
}

interface YearAccumulator {
  count: number;
  dpdSum: number;
  weightedSum: number;
  valueSum: number;
  onTime: number;
}

export function computeYearlyTrend(rows: ReconciledRow[], today: Date): YearlyTrendRow[] {
  const byYear = new Map<number, YearAccumulator>();

  for (const { year, dpd, value } of collectDueInvoices(rows, today)) {
    const acc = byYear.get(year) ?? { count: 0, dpdSum: 0, weightedSum: 0, valueSum: 0, onTime: 0 };
    acc.count += 1;
    acc.dpdSum += dpd;
    acc.weightedSum += dpd * value;
    acc.valueSum += value;
    if (dpd === 0) acc.onTime += 1;
    byYear.set(year, acc);
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

- [ ] **Step 4: Remove KpisTab's local filter.** In `src/KpisTab.tsx`, delete the `EXCLUDED_YEARS` constant and its 2-line comment. Change the memo back to:

```ts
  const rows = useMemo(
    () => computeYearlyTrend(reconciledData, today ?? new Date()),
    [reconciledData, today],
  );
```

- [ ] **Step 5: Verify** `npx tsc -b && npx vitest run`. All tests pass, including the existing KpisTab 2020 tests, which now pass through the metric.

- [ ] **Step 6: Commit**

```bash
git add apps/payment-reconciliation/src/metrics/yearlyTrendMetrics.ts apps/payment-reconciliation/src/metrics/yearlyTrendMetrics.test.ts apps/payment-reconciliation/src/KpisTab.tsx
git commit -m "refactor(payment-reconciliation): universo comun de facturas vencidas para los KPIs"
```

---

### Task 3: Delinquency bands metric

**Files:** Create `src/metrics/delinquencyBreakdown.ts`, `src/metrics/delinquencyBreakdown.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/metrics/delinquencyBreakdown.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { ReconciledRow } from '../types';
import { computeDelinquencyBands, bandShares, BAND_KEYS } from './delinquencyBreakdown';

function row(over: Partial<ReconciledRow> = {}): ReconciledRow {
  return {
    invoiceNumber: 'INV', orderNumber: 'OC', clientName: 'ACME',
    invoiceDate: '1 ene 2025', dueDate: '1 ene 2025', status: 'paid',
    total: 100, balance: 0,
    paymentDates: [], paymentAmounts: [], totalPaid: 0,
    isOverdue: false, maxDelayDays: 0, paymentDetails: [],
    ...over,
  };
}

const late = (delay: number, over: Partial<ReconciledRow> = {}) =>
  row({ dueDate: '10 mar 2025', paymentDetails: [{ date: 'x', delay }], ...over });

const TODAY = new Date(2026, 8, 29);

describe('computeDelinquencyBands', () => {
  it('puts each DPD into its band, with the right boundaries', () => {
    const [y] = computeDelinquencyBands(
      [0, 1, 15, 16, 30, 31, 60, 61, 200].map((d) => late(d)),
      TODAY,
    );
    expect(y).toMatchObject({
      year: 2025, total: 9,
      onTime: 1, d1_15: 2, d16_30: 2, d31_60: 2, over60: 2,
      isPartialYear: false,
    });
  });

  it('groups by due-date year, sorts ascending and flags the current year', () => {
    const result = computeDelinquencyBands(
      [late(0, { dueDate: '5 ene 2026' }), late(0), late(20)],
      TODAY,
    );
    expect(result.map((r) => [r.year, r.total, r.isPartialYear])).toEqual([
      [2025, 2, false],
      [2026, 1, true],
    ]);
  });

  it('uses the shared universe (void, not-yet-due and 2020 are excluded)', () => {
    const result = computeDelinquencyBands(
      [
        late(5, { status: 'void' }),
        late(5, { dueDate: '15 oct 2026', balance: 10 }),
        late(5, { dueDate: '10 mar 2020' }),
      ],
      TODAY,
    );
    expect(result).toEqual([]);
  });
});

describe('bandShares', () => {
  it('turns counts into percentages that add up to 100', () => {
    const [y] = computeDelinquencyBands([late(0), late(0), late(10), late(90)], TODAY);
    const shares = bandShares(y);
    expect(shares).toEqual({ onTime: 50, d1_15: 25, d16_30: 0, d31_60: 0, over60: 25 });
    expect(BAND_KEYS.reduce((s, k) => s + shares[k], 0)).toBe(100);
  });

  it('returns zeros for an empty year', () => {
    expect(bandShares({ year: 2025, total: 0, onTime: 0, d1_15: 0, d16_30: 0, d31_60: 0, over60: 0, isPartialYear: false }))
      .toEqual({ onTime: 0, d1_15: 0, d16_30: 0, d31_60: 0, over60: 0 });
  });
});
```

- [ ] **Step 2: Run and confirm it fails:** `npx vitest run src/metrics/delinquencyBreakdown.test.ts` → FAIL, because the import cannot be resolved.

- [ ] **Step 3: Implement** — `src/metrics/delinquencyBreakdown.ts`

```ts
import type { ReconciledRow } from '../types';
import { collectDueInvoices } from './yearlyTrendMetrics';

// Breakdowns that explain the yearly DPD trend. Both use the shared universe of
// collectDueInvoices, so they always agree with the trend itself.

export const BAND_KEYS = ['onTime', 'd1_15', 'd16_30', 'd31_60', 'over60'] as const;
export type BandKey = (typeof BAND_KEYS)[number];

export interface DelinquencyBandRow extends Record<BandKey, number> {
  year: number;
  total: number;
  isPartialYear: boolean;
}

const bandOf = (dpd: number): BandKey => {
  if (dpd <= 0) return 'onTime';
  if (dpd <= 15) return 'd1_15';
  if (dpd <= 30) return 'd16_30';
  if (dpd <= 60) return 'd31_60';
  return 'over60';
};

/** Invoice count per delinquency band, per due-date year (ascending). */
export function computeDelinquencyBands(rows: ReconciledRow[], today: Date): DelinquencyBandRow[] {
  const byYear = new Map<number, DelinquencyBandRow>();
  for (const { year, dpd } of collectDueInvoices(rows, today)) {
    const acc = byYear.get(year) ?? {
      year, total: 0, onTime: 0, d1_15: 0, d16_30: 0, d31_60: 0, over60: 0,
      isPartialYear: year === today.getFullYear(),
    };
    acc.total += 1;
    acc[bandOf(dpd)] += 1;
    byYear.set(year, acc);
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/** Share (%) of the year's invoices in each band; zeros when the year is empty. */
export function bandShares(row: DelinquencyBandRow): Record<BandKey, number> {
  const share = (n: number) => (row.total > 0 ? (n / row.total) * 100 : 0);
  return {
    onTime: share(row.onTime),
    d1_15: share(row.d1_15),
    d16_30: share(row.d16_30),
    d31_60: share(row.d31_60),
    over60: share(row.over60),
  };
}
```

- [ ] **Step 4: Run** `npx vitest run src/metrics/delinquencyBreakdown.test.ts` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/metrics/delinquencyBreakdown.ts apps/payment-reconciliation/src/metrics/delinquencyBreakdown.test.ts
git commit -m "feat(payment-reconciliation): metrica de facturas por tramo de mora y por ano"
```

---

### Task 4: Concentration metric

**Files:** Modify `src/metrics/delinquencyBreakdown.ts`, `src/metrics/delinquencyBreakdown.test.ts`.

Reference dataset for 2025 (each invoice paid with the given delay):

| Client | Value | DPD | Weighted |
|---|---|---|---|
| A | 1000 | 30 | 30000 |
| B | 500 | 10 | 5000 |
| D | 1000 | 5 | 5000 |
| C | 100 | 0 | 0 |

Total: 40000. Shares: A 75 %, B 12.5 %, D 12.5 %. Cumulative: 75 % < 80 %, then 87.5 % ≥ 80 %, so `clientsFor80` = 2. Clients with delinquency: 3; total clients: 4. The top 3 are A, B and D; B and D tie, so the name breaks the tie.

- [ ] **Step 1: Write the failing test.** Append to `src/metrics/delinquencyBreakdown.test.ts` and add `computeDelinquencyConcentration` to its import.

```ts
describe('computeDelinquencyConcentration', () => {
  const inv = (clientName: string, total: number, delay: number, over: Partial<ReconciledRow> = {}) =>
    late(delay, { clientName, total, ...over });

  it('finds the fewest clients that add up to 80% of the weighted delinquency', () => {
    const [y] = computeDelinquencyConcentration(
      [inv('D', 1000, 5), inv('C', 100, 0), inv('B', 500, 10), inv('A', 1000, 30)],
      TODAY,
    );
    expect(y.year).toBe(2025);
    expect(y.totalClients).toBe(4);
    expect(y.clientsWithDelinquency).toBe(3);
    expect(y.clientsFor80).toBe(2);
    expect(y.topClients.map((c) => c.name)).toEqual(['A', 'B', 'D']);
    expect(y.topClients[0].share).toBeCloseTo(75, 5);
    expect(y.topClients[1].share).toBeCloseTo(12.5, 5);
  });

  it('adds up all invoices of the same client', () => {
    const [y] = computeDelinquencyConcentration(
      [inv('A', 100, 10), inv('A', 100, 10), inv('B', 100, 10)],
      TODAY,
    );
    expect(y.totalClients).toBe(2);
    expect(y.topClients[0]).toEqual({ name: 'A', share: expect.closeTo(200 / 3, 5) });
  });

  it('reports no concentration for a year without delinquency', () => {
    const [y] = computeDelinquencyConcentration([inv('A', 100, 0), inv('B', 100, 0)], TODAY);
    expect(y).toMatchObject({ totalClients: 2, clientsWithDelinquency: 0, clientsFor80: 0, topClients: [] });
  });

  it('names a blank client "Sin cliente"', () => {
    const [y] = computeDelinquencyConcentration([inv('  ', 100, 10)], TODAY);
    expect(y.topClients[0].name).toBe('Sin cliente');
  });

  it('flags the current year and sorts years ascending', () => {
    const result = computeDelinquencyConcentration(
      [inv('A', 100, 10, { dueDate: '5 ene 2026' }), inv('A', 100, 10)],
      TODAY,
    );
    expect(result.map((r) => [r.year, r.isPartialYear])).toEqual([[2025, false], [2026, true]]);
  });
});
```

- [ ] **Step 2: Run and confirm it fails:** the tests fail because `computeDelinquencyConcentration` is not exported.

- [ ] **Step 3: Implement.** Append to `src/metrics/delinquencyBreakdown.ts`:

```ts
export interface ClientShare {
  name: string;
  share: number; // % of the year's weighted delinquency
}

export interface ConcentrationRow {
  year: number;
  isPartialYear: boolean;
  totalClients: number;
  clientsWithDelinquency: number;
  /** Fewest clients whose weighted delinquency reaches 80% of the year's total. */
  clientsFor80: number;
  topClients: ClientShare[];
}

const CONCENTRATION_THRESHOLD = 0.8;
const TOP_CLIENTS = 3;

/**
 * How concentrated each year's delinquency is. A client's weight is
 * Σ (DPD × value) of its due invoices in that year.
 */
export function computeDelinquencyConcentration(rows: ReconciledRow[], today: Date): ConcentrationRow[] {
  const byYear = new Map<number, Map<string, number>>();
  for (const { row, year, dpd, value } of collectDueInvoices(rows, today)) {
    const name = (row.clientName ?? '').trim() || 'Sin cliente';
    const clients = byYear.get(year) ?? new Map<string, number>();
    clients.set(name, (clients.get(name) ?? 0) + dpd * value);
    byYear.set(year, clients);
  }

  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, clients]) => {
      const ranked = [...clients.entries()]
        .filter(([, weight]) => weight > 0)
        .sort(([nameA, a], [nameB, b]) => b - a || nameA.localeCompare(nameB, 'es'));
      const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);

      let clientsFor80 = 0;
      let cumulative = 0;
      for (const [, weight] of ranked) {
        if (total === 0 || cumulative >= total * CONCENTRATION_THRESHOLD) break;
        cumulative += weight;
        clientsFor80 += 1;
      }

      return {
        year,
        isPartialYear: year === today.getFullYear(),
        totalClients: clients.size,
        clientsWithDelinquency: ranked.length,
        clientsFor80,
        topClients: ranked.slice(0, TOP_CLIENTS).map(([name, weight]) => ({ name, share: (weight / total) * 100 })),
      };
    });
}
```

- [ ] **Step 4: Run** `npx vitest run src/metrics/delinquencyBreakdown.test.ts` → PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/metrics/delinquencyBreakdown.ts apps/payment-reconciliation/src/metrics/delinquencyBreakdown.test.ts
git commit -m "feat(payment-reconciliation): metrica de concentracion de la mora por cliente"
```

---

### Task 5: Split the DPD chart and add the bands chart

**Files:** Create `src/DpdByYearChart.tsx`; Modify `src/YearlyTrendCharts.tsx`.

There are no unit tests here: Recharts needs real layout. This task is covered by `tsc`, the portal build (Task 8) and the component tests that mock these files.

- [ ] **Step 1: Create** `src/DpdByYearChart.tsx`

```tsx
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { YearlyTrendRow } from './metrics/yearlyTrendMetrics';

// The yearly DPD bar chart (simple vs value-weighted). Fills its parent, which
// must have a height. Shared by the KPIs tab and the Dashboard widget; always
// load it lazily so Recharts stays out of eager chunks.

const oneDecimal = (n: number) =>
  n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

export default function DpdByYearChart({ rows }: { rows: YearlyTrendRow[] }) {
  const data = rows.map((r) => ({ ...r, label: r.isPartialYear ? `${r.year}*` : String(r.year) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="label" stroke="#64748b" />
        <YAxis stroke="#64748b" allowDecimals={false} />
        <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => `${oneDecimal(Number(v))} días`} />
        <Legend />
        <Bar dataKey="averageDPD" name="DPD promedio" fill="#4f46e5" radius={BAR_RADIUS} maxBarSize={48} />
        <Bar dataKey="weightedDPD" name="DPD ponderado por valor" fill="#dc2626" radius={BAR_RADIUS} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Replace** `src/YearlyTrendCharts.tsx` entirely with:

```tsx
import type React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { YearlyTrendRow } from './metrics/yearlyTrendMetrics';
import { BAND_KEYS, bandShares } from './metrics/delinquencyBreakdown';
import type { BandKey, DelinquencyBandRow } from './metrics/delinquencyBreakdown';
import DpdByYearChart from './DpdByYearChart';

const oneDecimal = (n: number) =>
  n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

const BAND_SERIES: Record<BandKey, { name: string; color: string }> = {
  onTime: { name: 'A tiempo', color: '#059669' },
  d1_15: { name: '1–15 días', color: '#facc15' },
  d16_30: { name: '16–30 días', color: '#f97316' },
  d31_60: { name: '31–60 días', color: '#dc2626' },
  over60: { name: 'Más de 60 días', color: '#7f1d1d' },
};

const yearLabel = (year: number, isPartialYear: boolean) => (isPartialYear ? `${year}*` : String(year));

function ChartCard({ title, className = '', children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-soft p-6 ${className}`}>
      <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-4">{title}</h3>
      <div className="h-72">{children}</div>
    </div>
  );
}

// Loaded with React.lazy from KpisTab: Recharts is downloaded only when the tab opens.
export default function YearlyTrendCharts({ rows, bands }: { rows: YearlyTrendRow[]; bands: DelinquencyBandRow[] }) {
  const onTimeData = rows.map((r) => ({ ...r, label: yearLabel(r.year, r.isPartialYear) }));
  // Each band carries its share (for the stacked bar) and its count (for the tooltip).
  const bandData = bands.map((b) => {
    const shares = bandShares(b);
    const entry: Record<string, number | string> = { label: yearLabel(b.year, b.isPartialYear) };
    for (const key of BAND_KEYS) {
      entry[key] = shares[key];
      entry[`${key}Count`] = b[key];
    }
    return entry;
  });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <ChartCard title="DPD promedio por año (días)">
        <DpdByYearChart rows={rows} />
      </ChartCard>

      <ChartCard title="% de facturas pagadas a tiempo">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={onTimeData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" stroke="#64748b" />
            <YAxis stroke="#64748b" domain={[0, 100]} unit="%" />
            <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => `${oneDecimal(Number(v))} %`} />
            <Legend />
            <Bar dataKey="onTimePercentage" name="% a tiempo" fill="#059669" radius={BAR_RADIUS} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Facturas por tramo de mora (%)" className="xl:col-span-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bandData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" stroke="#64748b" />
            <YAxis stroke="#64748b" domain={[0, 100]} unit="%" />
            <Tooltip
              cursor={{ fill: '#f1f5f9' }}
              formatter={(v, _name, item) => {
                const count = (item?.payload as Record<string, unknown> | undefined)?.[`${String(item?.dataKey)}Count`];
                return `${oneDecimal(Number(v))} % (${String(count ?? 0)} facturas)`;
              }}
            />
            <Legend />
            {BAND_KEYS.map((key) => (
              <Bar key={key} dataKey={key} stackId="bands" name={BAND_SERIES[key].name} fill={BAND_SERIES[key].color} maxBarSize={64} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck.** Run `npx tsc -b`. It is expected to FAIL only in `KpisTab.tsx`, because the `bands` prop is missing; Task 6 fixes that. If the Tooltip `formatter` typing rejects `item`, adjust the parameter types minimally without using `any`, and report it. Any other error must be fixed here.

- [ ] **Step 4: Commit** (the tree typechecks again after Task 6; commit now anyway, to keep the diff reviewable)

```bash
git add apps/payment-reconciliation/src/DpdByYearChart.tsx apps/payment-reconciliation/src/YearlyTrendCharts.tsx
git commit -m "feat(payment-reconciliation): grafico de tramos de mora y grafico de DPD reutilizable"
```

---

### Task 6: KpisTab — bands, concentration table, notes

**Files:** Modify `src/KpisTab.tsx`, `src/KpisTab.test.tsx`.

- [ ] **Step 1: Write the failing tests.** Append inside the `describe('KpisTab', …)` block of `src/KpisTab.test.tsx`:

```tsx
  it('shows the concentration of delinquency per year', () => {
    render(
      <KpisTab
        reconciledData={[
          row({ clientName: 'Cliente A', dueDate: '10 mar 2025', total: 1000, paymentDetails: [{ date: 'x', delay: 30 }] }),
          row({ clientName: 'Cliente B', dueDate: '10 mar 2025', total: 100, paymentDetails: [{ date: 'x', delay: 0 }] }),
        ]}
        today={TODAY}
      />,
    );
    const table = screen.getByRole('table', { name: 'Concentración de la mora por año' });
    expect(table).toHaveTextContent('Cliente A (100,0 %)');
    expect(table).toHaveTextContent('2025');
  });

  it('explains the bands and the concentration in the notes', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '10 mar 2025' })]} today={TODAY} />);
    const help = screen.getByRole('region', { name: '¿Cómo se calculan estos indicadores?' });
    expect(help).toHaveTextContent('Tramos de mora');
    expect(help).toHaveTextContent('80 %');
  });
```

Now that the concentration table also lists the years, the existing tests that look up year text will match twice. That affects `getByText('2025')`, `getByText('2026 (parcial)')`, `getByText('2021')` and `queryByText('2020')`. Scope each of them to the yearly table with `within(screen.getByRole('table', { name: 'Tendencia anual de mora por año de vencimiento' }))`, and import `within` from `@testing-library/react`. This changes the scope only; keep every assertion. For `queryByText('2020')`, also assert it is absent from the concentration table.

- [ ] **Step 2: Run and confirm the new tests fail:** `npx vitest run src/KpisTab.test.tsx`.

- [ ] **Step 3: Implement in `src/KpisTab.tsx`:**

1. Imports:

```ts
import { computeDelinquencyBands, computeDelinquencyConcentration } from './metrics/delinquencyBreakdown';
```

2. After the `rows` memo:

```ts
  const bands = useMemo(
    () => computeDelinquencyBands(reconciledData, today ?? new Date()),
    [reconciledData, today],
  );
  const concentration = useMemo(
    () => computeDelinquencyConcentration(reconciledData, today ?? new Date()),
    [reconciledData, today],
  );
```

3. Render the charts with `<YearlyTrendCharts rows={rows} bands={bands} />`.

4. Between the yearly table's closing `</div>` and `<CalculationNotes />`, add `<ConcentrationTable rows={concentration} />`. Define this component above `KpisTab`; it reuses the file's `oneDecimal`:

```tsx
function ConcentrationTable({ rows }: { rows: ConcentrationRow[] }) {
  const th = 'px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider';
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
      <h3 className="px-6 pt-6 text-sm font-bold text-slate-600 uppercase tracking-wider">Concentración de la mora</h3>
      <table className="w-full text-left border-collapse mt-4">
        <caption className="sr-only">Concentración de la mora por año</caption>
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th scope="col" className={th}>Año</th>
            <th scope="col" className={`${th} text-right`}>Clientes</th>
            <th scope="col" className={`${th} text-right`}>Con mora</th>
            <th scope="col" className={`${th} text-right`}>Suman el 80 %</th>
            <th scope="col" className={th}>Principales</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.year}>
              <td className="px-6 py-4 font-medium text-slate-900">{r.isPartialYear ? `${r.year} (parcial)` : r.year}</td>
              <td className="px-6 py-4 text-right text-slate-600">{r.totalClients}</td>
              <td className="px-6 py-4 text-right text-slate-600">{r.clientsWithDelinquency}</td>
              <td className="px-6 py-4 text-right text-slate-900 font-semibold">{r.clientsFor80 || '—'}</td>
              <td className="px-6 py-4 text-slate-600">
                {r.topClients.length === 0
                  ? '—'
                  : r.topClients.map((c) => `${c.name} (${oneDecimal(c.share)} %)`).join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Add `import type { ConcentrationRow } from './metrics/delinquencyBreakdown';`.

5. In `CalculationNotes`, add these two paragraphs right before the "Ejemplo" paragraph:

```tsx
        <p>
          <strong className="text-slate-800">Tramos de mora</strong>: qué parte de las facturas de cada año se pagó
          a tiempo, con 1–15, 16–30, 31–60 o más de 60 días de mora. Muestra si la mora sube por muchos retrasos
          pequeños o por pocos retrasos graves.
        </p>
        <p>
          <strong className="text-slate-800">Concentración de la mora</strong>: la mora de un cliente es Σ (DPD ×
          valor) de sus facturas del año. «Suman el 80 %» es el menor número de clientes cuya mora llega al 80 % de
          la mora total del año; si son pocos, la tendencia la arrastran unos pocos clientes.
        </p>
```

- [ ] **Step 4: Run** `npx vitest run && npx tsc -b && npx eslint src/KpisTab.tsx src/KpisTab.test.tsx src/YearlyTrendCharts.tsx src/DpdByYearChart.tsx` → everything green (tsc is green again now that `bands` is passed).

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/KpisTab.tsx apps/payment-reconciliation/src/KpisTab.test.tsx
git commit -m "feat(payment-reconciliation): KPIs con tramos de mora y concentracion por cliente"
```

---

### Task 7: Dashboard widget "Tendencia de Mora (DPD por año)"

**Files:** Create `src/widgets/DpdTrendWidget.tsx`, `src/widgets/DpdTrendWidget.test.tsx`; Modify `src/widgets/index.ts`.

The portal wraps each widget in its own `Suspense` + `WidgetErrorBoundary` (`apps/portal/src/components/WidgetCell.tsx`). A `React.lazy` chart inside the widget is therefore safe: a stale chunk only breaks this widget. `widgets/index.ts` imports widgets statically, so the chart MUST be lazy; otherwise Recharts would load whenever the dashboard loads this app's widgets.

- [ ] **Step 1: Write the failing test** — `src/widgets/DpdTrendWidget.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReconciliationData } from './useReconciliationData';
import DpdTrendWidget from './DpdTrendWidget';

const hook = vi.fn<() => ReconciliationData>();
vi.mock('./useReconciliationData', () => ({ useReconciliationData: () => hook() }));
vi.mock('../DpdByYearChart', () => ({
  default: ({ rows }: { rows: { year: number }[] }) => <div data-testid="dpd-chart">{rows.map((r) => r.year).join(',')}</div>,
}));

const state = (over: Partial<ReconciliationData>): ReconciliationData => ({
  invoices: [], payments: [], loading: false, error: null, reload: () => {}, ...over,
});

const invoice = (invoiceNumber: string, dueDate: string) => ({
  invoiceNumber, orderNumber: '', clientName: 'ACME', invoiceDate: dueDate, dueDate,
  status: 'paid', total: 100, balance: 0,
});

describe('DpdTrendWidget', () => {
  beforeEach(() => hook.mockReset());

  it('shows a loading message', () => {
    hook.mockReturnValue(state({ loading: true }));
    render(<DpdTrendWidget />);
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });

  it('shows the error', () => {
    hook.mockReturnValue(state({ error: 'No se pudieron cargar los datos de conciliación.' }));
    render(<DpdTrendWidget />);
    expect(screen.getByText('No se pudieron cargar los datos de conciliación.')).toBeInTheDocument();
  });

  it('shows an empty message when no invoice is due', () => {
    hook.mockReturnValue(state({ invoices: [] }));
    render(<DpdTrendWidget />);
    expect(screen.getByText('Sin facturas vencidas.')).toBeInTheDocument();
  });

  it('charts the due years, without 2020 and without the internal client', async () => {
    hook.mockReturnValue(state({
      invoices: [
        invoice('A1', '2020-03-10'),
        invoice('A2', '2023-03-10'),
        invoice('A3', '2024-03-10'),
        { ...invoice('A4', '2022-03-10'), clientName: 'Ambientalia S.A.S.' },
      ],
    }));
    render(<DpdTrendWidget />);
    expect(await screen.findByTestId('dpd-chart')).toHaveTextContent('2023,2024');
  });
});
```

- [ ] **Step 2: Run and confirm it fails:** `npx vitest run src/widgets/DpdTrendWidget.test.tsx` → FAIL, because the import cannot be resolved.

- [ ] **Step 3: Implement** — `src/widgets/DpdTrendWidget.tsx`

```tsx
import { lazy, useMemo } from 'react';
import { useReconciliationData } from './useReconciliationData';
import { reconcileInvoices } from '../reconcile';
import { computeYearlyTrend } from '../metrics/yearlyTrendMetrics';

// Widget: the KPIs tab's yearly DPD chart. Same reconciliation and same metric
// as the tab, so both always show the same numbers. The chart is lazy: the
// portal's per-widget Suspense/ErrorBoundary covers its loading and failures.

const DpdByYearChart = lazy(() => import('../DpdByYearChart'));

export default function DpdTrendWidget() {
  const { invoices, payments, loading, error } = useReconciliationData();
  const rows = useMemo(
    () => computeYearlyTrend(reconcileInvoices(invoices, payments), new Date()),
    [invoices, payments],
  );

  if (loading) return <StateMsg>Cargando…</StateMsg>;
  if (error) return <StateMsg tone="error">{error}</StateMsg>;
  if (rows.length === 0) return <StateMsg>Sin facturas vencidas.</StateMsg>;

  return (
    <div className="h-full min-h-[200px]">
      <DpdByYearChart rows={rows} />
    </div>
  );
}

function StateMsg({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div className={`h-full flex items-center justify-center text-sm ${tone === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
      {children}
    </div>
  );
}
```

The test renders the widget without a `Suspense` boundary. React 19 suspends at the root and resolves the mocked lazy module, so `findByTestId` waits for it. If React requires a boundary in the test, wrap the render in `<Suspense fallback={null}>` in the test only, and report it.

- [ ] **Step 4: Register** in `src/widgets/index.ts`: add `import DpdTrendWidget from './DpdTrendWidget';`, then append this entry to the array:

```ts
  {
    id: 'payment-reconciliation-dpd-trend',
    appId: 'payment-reconciliation',
    name: 'Tendencia de Mora (DPD por año)',
    description: 'DPD promedio y ponderado por valor de las facturas vencidas, por año de vencimiento.',
    defaultSize: { w: 6, h: 4 },
    component: DpdTrendWidget,
  },
```

- [ ] **Step 5: Run** `npx vitest run && npx tsc -b && npx eslint src/widgets` → green (0 errors).

- [ ] **Step 6: Commit**

```bash
git add apps/payment-reconciliation/src/widgets/DpdTrendWidget.tsx apps/payment-reconciliation/src/widgets/DpdTrendWidget.test.tsx apps/payment-reconciliation/src/widgets/index.ts
git commit -m "feat(payment-reconciliation): widget de tendencia de mora (DPD por ano) para el dashboard"
```

---

### Task 8: Final verification and delivery

- [ ] From `apps/payment-reconciliation`: `npx tsc -b` (exit 0), `npx vitest run` (all pass), `npx eslint src` (0 errors).
- [ ] From the repo root: `npm run build --workspace=apps/portal` (exit 0). Then confirm the string `recharts` appears only in lazily loaded chunks, never in `index-*.js` or in the chunk that contains `widgets/index`:

```bash
grep -l recharts apps/portal/dist/assets/*.js
```

- [ ] Manual check in the portal:
  - The KPIs tab shows 3 charts, the yearly table, the concentration table and the notes.
  - The dashboard catalog lists "Tendencia de Mora (DPD por año)".
  - Once added, the widget shows the same numbers as the tab.
- [ ] `git push`, then `git log origin/main..main --oneline` prints nothing.
