# KPIs: Aging, Value On Time, DSO, Worsening Clients — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add to the KPIs tab four indicators: receivables aging (a snapshot of today), % of value collected on time, DSO per year, and the clients whose DPD worsened.

**Architecture:**
- `reconcileInvoices` gains `lastPaymentDate`.
- The shared universe (`collectDueInvoices`) gains `collectionDays`.
- Three pure metrics are added: aging, overdue balance per client, and worsening clients. They share a `clientIdentity` helper.
- `KpisTab` renders the new sections. `YearlyTrendCharts` gains a DSO chart and a second bar in the on-time chart.

**Tech Stack:** React 19, TS 5.9 (`noUnusedLocals`), Vitest 2 + jsdom + RTL, Recharts 3.10.

**Spec:** `docs/superpowers/specs/2026-09-29-conciliador-kpis-aging-dso-worsening-design.md`

**Conventions:**
- Run vitest/tsc/eslint from `apps/payment-reconciliation`.
- Commits: conventional, with no AI attribution lines. `git add` explicit paths only. Never stage the unrelated changes (`.gitignore`, `.atl/`, `apps/WO-sales/prompts/`, `img/`, `openspec/`).
- Never edit with PowerShell `Set-Content`.
- Only Task 8 pushes (a push to main deploys).
- Test dates use the parser's "d mmm yyyy" Spanish format (`'19 sep 2026'`; months `ene feb mar abr may jun jul ago sep oct nov dic`). `TODAY = new Date(2026, 8, 29)`, which is 29 Sep 2026.

---

## File Structure (paths relative to `apps/payment-reconciliation/`)

| File | Action | Responsibility |
|---|---|---|
| `src/types.ts` | Modify | `ReconciledRow.lastPaymentDate?: Date \| null`. |
| `src/reconcile.ts` (+ test) | Modify | Sets `lastPaymentDate`. |
| `src/metrics/clientIdentity.ts` (+ test) | Create | Normalized client key and display name. |
| `src/metrics/delinquencyBreakdown.ts` | Modify | Uses `clientIdentity` (no behavior change). |
| `src/metrics/yearlyTrendMetrics.ts` (+ test) | Modify | `collectionDays`, `onTimeValuePercentage`, DSO averages. |
| `src/metrics/agingMetrics.ts` (+ test) | Create | `computeReceivablesAging`, `overdueBalanceByClient`. |
| `src/metrics/worseningClients.ts` (+ test) | Create | `computeWorseningClients`. |
| `src/YearlyTrendCharts.tsx` | Modify | Value bar in the on-time chart; new DSO chart. |
| `src/KpisTab.tsx` (+ test) | Modify | Aging section, new table columns, worsening table, notes. |

---

### Task 1: `lastPaymentDate` in `reconcileInvoices`

**Files:** Modify `src/types.ts`, `src/reconcile.ts`, `src/reconcile.test.ts`.

- [ ] **Step 1: Failing tests** — append inside `describe('reconcileInvoices', …)` in `src/reconcile.test.ts`:

```ts
  it('keeps the latest real payment date, whatever the payment order', () => {
    const [row] = reconcileInvoices(
      [invoice()],
      [payment({ paymentDate: '2026-09-20' }), payment({ paymentNumber: 'P2', paymentDate: '2026-09-05' })],
      NOW,
    );
    expect(row.lastPaymentDate).toEqual(new Date(2026, 8, 20));
  });

  it('has no last payment date without readable payments', () => {
    const [none] = reconcileInvoices([invoice()], [], NOW);
    expect(none.lastPaymentDate).toBeNull();
    const [unreadable] = reconcileInvoices([invoice()], [payment({ paymentDate: 'sin fecha' })], NOW);
    expect(unreadable.lastPaymentDate).toBeNull();
  });
```

- [ ] **Step 2:** `npx vitest run src/reconcile.test.ts` → the 2 new tests FAIL (`lastPaymentDate` is undefined).

- [ ] **Step 3: Implement.**

In `src/types.ts`, inside `interface ReconciledRow`, after `paymentDetails`:

```ts
  /** Latest real payment date (set by reconcileInvoices); used for DSO. */
  lastPaymentDate?: Date | null;
```

In `src/reconcile.ts`, inside the `.map((invoice) => { … })` callback:
- declare `let lastPaymentDate: Date | null = null;` next to `maxDelayDays`;
- inside the `matchingPayments.map((p) => { … })` callback, right after `pDate` is computed, add:

```ts
        if (pDate && !isNaN(pDate.getTime()) && (!lastPaymentDate || pDate > lastPaymentDate)) {
          lastPaymentDate = pDate;
        }
```

- add `lastPaymentDate,` to the returned object, after `paymentDetails`.

- [ ] **Step 4:** `npx vitest run && npx tsc -b` → all green.

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/types.ts apps/payment-reconciliation/src/reconcile.ts apps/payment-reconciliation/src/reconcile.test.ts
git commit -m "feat(payment-reconciliation): el cruce guarda la fecha real del ultimo pago"
```

---

### Task 2: Shared `clientIdentity`

**Files:** Create `src/metrics/clientIdentity.ts`, `src/metrics/clientIdentity.test.ts`; Modify `src/metrics/delinquencyBreakdown.ts`.

- [ ] **Step 1: Failing test** — `src/metrics/clientIdentity.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { clientIdentity } from './clientIdentity';

