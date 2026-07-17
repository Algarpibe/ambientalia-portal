import { useMemo } from 'react';
import { useInventoryData } from './useInventoryData';
import { analyze, formatUsd, formatNumber } from './analysis';

// Widget: KPIs consolidados de inventario (SKUs, en riesgo, exceso, capital).
// Autocontenido — carga sus propios datos y no recibe props del Portal.

export default function SummaryWidget() {
  const data = useInventoryData();
  const summary = useMemo(() => analyze(data), [data]);

  if (data.loading) return <StateMsg>Cargando…</StateMsg>;
  if (data.error) return <StateMsg tone="error">{data.error}</StateMsg>;
  if (summary.totalSkus === 0) return <StateMsg>Sin datos de inventario.</StateMsg>;

  const cards = [
    { label: 'SKUs analizados', value: formatNumber(summary.totalSkus), tone: 'text-slate-900' },
    { label: 'En riesgo de quiebre', value: formatNumber(summary.atRiskCount), tone: summary.atRiskCount > 0 ? 'text-red-600' : 'text-emerald-600' },
    { label: 'Con exceso', value: formatNumber(summary.overstockCount), tone: summary.overstockCount > 0 ? 'text-amber-600' : 'text-slate-900' },
    { label: 'Capital en inventario', value: formatUsd(summary.inventoryValue), tone: 'text-slate-900' },
  ];

  return (
    <div className="h-full grid grid-cols-2 gap-3 content-center">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-3 flex flex-col justify-center">
          <span className="text-xs font-medium text-slate-500">{c.label}</span>
          <span className={`text-lg font-bold tracking-tight ${c.tone} truncate`}>{c.value}</span>
        </div>
      ))}
    </div>
  );
}

function StateMsg({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div className={`h-full flex items-center justify-center text-sm ${tone === 'error' ? 'text-red-500' : 'text-slate-400'}`}>
      {children}
    </div>
  );
}
