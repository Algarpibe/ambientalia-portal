import { useMemo } from 'react';
import { useInventoryData } from './useInventoryData';
import { analyze, formatNumber } from './analysis';

// Widget: lista de los SKUs con mayor riesgo de quiebre (Urgente / Pedir), con una
// barra HTML que muestra qué fracción del punto de pedido cubre el stock actual.
// Autocontenido — sin props del Portal, sin librerías de gráficos.

const MAX_ROWS = 8;

export default function RiskListWidget() {
  const data = useInventoryData();
  const summary = useMemo(() => analyze(data), [data]);

  if (data.loading) return <StateMsg>Cargando…</StateMsg>;
  if (data.error) return <StateMsg tone="error">{data.error}</StateMsg>;
  if (summary.totalSkus === 0) return <StateMsg>Sin datos de inventario.</StateMsg>;
  if (summary.atRisk.length === 0) return <StateMsg>Sin artículos en riesgo de quiebre.</StateMsg>;

  const rows = summary.atRisk.slice(0, MAX_ROWS);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">SKUs en riesgo de quiebre</span>
        <span className="text-xs font-medium text-red-600">{formatNumber(summary.atRiskCount)} en total</span>
      </div>
      <ul className="flex-1 flex flex-col gap-2 overflow-y-auto pr-1">
        {rows.map((r) => {
          const pct = Math.round(r.coverageFraction * 100);
          const isUrgent = r.status === 'Urgente';
          return (
            <li key={r.sku} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-700 truncate" title={`${r.sku} · ${r.itemName}`}>
                  {r.itemName || r.sku}
                </span>
                <span className={`shrink-0 font-semibold ${isUrgent ? 'text-red-600' : 'text-amber-600'}`}>
                  {isUrgent ? 'Urgente' : `Faltan ${formatNumber(r.shortfall)}`}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${isUrgent ? 'bg-red-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.max(4, pct)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
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