describe('clientIdentity', () => {
  it('collapses whitespace for the name and upper-cases the key', () => {
    expect(clientIdentity('  acme   s.a.s ')).toEqual({ key: 'ACME S.A.S', name: 'acme s.a.s' });
  });

  it('gives the same key to spelling variants', () => {
    expect(clientIdentity('ACME S.A.S').key).toBe(clientIdentity(' acme  s.a.s ').key);
  });

  it('names a blank or missing client "Sin cliente"', () => {
    expect(clientIdentity('   ')).toEqual({ key: 'SIN CLIENTE', name: 'Sin cliente' });
    expect(clientIdentity(undefined).name).toBe('Sin cliente');
    expect(clientIdentity(null).name).toBe('Sin cliente');
  });
});
```

- [ ] **Step 2:** Run it → FAIL (the import cannot be resolved).

- [ ] **Step 3: Implement** — `src/metrics/clientIdentity.ts`

```ts
/** A client as the KPIs group it: spelling variants share the key; `name` is for display. */
export interface ClientIdentity {
  key: string;
  name: string;
}

// ReconciledRow has no customer id, so clients are identified by a normalized
// name: trimmed, inner whitespace collapsed, case-insensitive.
export function clientIdentity(raw: string | null | undefined): ClientIdentity {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ') || 'Sin cliente';
  return { key: name.toLocaleUpperCase('es'), name };
}
```

In `src/metrics/delinquencyBreakdown.ts`, import it and replace these two lines in `computeDelinquencyConcentration`:

```ts
    const name = (row.clientName ?? '').trim().replace(/\s+/g, ' ') || 'Sin cliente';
    const key = name.toLocaleUpperCase('es');
```

with:

```ts
    const { key, name } = clientIdentity(row.clientName);
```

Also drop the now-redundant comment detail about how the key is normalized; keep "Clients are keyed by clientIdentity; the first spelling seen is displayed."

- [ ] **Step 4:** `npx vitest run && npx tsc -b` → green, and every existing concentration test passes unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/metrics/clientIdentity.ts apps/payment-reconciliation/src/metrics/clientIdentity.test.ts apps/payment-reconciliation/src/metrics/delinquencyBreakdown.ts
git commit -m "refactor(payment-reconciliation): identidad de cliente compartida entre KPIs"
```

---

### Task 3: Value on time and DSO in the yearly trend

**Files:** Modify `src/metrics/yearlyTrendMetrics.ts`, `src/metrics/yearlyTrendMetrics.test.ts`.

Reference dataset for the DSO test (TODAY = 29 Sep 2026):

| Invoice | Invoice date | Due | Balance | Last payment | Collection days | Value |
|---|---|---|---|---|---|---|
| A | 1 mar 2025 | 10 mar 2025 | 0 | 21 Mar 2025 | 20 | 100 |
| B | 1 jun 2025 | 20 jun 2025 | 300 (unpaid) | — | 1 Jun 2025 → 29 Sep 2026 = 485 | 300 |
| C | 1 jul 2025 | 10 jul 2025 | 0 | none recorded | null (left out of DSO) | 999 |

DSO simple = (20 + 485) / 2 = 252.5. DSO weighted = (20·100 + 485·300) / 400 = 368.75. `invoiceCount` stays 3.

- [ ] **Step 1: Failing tests.** Append to `src/metrics/yearlyTrendMetrics.test.ts` (reuse `row`, `paidWithDelay`, `TODAY`):

```ts
describe('value collected on time', () => {
  it('weighs the on-time share by invoice value', () => {
    const [y] = computeYearlyTrend(
      [
        row({ dueDate: '10 mar 2025', total: 100, paymentDetails: paidWithDelay(0) }),
        row({ dueDate: '10 abr 2025', total: 300, paymentDetails: paidWithDelay(10) }),
      ],
      TODAY,
    );
    expect(y.onTimePercentage).toBe(50);
    expect(y.onTimeValuePercentage).toBe(25);
  });

  it('is 0 when the year has no invoice value', () => {
    const [y] = computeYearlyTrend([row({ dueDate: '10 mar 2025', total: 0, paymentDetails: paidWithDelay(0) })], TODAY);
    expect(y.onTimeValuePercentage).toBe(0);
  });
});

describe('collection days (DSO)', () => {
  const DSO_DATA = [
    row({ invoiceNumber: 'A', invoiceDate: '1 mar 2025', dueDate: '10 mar 2025', total: 100, balance: 0,
      paymentDetails: paidWithDelay(11), lastPaymentDate: new Date(2025, 2, 21) }),
    row({ invoiceNumber: 'B', invoiceDate: '1 jun 2025', dueDate: '20 jun 2025', total: 300, balance: 300 }),
    row({ invoiceNumber: 'C', invoiceDate: '1 jul 2025', dueDate: '10 jul 2025', total: 999, balance: 0 }),
  ];

  it('measures invoice date → last payment, or → today while a balance is owed', () => {
    const due = collectDueInvoices(DSO_DATA, TODAY);
    expect(due.map((d) => d.collectionDays)).toEqual([20, 485, null]);
  });

  it('averages collection days, simple and weighted by value, over invoices with a known date', () => {
    const [y] = computeYearlyTrend(DSO_DATA, TODAY);
    expect(y.invoiceCount).toBe(3);
    expect(y.averageCollectionDays).toBeCloseTo(252.5, 5);
    expect(y.weightedCollectionDays).toBeCloseTo(368.75, 5);
  });

  it('clamps collection days at 0 (paid before the invoice date)', () => {
    const [d] = collectDueInvoices(
      [row({ invoiceDate: '10 mar 2025', dueDate: '20 mar 2025', paymentDetails: paidWithDelay(0), lastPaymentDate: new Date(2025, 2, 1) })],
      TODAY,
    );
    expect(d.collectionDays).toBe(0);
  });

  it('reports no DSO for a year without any known collection date', () => {
    const [y] = computeYearlyTrend([row({ invoiceDate: '1 jul 2025', dueDate: '10 jul 2025', balance: 0 })], TODAY);
    expect(y.averageCollectionDays).toBeNull();
    expect(y.weightedCollectionDays).toBeNull();
  });
});
```

