import { useMemo } from 'react';
import { useReconciliationData } from './useReconciliationData';
import { summarize, formatMoney, formatPercent } from './analysis';

// Widget: KPIs consolidados de conciliación (facturado, conciliado, pendiente,
// % conciliado). Autocontenido — carga sus propios datos y no recibe props.

export default function SummaryWidget() {
  const { invoices, loading, error } = useReconciliationData();
  const summary = useMemo(() => summarize(invoices), [invoices]);

  if (loading) return <StateMsg>Cargando…</StateMsg>;
  if (error) return <StateMsg tone="error">{error}</StateMsg>;
  if (summary.invoiceCount === 0) return <StateMsg>Sin datos de conciliación.</StateMsg>;

  const cards = [
    { label: 'Facturado', value: formatMoney(summary.totalInvoiced), tone: 'text-gray-900' },
    { label: 'Conciliado', value: formatMoney(summary.totalReconciled), tone: 'text-emerald-600' },
    { label: 'Pendiente', value: formatMoney(summary.totalPending), tone: summary.totalPending > 0 ? 'text-red-600' : 'text-emerald-600' },
    { label: '% Conciliado', value: formatPercent(summary.reconciledPercent), tone: 'text-indigo-600' },
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
