# Payment Reconciliation — KPIs tab: yearly DPD trend

Date: 2026-09-29
App: `apps/payment-reconciliation`

## Goal

Let the collections team see whether customer delinquency is getting worse year over year.
The headline indicator is the average DPD (days past due) of all customers, per year.

## Decisions

| Topic | Decision | Reason |
|---|---|---|
| Year of an invoice | Year of its **due date** | Delinquency starts counting at the due date. |
| Invoices included | Only invoices whose due date is **before today** | Invoices not yet due count as 0 days and would make the current year look artificially better. |
| Lines in the DPD chart | Simple average and value-weighted average | A customer with many small invoices can distort the simple average. |
| Second indicator | % of invoices paid on time, per year | Confirms the trend from another angle, from the same grouping. |
| Chart library | Recharts, lazy-loaded | Chosen by the user; loaded only when the KPIs tab opens. |
| Period filter | Ignored by this tab | The tab compares several years by nature. |
| Per-customer filter | Out of scope | Can be added later. |

### Why not reuse the existing "Índice de Severidad"

`weightedDPD` in `customerAnalysisUtils.ts` only averages invoices already in arrears (`dpd > 0`).
It measures how severe delinquency is *when it happens*, not overall delinquency.
Plotting it next to the simple average would compare two different populations.
This feature uses a new weighted average over **all** due invoices, where on-time invoices weigh 0 days.

## Metric definition

New pure module `src/metrics/yearlyTrendMetrics.ts`:

```ts
interface YearlyTrendRow {
  year: number;
  invoiceCount: number;
  averageDPD: number;     // simple mean of per-invoice DPD
  weightedDPD: number;    // Σ(dpd × total) / Σ(total); 0 when Σ(total) = 0
  onTimePercentage: number; // 0–100
  isPartialYear: boolean; // year === today's year
}

computeYearlyTrend(rows: ReconciledRow[], today: Date): YearlyTrendRow[]
```

Rules:

1. Parse `dueDate` with `parseExcelDate`. Skip invoices whose due date is unreadable.
2. Skip invoices whose due date is not strictly before `today` (compared by calendar day).
3. Per-invoice DPD = `max(0, calculateInvoiceDPD(row))`, the same basis as the existing average DPD in General Analysis.
4. An invoice is on time when its DPD is 0.
5. Group by due-date year. Return rows sorted by year ascending. Years with no invoices are not returned.
6. `today` is a parameter so tests are deterministic.

## UI

- New tab **KPIs** in `App.tsx`, after "Análisis General".
- New component `src/KpisTab.tsx` (table and states), receiving `reconciledData` and `loading`.
- The charts live in `src/YearlyTrendCharts.tsx`, lazy-loaded with `React.lazy` from `KpisTab`, so Recharts is downloaded only when the tab opens and the table stays testable without it.
- Chart 1: line chart, X = year, Y = days. Two lines: "DPD promedio" and "DPD ponderado por valor".
- Chart 2: line chart, X = year, Y = % on time (0–100).
- Table below: Year · Invoices · DPD promedio · DPD ponderado · % a tiempo. The current year is labeled "(parcial)".
- States: skeleton while loading; an empty-state message when there are no due invoices.

## Cleanup

Remove the dead `mode === 'kpis'` branch and the `mode` prop from `GeneralAnalysis.tsx`.
Its only caller passes `mode="analysis"`, so this cleanup does not change behavior.
Remove any imports and memos that only that branch used.

## Testing

Test-first unit tests for `computeYearlyTrend`:

- groups by due-date year, not invoice-date year;
- excludes invoices not yet due and invoices with unreadable due dates;
- simple average, weighted average and on-time % on a known dataset;
- negative DPD (paid early) counts as 0 and as on time;
- weighted average is 0 when total value is 0;
- flags the current year as partial;
- sorts years ascending.

Component: one smoke test that the KPIs tab renders the table rows from the given data.
Existing tests, `tsc -b` and `eslint` must stay green.