- [ ] **Step 2:** Run → the new tests FAIL.

- [ ] **Step 3: Implement** in `src/metrics/yearlyTrendMetrics.ts`:

1. Add these fields to `YearlyTrendRow`:

```ts
  onTimeValuePercentage: number;
  /** Mean days from invoice date to collection (or to today while owed); null without data. */
  averageCollectionDays: number | null;
  weightedCollectionDays: number | null;
```

2. Add this field to `DueInvoice`:

```ts
  /** Invoice date → last payment (or → today while a balance is owed), ≥ 0; null if a date is missing. */
  collectionDays: number | null;
```

3. Add `const DAY_MS = 1000 * 60 * 60 * 24;` next to `startOfDay`. In `collectDueInvoices`, before `result.push`, add:

```ts
    const issued = row.invoiceDate instanceof Date ? row.invoiceDate : parseExcelDate(row.invoiceDate);
    const collectedAt = row.balance > 0 ? cutoff : row.lastPaymentDate ?? null;
    const collectionDays =
      issued && collectedAt
        ? Math.max(0, Math.round((startOfDay(collectedAt).getTime() - startOfDay(issued).getTime()) / DAY_MS))
        : null;
```

Then push `{ row, year, dpd, value, collectionDays }`.

4. In `computeYearlyTrend`:
- extend `YearAccumulator` and its initializer with `onTimeValue: 0, collectionCount: 0, collectionSum: 0, collectionWeightedSum: 0, collectionValueSum: 0`;
- in the loop, destructure `collectionDays` and add:

```ts
    if (dpd === 0) acc.onTimeValue += value;
    if (collectionDays !== null) {
      acc.collectionCount += 1;
      acc.collectionSum += collectionDays;
      acc.collectionWeightedSum += collectionDays * value;
      acc.collectionValueSum += value;
    }
```

- in the mapped row add:

```ts
      onTimeValuePercentage: acc.valueSum > 0 ? (acc.onTimeValue / acc.valueSum) * 100 : 0,
      averageCollectionDays: acc.collectionCount > 0 ? acc.collectionSum / acc.collectionCount : null,
      weightedCollectionDays: acc.collectionValueSum > 0 ? acc.collectionWeightedSum / acc.collectionValueSum : null,
```

- [ ] **Step 4:** `npx vitest run && npx tsc -b` → green. The existing tests still pass; the time-of-day test compares whole results and stays equal.

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/metrics/yearlyTrendMetrics.ts apps/payment-reconciliation/src/metrics/yearlyTrendMetrics.test.ts
git commit -m "feat(payment-reconciliation): % del valor a tiempo y DSO por ano"
```

---

### Task 4: Receivables aging and overdue balance per client

**Files:** Create `src/metrics/agingMetrics.ts`, `src/metrics/agingMetrics.test.ts`.

- [ ] **Step 1: Failing test** — `src/metrics/agingMetrics.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { ReconciledRow } from '../types';
import { computeReceivablesAging, overdueBalanceByClient } from './agingMetrics';

function row(over: Partial<ReconciledRow> = {}): ReconciledRow {
  return {
    invoiceNumber: 'INV', orderNumber: 'OC', clientName: 'ACME',
    invoiceDate: '1 ene 2026', dueDate: '1 ene 2026', status: 'sent',
    total: 0, balance: 0,
    paymentDates: [], paymentAmounts: [], totalPaid: 0,
    isOverdue: false, maxDelayDays: 0, paymentDetails: [],
    ...over,
  };
}

const TODAY = new Date(2026, 8, 29); // 29 Sep 2026
const owed = (dueDate: string, balance: number, clientName = 'ACME') => row({ dueDate, balance, total: balance, clientName });

