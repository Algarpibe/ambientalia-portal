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
