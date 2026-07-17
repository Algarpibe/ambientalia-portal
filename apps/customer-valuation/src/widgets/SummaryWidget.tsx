import { useMemo } from 'react';
import { useValuationData } from './useValuationData';
import { analyze, formatMoney, formatPercent } from './analysis';

// Widget: KPIs consolidados de valoración de clientes (clientes, Premium, alto
// riesgo, valor total). Autocontenido — carga sus propios datos y no recibe props.

export default function SummaryWidget() {
  const { sales, master, invoices, payments, salesHistory, loading, error } = useValuationData();
  const summary = useMemo(
    () => analyze(sales, master, invoices, payments, salesHistory),
    [sales, master, invoices, payments, salesHistory],
  );

  if (loading) return <StateMsg>Cargando…</StateMsg>;
  if (error) return <StateMsg tone="error">{error}</StateMsg>;
  if (summary.totalClients === 0) return <StateMsg>Sin datos de valoración.</StateMsg>;

  const cards = [
    { label: 'Clientes', value: String(summary.totalClients), tone: 'text-gray-900' },
    { label: 'Premium', value: `${summary.premiumCount} · ${formatPercent(summary.premiumPercent)}`, tone: 'text-emerald-600' },
    { label: 'Alto Riesgo', value: String(summary.highRiskCount), tone: summary.highRiskCount > 0 ? 'text-red-600' : 'text-gray-900' },
    { label: 'Valor Total', value: formatMoney(summary.totalSales), tone: 'text-gray-900' },
  ];

  return (
    <div className="h-full grid grid-cols-2 gap-3 content-center">
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