describe('computeReceivablesAging', () => {
  it('puts each open balance in its bucket, with the right boundaries', () => {
    const aging = computeReceivablesAging(
      [
        owed('15 oct 2026', 100),       // not due yet
        owed('29 sep 2026', 50),        // due today → not overdue
        owed('19 sep 2026', 200),       // 10 days
        owed('30 ago 2026', 300),       // 30 days
        owed('29 ago 2026', 400),       // 31 days
        owed('31 jul 2026', 10),        // 60 days
        owed('30 jul 2026', 20),        // 61 days
        owed('1 jul 2026', 500),        // 90 days
        owed('30 jun 2026', 30),        // 91 days
        owed('10 mar 2020', 600),       // 2020 is included in the snapshot
      ],
      TODAY,
    );
    const byKey = Object.fromEntries(aging.buckets.map((b) => [b.key, b.balance]));
    expect(aging.buckets.map((b) => b.key)).toEqual(['notDue', 'd1_30', 'd31_60', 'd61_90', 'over90']);
    expect(byKey).toEqual({ notDue: 150, d1_30: 500, d31_60: 410, d61_90: 520, over90: 630 });
    expect(aging.overdueBalance).toBe(2060);
    expect(aging.overdueInvoiceCount).toBe(8);
  });

  it('counts invoices and distinct clients per bucket (spelling variants merged)', () => {
    const aging = computeReceivablesAging(
      [owed('19 sep 2026', 1, 'ACME S.A.S'), owed('20 sep 2026', 1, ' acme  s.a.s '), owed('21 sep 2026', 1, 'Otro')],
      TODAY,
    );
    const d1_30 = aging.buckets.find((b) => b.key === 'd1_30')!;
    expect(d1_30).toMatchObject({ invoiceCount: 3, clientCount: 2, balance: 3 });
  });

  it('ignores paid, void and draft invoices and unreadable due dates', () => {
    const aging = computeReceivablesAging(
      [
        owed('19 sep 2026', 0),
        row({ dueDate: '19 sep 2026', balance: 70, status: 'void' }),
        row({ dueDate: '19 sep 2026', balance: 70, status: 'draft' }),
        row({ dueDate: null, balance: 70 }),
        row({ dueDate: '19 sep 2026', balance: NaN }),
      ],
      TODAY,
    );
    expect(aging.buckets.every((b) => b.invoiceCount === 0 && b.balance === 0)).toBe(true);
    expect(aging.overdueBalance).toBe(0);
  });
});

describe('overdueBalanceByClient', () => {
  it('sums only overdue balances, per normalized client', () => {
    const map = overdueBalanceByClient(
      [owed('19 sep 2026', 100, 'ACME S.A.S'), owed('10 mar 2020', 50, 'acme s.a.s'), owed('15 oct 2026', 999, 'ACME S.A.S')],
      TODAY,
    );
    expect(map.get('ACME S.A.S')).toBe(150);
    expect(map.size).toBe(1);
  });
});
```

Boundary math: 30 Aug → 29 Sep is 30 days; 29 Aug is 31; 31 Jul is 60; 30 Jul is 61; 1 Jul is 90; 30 Jun is 91.

- [ ] **Step 2:** Run → FAIL (the import cannot be resolved).

- [ ] **Step 3: Implement** — `src/metrics/agingMetrics.ts`

```ts
import type { ReconciledRow } from '../types';
import { parseExcelDate } from '../customerAnalysisUtils';
import { clientIdentity } from './clientIdentity';

// Receivables aging: a snapshot of what is owed TODAY, by days past due.
// Unlike the yearly KPIs it includes every year (an unpaid 2020 invoice is the
// most urgent one to collect). Void and draft invoices are not receivables.

export const AGING_KEYS = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;
export type AgingKey = (typeof AGING_KEYS)[number];

export interface AgingBucket {
  key: AgingKey;
  balance: number;
  invoiceCount: number;
  clientCount: number;
}

export interface ReceivablesAging {
  buckets: AgingBucket[];
  /** Balance past due (every bucket except notDue). */
  overdueBalance: number;
  overdueInvoiceCount: number;
}

interface OpenInvoice {
  row: ReconciledRow;
  daysPastDue: number;
  balance: number;
}

const DAY_MS = 1000 * 60 * 60 * 24;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function openInvoices(rows: ReconciledRow[], today: Date): OpenInvoice[] {
  const cutoff = startOfDay(today);
  const result: OpenInvoice[] = [];
  for (const row of rows) {
    const status = (row.status ?? '').trim().toLowerCase();
    if (status === 'void' || status === 'draft') continue;
    if (!Number.isFinite(row.balance) || row.balance <= 0) continue;
    const due = row.dueDate instanceof Date ? row.dueDate : parseExcelDate(row.dueDate);
    if (!due) continue;
    const daysPastDue = Math.round((cutoff.getTime() - startOfDay(due).getTime()) / DAY_MS);
    result.push({ row, daysPastDue, balance: row.balance });
  }
  return result;
}

const bucketOf = (daysPastDue: number): AgingKey => {
  if (daysPastDue <= 0) return 'notDue';
  if (daysPastDue <= 30) return 'd1_30';
  if (daysPastDue <= 60) return 'd31_60';
  if (daysPastDue <= 90) return 'd61_90';
  return 'over90';
};

export function computeReceivablesAging(rows: ReconciledRow[], today: Date): ReceivablesAging {
  const acc = new Map(AGING_KEYS.map((key) => [key, { balance: 0, invoiceCount: 0, clients: new Set<string>() }]));
  for (const { row, daysPastDue, balance } of openInvoices(rows, today)) {
    const bucket = acc.get(bucketOf(daysPastDue))!;
    bucket.balance += balance;
    bucket.invoiceCount += 1;
    bucket.clients.add(clientIdentity(row.clientName).key);
  }
  const buckets = AGING_KEYS.map((key) => {
    const b = acc.get(key)!;
    return { key, balance: b.balance, invoiceCount: b.invoiceCount, clientCount: b.clients.size };
  });
  const overdue = buckets.filter((b) => b.key !== 'notDue');
  return {
    buckets,
    overdueBalance: overdue.reduce((s, b) => s + b.balance, 0),
    overdueInvoiceCount: overdue.reduce((s, b) => s + b.invoiceCount, 0),
  };
}

