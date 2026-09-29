# Payment Reconciliation — KPIs: aging, value on time, DSO, worsening clients

Date: 2026-09-29
App: `apps/payment-reconciliation`
Builds on: `2026-09-29-conciliador-kpis-yearly-dpd-design.md` and `2026-09-29-conciliador-kpis-bands-concentration-widget-design.md`

## Decisions (made with the user)

| Topic | Decision |
|---|---|
| DSO per invoice | Days from the invoice date to the last payment. If a balance is still owed, days up to today. |
| Aging buckets | Por vencer · 1–30 · 31–60 · 61–90 · más de 90 días. "Por vencer" is shown apart and is not part of the overdue total. |
| Aging universe | Every invoice with a balance, **2020 included** (it is a snapshot of what is owed today). Void, draft and the internal client are excluded. |
| Worsening clients | Current year (to date) vs the previous full year, by average DPD. A client needs ≥ 2 due invoices in each year. Top 10 by increase. |
| Value on time | Same universe as the yearly trend: Σ value of invoices with DPD 0 ÷ Σ value. |

## Why the old DSO function is not reused

`computeAverageDSO` in `metrics/generalAnalysisMetrics.ts` has two problems:

- It measures due date → last payment. That is delinquency (DPD), not DSO.
- It parses the payment dates from the display strings (`05/09/2026`), which JavaScript reads as US month/day. Those dates come out wrong, or are dropped when the day is above 12.

The new DSO reads the real payment date instead. To make that possible, `reconcileInvoices` stores `lastPaymentDate` (the latest parsed payment date) on each row.

## Metrics

- **Yearly trend** (`computeYearlyTrend`, shared universe) gains:
  - `onTimeValuePercentage`;
  - `averageCollectionDays` and `weightedCollectionDays`, each `null` when no invoice of the year has a known collection date.
- **Collection days** of a due invoice are computed in `collectDueInvoices`:
  - if the balance is > 0: `today − invoice date`;
  - otherwise: `lastPaymentDate − invoice date`;
  - clamped at 0;
  - `null` when a date is missing (e.g. paid with no recorded payment). Those invoices are left out of the DSO averages only.
- **Aging** (`computeReceivablesAging`): the buckets are by days past due at the start of today. Each bucket has the balance, the invoice count and the client count. The result also has the overdue total and the overdue invoice count.
- **Overdue balance per client** (`overdueBalanceByClient`): used by the worsening-clients table.
- **Worsening clients** (`computeWorseningClients`): builds on `collectDueInvoices`.
- **Client identity** (spelling variants merged) moves to a shared `clientIdentity` helper, used by concentration, aging and worsening.

## UI (KPIs tab), top to bottom

1. **Cartera por antigüedad (hoy):** 5 bucket cards, plus the overdue total. Shown even when there is no due invoice for the trend.
2. **Charts:**
   - DPD;
   - % on time, now with two bars: by invoices and by value;
   - DSO, a new chart with simple and weighted bars;
   - bands.
3. **Yearly table**, with new columns: % a tiempo (valor), DSO promedio, DSO ponderado.
4. **Clientes que empeoraron:** Cliente · DPD año anterior · DPD este año · Cambio · Saldo vencido hoy.
5. Concentration, unchanged.
6. **Notes**, extended for each new indicator.

## Known limitation (assumption)

The hub returns `total` and `balance` in the invoice's currency. Every money figure assumes COP. If invoices in other currencies exist, they are summed as pesos. Converting with the exchange rate belongs in the hub query and is out of scope here.

## Testing

Test-first unit tests:

- `lastPaymentDate` in `reconcileInvoices`;
- `clientIdentity`;
- collection days and value on time in the yearly trend;
- aging bucket boundaries (due today, 30/31, 60/61, 90/91) and exclusions;
- overdue balance per client;
- worsening clients: minimum invoices, order, limit, overdue balance.

Component tests:

- the aging section, including when there is no trend data;
- the new table columns;
- the worsening-clients table;
- the notes.
