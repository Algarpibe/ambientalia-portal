import { useMemo } from 'react';
import { useProfitabilityData } from './useProfitabilityData';
import { analyze, formatMoney, formatPercent } from './analysis';

// Widget: KPIs consolidados de rentabilidad (facturación, margen, % margen).
// Autocontenido — carga sus propios datos y no recibe props del Portal.

export default function SummaryWidget() {
  const { sales, products, loading, error } = useProfitabilityData();
  const summary = useMemo(() => analyze(sales, products), [sales, products]);

  if (loading) return <StateMsg>Cargando…</StateMsg>;
  if (error) return <StateMsg tone="error">{error}</StateMsg>;
  if (summary.totalSales === 0) return <StateMsg>Sin datos de rentabilidad.</StateMsg>;

  const cards = [
    { label: 'Facturación', value: formatMoney(summary.totalSales), tone: 'text-gray-900' },
    { label: 'Margen', value: formatMoney(summary.totalMargin), tone: summary.totalMargin >= 0 ? 'text-emerald-600' : 'text-red-600' },
    { label: '% Margen', value: formatPercent(summary.marginPercent), tone: summary.marginPercent >= 0 ? 'text-emerald-600' : 'text-red-600' },
  ];

  return (
    <div className="h-full grid grid-cols-1 sm:grid-cols-3 gap-3 content-center">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-3 flex flex-col justify-center">
          <span className="text-xs font-medium text-gray-500">{c.label}</span>
          <span className={`text-lg font-bold tracking-tight ${c.tone} truncate`}>{c.value}</span>
        </div>
      ))}
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