/** Balance already past due today, per client key (see clientIdentity). */
export function overdueBalanceByClient(rows: ReconciledRow[], today: Date): Map<string, number> {
  const result = new Map<string, number>();
  for (const { row, daysPastDue, balance } of openInvoices(rows, today)) {
    if (daysPastDue <= 0) continue;
    const { key } = clientIdentity(row.clientName);
    result.set(key, (result.get(key) ?? 0) + balance);
  }
  return result;
}
```

- [ ] **Step 4:** `npx vitest run src/metrics/agingMetrics.test.ts && npx tsc -b` → green (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/metrics/agingMetrics.ts apps/payment-reconciliation/src/metrics/agingMetrics.test.ts
git commit -m "feat(payment-reconciliation): cartera por antiguedad y saldo vencido por cliente"
```

---

### Task 5: Worsening clients

**Files:** Create `src/metrics/worseningClients.ts`, `src/metrics/worseningClients.test.ts`.

Reference dataset (TODAY = 29 Sep 2026; previous year 2025, current 2026):

| Client | 2025 DPDs (avg) | 2026 DPDs (avg) | Change | Overdue balance today |
|---|---|---|---|---|
| Cliente A | 5, 15 (10) | 30, 10* (20) | +10 | 1000 (*unpaid, due 19 sep 2026) |
| Cliente B | 20, 20 (20) | 25, 25 (25) | +5 | 0 |
| Cliente C | 10, 10 (10) | 0, 0 (0) | −10 → not listed | 0 |
| Cliente D | 40 (only 1 invoice) | 90, 90 | → not listed (< 2 invoices in 2025) | 0 |

- [ ] **Step 1: Failing test** — `src/metrics/worseningClients.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { ReconciledRow } from '../types';
import { computeWorseningClients } from './worseningClients';

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

const paid = (clientName: string, dueDate: string, delay: number) =>
  row({ clientName, dueDate, paymentDetails: [{ date: 'x', delay }] });

const TODAY = new Date(2026, 8, 29);

const DATA: ReconciledRow[] = [
  paid('Cliente A', '10 mar 2025', 5), paid('Cliente A', '10 abr 2025', 15),
  paid('Cliente A', '5 ene 2026', 30),
  row({ clientName: 'Cliente A', dueDate: '19 sep 2026', total: 1000, balance: 1000 }), // 10 days, unpaid
  paid('Cliente B', '10 mar 2025', 20), paid('Cliente B', '10 abr 2025', 20),
  paid('Cliente B', '5 ene 2026', 25), paid('Cliente B', '10 feb 2026', 25),
  paid('Cliente C', '10 mar 2025', 10), paid('Cliente C', '10 abr 2025', 10),
  paid('Cliente C', '5 ene 2026', 0), paid('Cliente C', '10 feb 2026', 0),
  paid('Cliente D', '10 mar 2025', 40),
  paid('Cliente D', '5 ene 2026', 90), paid('Cliente D', '10 feb 2026', 90),
];

describe('computeWorseningClients', () => {
  it('compares the current year to date with the previous full year', () => {
    const result = computeWorseningClients(DATA, TODAY);
    expect(result.previousYear).toBe(2025);
    expect(result.currentYear).toBe(2026);
  });

  it('lists only clients whose average DPD rose, biggest increase first', () => {
    const { clients } = computeWorseningClients(DATA, TODAY);
    expect(clients.map((c) => c.name)).toEqual(['Cliente A', 'Cliente B']);
    expect(clients[0]).toEqual({ name: 'Cliente A', previousDPD: 10, currentDPD: 20, change: 10, overdueBalance: 1000 });
    expect(clients[1]).toMatchObject({ previousDPD: 20, currentDPD: 25, change: 5, overdueBalance: 0 });
  });

  it('requires at least 2 due invoices in each year', () => {
    const { clients } = computeWorseningClients(DATA, TODAY);
    expect(clients.find((c) => c.name === 'Cliente D')).toBeUndefined();
  });

  it('merges spelling variants of a client', () => {
    const { clients } = computeWorseningClients(
      [
        paid('ACME S.A.S', '10 mar 2025', 0), paid('acme  s.a.s', '10 abr 2025', 0),
        paid(' ACME S.A.S ', '5 ene 2026', 20), paid('ACME S.A.S', '10 feb 2026', 20),
      ],
      TODAY,
    );
    expect(clients).toEqual([{ name: 'ACME S.A.S', previousDPD: 0, currentDPD: 20, change: 20, overdueBalance: 0 }]);
  });

  it('honors the limit', () => {
    expect(computeWorseningClients(DATA, TODAY, 1).clients.map((c) => c.name)).toEqual(['Cliente A']);
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** — `src/metrics/worseningClients.ts`

```ts
import type { ReconciledRow } from '../types';
import { collectDueInvoices } from './yearlyTrendMetrics';
import { overdueBalanceByClient } from './agingMetrics';
import { clientIdentity } from './clientIdentity';

// Clients whose average DPD rose from the previous full year to the current
// year to date: the "who to call" list. Built on the shared KPI universe.

export interface WorseningClient {
  name: string;
  previousDPD: number;
  currentDPD: number;
  change: number;
  /** Balance already past due today (all years). */
  overdueBalance: number;
}

export interface WorseningClientsResult {
  previousYear: number;
  currentYear: number;
  clients: WorseningClient[];
}

