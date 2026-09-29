import { Component, lazy, Suspense, useMemo } from 'react';
import type { ReactNode } from 'react';
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

// A stale chunk after a deploy (or any render failure) must not take down the whole portal.
class ChartsErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-10 text-center text-slate-500">
        <p>No se pudieron cargar los gráficos.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold"
        >
          Recargar
        </button>
      </div>
    );
  }
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
        El año en curso se marca con * en los gráficos y como «parcial» en la tabla.
      </p>

      <ChartsErrorBoundary>
        <Suspense fallback={<SkeletonAnalytics cards={2} />}>
          <YearlyTrendCharts rows={rows} />
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
