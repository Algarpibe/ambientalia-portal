import { useMemo } from 'react';
import { useValuationData } from './useValuationData';
import { analyze, formatPercent, type Segment } from './analysis';

// Widget: distribución de la cartera por segmento de valoración. Barra apilada +
// leyenda, todo HTML + Tailwind (sin librerías de gráficos). Autocontenido.

const SEGMENT_COLOR: Record<Segment, string> = {
  Premium: 'bg-emerald-500',
  'Valioso Condicionado': 'bg-indigo-500',
  Estándar: 'bg-amber-500',
  Restringido: 'bg-red-500',
};

const SEGMENT_DOT: Record<Segment, string> = {
  Premium: 'bg-emerald-500',
  'Valioso Condicionado': 'bg-indigo-500',
  Estándar: 'bg-amber-500',
  Restringido: 'bg-red-500',
};

export default function SegmentDistributionWidget() {
  const { sales, master, invoices, payments, salesHistory, loading, error } = useValuationData();
  const summary = useMemo(
    () => analyze(sales, master, invoices, payments, salesHistory),
    [sales, master, invoices, payments, salesHistory],
  );

  if (loading) return <StateMsg>Cargando…</StateMsg>;
  if (error) return <StateMsg tone="error">{error}</StateMsg>;
  if (summary.totalClients === 0) return <StateMsg>Sin datos de valoración.</StateMsg>;

  const slices = summary.segments.filter((s) => s.count > 0);

  return (
    <div className="h-full flex flex-col justify-center gap-3">
      {/* Barra apilada */}
      <div className="flex w-full h-3 rounded-full overflow-hidden bg-gray-100">
        {slices.map((s) => (
          <div
            key={s.segment}
            className={SEGMENT_COLOR[s.segment]}
            style={{ width: `${Math.max(s.percent * 100, 1)}%` }}
            title={`${s.segment}: ${s.count} (${formatPercent(s.percent)})`}
          />
        ))}
      </div>

      {/* Leyenda / lista */}
      <ul className="flex flex-col gap-1.5">
        {summary.segments.map((s) => (
          <li key={s.segment} className="flex items-center gap-2 text-sm">
            <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${SEGMENT_DOT[s.segment]}`} />
            <span className="text-gray-600 truncate flex-1">{s.segment}</span>
            <span className="font-semibold text-gray-900 tabular-nums">{s.count}</span>
            <span className="text-gray-400 tabular-nums w-12 text-right">{formatPercent(s.percent)}</span>
          </li>
        ))}
      </ul>
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