/** Fewest due invoices per year for a client to be compared (one bad invoice is noise). */
export const MIN_INVOICES_PER_YEAR = 2;

interface YearStats {
  count: number;
  dpdSum: number;
}

export function computeWorseningClients(rows: ReconciledRow[], today: Date, limit = 10): WorseningClientsResult {
  const currentYear = today.getFullYear();
  const previousYear = currentYear - 1;
  const clients = new Map<string, { name: string; previous: YearStats; current: YearStats }>();

  for (const { row, year, dpd } of collectDueInvoices(rows, today)) {
    if (year !== currentYear && year !== previousYear) continue;
    const { key, name } = clientIdentity(row.clientName);
    const entry = clients.get(key) ?? { name, previous: { count: 0, dpdSum: 0 }, current: { count: 0, dpdSum: 0 } };
    const stats = year === currentYear ? entry.current : entry.previous;
    stats.count += 1;
    stats.dpdSum += dpd;
    clients.set(key, entry);
  }

  const overdue = overdueBalanceByClient(rows, today);
  const worsening: WorseningClient[] = [];
  for (const [key, { name, previous, current }] of clients) {
    if (previous.count < MIN_INVOICES_PER_YEAR || current.count < MIN_INVOICES_PER_YEAR) continue;
    const previousDPD = previous.dpdSum / previous.count;
    const currentDPD = current.dpdSum / current.count;
    const change = currentDPD - previousDPD;
    if (change <= 0) continue;
    worsening.push({ name, previousDPD, currentDPD, change, overdueBalance: overdue.get(key) ?? 0 });
  }

  worsening.sort((a, b) => b.change - a.change || a.name.localeCompare(b.name, 'es'));
  return { previousYear, currentYear, clients: worsening.slice(0, limit) };
}
```

- [ ] **Step 4:** `npx vitest run src/metrics/worseningClients.test.ts && npx tsc -b` → green (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/metrics/worseningClients.ts apps/payment-reconciliation/src/metrics/worseningClients.test.ts
git commit -m "feat(payment-reconciliation): clientes cuyo DPD empeoro frente al ano anterior"
```

---

### Task 6: Charts — value bar and DSO chart

**Files:** Modify `src/YearlyTrendCharts.tsx`.

No unit test (Recharts needs layout); the portal build in Task 8 covers it.

- [ ] **Step 1:** In the "% de facturas pagadas a tiempo" card:
- rename the title to `% pagado a tiempo`;
- add a second bar after the existing one:

```tsx
            <Bar dataKey="onTimeValuePercentage" name="% del valor a tiempo" fill="#0d9488" radius={BAR_RADIUS} maxBarSize={48} />
```

- rename the existing bar's `name` to `% de facturas a tiempo`.

- [ ] **Step 2:** Add a DSO card right after the on-time card, before the bands card:

```tsx
      <ChartCard title="Días de cobro (DSO) por año">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={onTimeData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" stroke="#64748b" />
            <YAxis stroke="#64748b" allowDecimals={false} />
            <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => `${oneDecimal(Number(v))} días`} />
            <Legend />
            <Bar dataKey="averageCollectionDays" name="DSO promedio" fill="#0284c7" radius={BAR_RADIUS} maxBarSize={48} />
            <Bar dataKey="weightedCollectionDays" name="DSO ponderado por valor" fill="#7c3aed" radius={BAR_RADIUS} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
```

- [ ] **Step 3:** Remove `className="xl:col-span-2"` from the bands card, so the four charts form a 2×2 grid on wide screens.

- [ ] **Step 4:** `npx tsc -b && npx eslint src/YearlyTrendCharts.tsx` → green. `null` values in the DSO bars are simply not drawn.

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/YearlyTrendCharts.tsx
git commit -m "feat(payment-reconciliation): graficos de % del valor a tiempo y de DSO"
```

---

### Task 7: KpisTab — aging, table columns, worsening clients, notes

**Files:** Modify `src/KpisTab.tsx`, `src/KpisTab.test.tsx`.

- [ ] **Step 1: Failing tests** — append inside `describe('KpisTab', …)`:

```tsx
  it('shows the receivables aging snapshot', () => {
    render(
      <KpisTab
        reconciledData={[
          row({ dueDate: '19 sep 2026', total: 200, balance: 200, paymentDetails: [] }),
          row({ dueDate: '15 oct 2026', total: 50, balance: 50, paymentDetails: [] }),
        ]}
        today={TODAY}
      />,
    );
    const aging = screen.getByRole('region', { name: 'Cartera por antigüedad (hoy)' });
    expect(aging).toHaveTextContent('Por vencer');
    expect(aging).toHaveTextContent('1–30 días');
    expect(aging).toHaveTextContent(/Total vencido/);
    expect(aging).toHaveTextContent('1 facturas');
  });

  it('keeps the aging snapshot when no invoice is due yet for the trend', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '15 oct 2026', total: 50, balance: 50, paymentDetails: [] })]} today={TODAY} />);
    expect(screen.getByRole('region', { name: 'Cartera por antigüedad (hoy)' })).toBeInTheDocument();
    expect(screen.getByText(/No hay facturas vencidas/)).toBeInTheDocument();
  });

  it('adds value on time and DSO columns to the yearly table', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '10 mar 2025' })]} today={TODAY} />);
    const yearly = within(screen.getByRole('table', { name: 'Tendencia anual de mora por año de vencimiento' }));
    expect(yearly.getByRole('columnheader', { name: '% a tiempo (valor)' })).toBeInTheDocument();
    expect(yearly.getByRole('columnheader', { name: 'DSO promedio' })).toBeInTheDocument();
    expect(yearly.getByRole('columnheader', { name: 'DSO ponderado' })).toBeInTheDocument();
  });

  it('lists the clients whose DPD worsened', () => {
    const paid = (dueDate: string, delay: number) =>
      row({ clientName: 'Cliente A', dueDate, paymentDetails: [{ date: 'x', delay }] });
    render(
      <KpisTab
        reconciledData={[paid('10 mar 2025', 0), paid('10 abr 2025', 0), paid('5 ene 2026', 20), paid('10 feb 2026', 20)]}
        today={TODAY}
      />,
    );
    const table = screen.getByRole('table', { name: 'Clientes cuyo DPD subió frente al año anterior' });
    expect(table).toHaveTextContent('Cliente A');
    expect(table).toHaveTextContent('+20,0 días');
  });

  it('says so when no client worsened', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '10 mar 2025' })]} today={TODAY} />);
    expect(screen.getByText(/Ningún cliente empeoró frente a 2025/)).toBeInTheDocument();
  });

  it('explains the new indicators in the notes', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '10 mar 2025' })]} today={TODAY} />);
    const help = screen.getByRole('region', { name: '¿Cómo se calculan estos indicadores?' });
    expect(help).toHaveTextContent('DSO');
    expect(help).toHaveTextContent('Cartera por antigüedad');
    expect(help).toHaveTextContent('Clientes que empeoraron');
    expect(help).toHaveTextContent('% del valor a tiempo');
  });
