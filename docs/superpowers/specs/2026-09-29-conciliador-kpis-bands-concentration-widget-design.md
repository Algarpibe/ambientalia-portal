# Payment Reconciliation — KPIs: delinquency bands, concentration, and a dashboard widget

Date: 2026-09-29
App: `apps/payment-reconciliation`
Builds on: `2026-09-29-conciliador-kpis-yearly-dpd-design.md`

## Goal

Explain *why* the yearly DPD trend moves:

- Is delinquency rising through many small delays, or through a few severe ones? (**bands**)
- Is it a general trend, or is it driven by two or three customers? (**concentration**)

Also publish the yearly DPD chart as a Dashboard widget.

## Shared universe

Every KPI on the tab and the widget uses the same invoices:

- the year is the year of the due date;
- only invoices due strictly before today;
- void and draft invoices are excluded;
- years in `EXCLUDED_YEARS` (today: 2020, incomplete history) are excluded;
- per-invoice DPD = `max(0, calculateInvoiceDPD(row, startOfDay(today)))`; value = finite positive `total`, else 0.

This universe lives in one function, `collectDueInvoices(rows, today)`, in `metrics/yearlyTrendMetrics.ts`. Every metric builds on it, so the numbers cannot drift apart. The 2020 exclusion moves from `KpisTab` into this function.

## Indicator 1 — delinquency bands per year

Bands by **invoice count** (value is already covered by the weighted DPD and by the concentration table):

| Key | Label | DPD |
|---|---|---|
| onTime | A tiempo | 0 |
| d1_15 | 1–15 días | 1–15 |
| d16_30 | 16–30 días | 16–30 |
| d31_60 | 31–60 días | 31–60 |
| over60 | Más de 60 días | ≥ 61 |

UI: a 100 % stacked bar per year; the tooltip shows the % and the invoice count.

## Indicator 2 — concentration per year

A customer's *weighted delinquency* in a year = Σ (DPD × value) over its due invoices of that year.
The year's total is the sum across customers.

Per year:

- `totalClients`: customers with due invoices;
- `clientsWithDelinquency`: customers with weighted delinquency > 0;
- `clientsFor80`: the fewest customers whose weighted delinquency adds up to ≥ 80 % of the year's total (0 when the total is 0);
- `topClients`: up to 3 customers with the highest share (%), ties broken by name.

UI: the table "Concentración de la mora": Año · Clientes · Con mora · Suman el 80 % · Principales.

## Dashboard widget

- Widget `payment-reconciliation-dpd-trend`, named "Tendencia de Mora (DPD por año)", default size 6×4.
- It renders the same DPD bar chart as the tab (simple and weighted, per year).
- It loads its data with the existing `useReconciliationData` hook, so it gets raw hub invoices and payments.

## Supporting refactor

The invoice ↔ payment matching (`paymentDetails`, `delay`, `isOverdue`, `maxDelayDays`, the internal-client exclusion) lives today inside `App.tsx`.
It moves to a pure, tested `reconcileInvoices(invoices, payments, now)` in `src/reconcile.ts`, used by both `App.tsx` and the widget.
Behavior is unchanged, except that payments are indexed once instead of filtered per invoice.

The DPD chart moves to its own file, `DpdByYearChart.tsx`, used by the tab's charts and by the widget.
Recharts still loads lazily in both places: the tab through `YearlyTrendCharts`, the widget through `React.lazy`, inside the portal's per-widget Suspense and error boundary.

## Calculation notes

The "¿Cómo se calculan estos indicadores?" card gains two short paragraphs: one for the bands and one for the concentration (including the 80 % rule).

## Testing

Test-first unit tests:

- `reconcileInvoices`;
- `collectDueInvoices`, including the 2020 exclusion;
- the band boundaries (0, 15/16, 30/31, 60/61) and the shares;
- concentration: the 80 % cut, ties, a zero-delinquency year.

Component tests:

- the concentration table and the notes, with the charts mocked;
- the widget's loading, error, empty and data states, with the hook and the chart mocked.

The portal build must keep Recharts out of the eager chunks.
