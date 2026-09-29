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