```

The `row()` factory in this file defaults to `paymentDetails: [{ date: '01/01/2025', delay: 0 }]` with `balance: 0`, so default rows are paid on time and have no open balance.

- [ ] **Step 2:** Run → the new tests FAIL.

- [ ] **Step 3: Implement in `src/KpisTab.tsx`.**

1. Imports:

```ts
import { computeReceivablesAging } from './metrics/agingMetrics';
import type { AgingKey, ReceivablesAging } from './metrics/agingMetrics';
import { computeWorseningClients } from './metrics/worseningClients';
import type { WorseningClientsResult } from './metrics/worseningClients';
```

2. Helpers, next to `oneDecimal`:

```ts
const money = (n: number) =>
  n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

const days = (n: number | null) => (n === null ? '—' : `${oneDecimal(n)} días`);

const AGING_LABELS: Record<AgingKey, string> = {
  notDue: 'Por vencer',
  d1_30: '1–30 días',
  d31_60: '31–60 días',
  d61_90: '61–90 días',
  over90: 'Más de 90 días',
};
```

3. Components, above `CalculationNotes`:

```tsx
function AgingSection({ aging }: { aging: ReceivablesAging }) {
  return (
    <section aria-labelledby="kpis-aging-title" className="bg-white rounded-2xl border border-slate-100 shadow-soft p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h3 id="kpis-aging-title" className="text-sm font-bold text-slate-600 uppercase tracking-wider">
          Cartera por antigüedad (hoy)
        </h3>
        <p className="text-sm text-slate-600">
          Total vencido: <strong className="text-red-700">{money(aging.overdueBalance)}</strong> ·{' '}
          {aging.overdueInvoiceCount} facturas
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {aging.buckets.map((b) => (
          <div
            key={b.key}
            className={`rounded-xl border px-4 py-3 ${b.key === 'notDue' ? 'bg-slate-50 border-slate-100' : 'bg-red-50/40 border-red-100'}`}
          >
            <p className="text-xs font-semibold text-slate-500">{AGING_LABELS[b.key]}</p>
            <p className="text-lg font-bold text-slate-900 truncate">{money(b.balance)}</p>
            <p className="text-xs text-slate-500">
              {b.invoiceCount} facturas · {b.clientCount} clientes
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WorseningClientsTable({ result }: { result: WorseningClientsResult }) {
  const th = 'px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider';
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
      <h3 className="px-6 pt-6 text-sm font-bold text-slate-600 uppercase tracking-wider">
        Clientes que empeoraron ({result.previousYear} → {result.currentYear} a la fecha)
      </h3>
      {result.clients.length === 0 ? (
        <p className="px-6 py-6 text-sm text-slate-500">Ningún cliente empeoró frente a {result.previousYear}.</p>
      ) : (
        <table className="w-full text-left border-collapse mt-4">
          <caption className="sr-only">Clientes cuyo DPD subió frente al año anterior</caption>
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th scope="col" className={th}>Cliente</th>
              <th scope="col" className={`${th} text-right`}>DPD {result.previousYear}</th>
              <th scope="col" className={`${th} text-right`}>DPD {result.currentYear}</th>
              <th scope="col" className={`${th} text-right`}>Cambio</th>
              <th scope="col" className={`${th} text-right`}>Saldo vencido hoy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result.clients.map((c) => (
              <tr key={c.name}>
                <td className="px-6 py-4 font-medium text-slate-900">{c.name}</td>
                <td className="px-6 py-4 text-right text-slate-600">{oneDecimal(c.previousDPD)} días</td>
                <td className="px-6 py-4 text-right text-slate-900">{oneDecimal(c.currentDPD)} días</td>
                <td className="px-6 py-4 text-right font-semibold text-red-700">+{oneDecimal(c.change)} días</td>
                <td className="px-6 py-4 text-right text-slate-900">{c.overdueBalance > 0 ? money(c.overdueBalance) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

4. `CalculationNotes`: add these paragraphs before the "Ejemplo" paragraph:

```tsx
        <p>
          <strong className="text-slate-800">% del valor a tiempo</strong>: la parte del valor facturado (en pesos)
          que se pagó sin mora. Si el % de facturas a tiempo baja pero el % del valor se mantiene, los retrasos están
          en facturas pequeñas.
        </p>
        <p>
          <strong className="text-slate-800">DSO (días de cobro)</strong>: los días entre la fecha de la factura y el
          último pago; si todavía tiene saldo, hasta hoy. El promedio simple pesa igual cada factura; el ponderado
          pesa por valor. Las facturas pagadas sin un pago registrado no entran en el DSO.
        </p>
        <p>
          <strong className="text-slate-800">Cartera por antigüedad</strong>: el saldo que se debe hoy, según los días
          que lleva vencido. «Por vencer» es el saldo que aún no vence y no suma al total vencido. Incluye todos los
          años, también 2020.
        </p>
        <p>
          <strong className="text-slate-800">Clientes que empeoraron</strong>: compara el DPD promedio de cada cliente
          en lo que va del año con el del año anterior completo. Solo entran clientes con al menos 2 facturas vencidas
          en cada año; se muestran los 10 con mayor aumento.
        </p>
```

5. `KpisTab` body: add these memos after `concentration`:

```ts
  const aging = useMemo(
    () => computeReceivablesAging(reconciledData, today ?? new Date()),
    [reconciledData, today],
  );
  const worsening = useMemo(
    () => computeWorseningClients(reconciledData, today ?? new Date()),
    [reconciledData, today],
  );
```

Replace everything from `if (rows.length === 0) {` to the end of the component with:

```tsx
  const hasAging = aging.buckets.some((b) => b.invoiceCount > 0);
  const emptyTrend = (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-10 text-center text-slate-500">
      No hay facturas vencidas para calcular la tendencia.
    </div>
  );

  if (rows.length === 0 && !hasAging) return emptyTrend;

  const th = 'px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider';

  return (
    <div className="flex flex-col gap-6">
      {hasAging && <AgingSection aging={aging} />}

      {rows.length === 0 ? (
        emptyTrend
      ) : (
        <>
          <p className="text-sm text-slate-500">
            Cada factura cuenta en el año de su <strong>vencimiento</strong> y solo entran las ya vencidas.
            El año en curso se marca con * en los gráficos y como «parcial» en la tabla.
          </p>

          <ChartsErrorBoundary>
            <Suspense fallback={<SkeletonAnalytics cards={2} />}>
              <YearlyTrendCharts rows={rows} bands={bands} />
            </Suspense>
          </ChartsErrorBoundary>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <caption className="sr-only">Tendencia anual de mora por año de vencimiento</caption>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th scope="col" className={th}>Año</th>
                  <th scope="col" className={`${th} text-right`}>Facturas</th>
                  <th scope="col" className={`${th} text-right`}>DPD promedio</th>
                  <th scope="col" className={`${th} text-right`}>DPD ponderado</th>
                  <th scope="col" className={`${th} text-right`}>% a tiempo</th>
                  <th scope="col" className={`${th} text-right`}>% a tiempo (valor)</th>
                  <th scope="col" className={`${th} text-right`}>DSO promedio</th>
                  <th scope="col" className={`${th} text-right`}>DSO ponderado</th>
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
                    <td className="px-6 py-4 text-right text-slate-900">{oneDecimal(r.onTimeValuePercentage)} %</td>
                    <td className="px-6 py-4 text-right text-slate-900">{days(r.averageCollectionDays)}</td>
                    <td className="px-6 py-4 text-right text-slate-900">{days(r.weightedCollectionDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <WorseningClientsTable result={worsening} />

          <ConcentrationTable rows={concentration} />
        </>
      )}

      <CalculationNotes />
    </div>
  );
}
```

The empty-state tests keep passing: in "no invoice is due yet" and "only 2020", the rows have `balance: 0`, so there is no aging either, and the early return renders only `emptyTrend`.

- [ ] **Step 4:** `npx vitest run && npx tsc -b && npx eslint src/KpisTab.tsx src/KpisTab.test.tsx` → green. If an existing test that searches for text now matches in two places (e.g. `2025` also in the worsening title), scope it with `within(...)` on the table it means, and keep the assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/payment-reconciliation/src/KpisTab.tsx apps/payment-reconciliation/src/KpisTab.test.tsx
git commit -m "feat(payment-reconciliation): KPIs con cartera por antiguedad, DSO y clientes que empeoraron"
```

---

### Task 8: Final verification and delivery

- [ ] From `apps/payment-reconciliation`: `npx tsc -b` (exit 0), `npx vitest run` (all pass), `npx eslint src` (0 errors).
- [ ] From the repo root: `npm run build --workspace=apps/portal` (exit 0). `grep -l recharts apps/portal/dist/assets/*.js` lists only the lazy chart chunk.
- [ ] Manual check in the portal, KPIs tab:
  - the aging section is on top;
  - the on-time chart has 2 bars per year, and there is a DSO chart;
  - the yearly table has 8 columns;
  - the worsening-clients table appears;
  - the notes explain each new indicator.
- [ ] `git push`, then `git log origin/main..main --oneline` prints nothing.
