import { useMemo } from 'react';
import { useReconciliationData } from './useReconciliationData';
import { pendingByCustomer, formatMoney } from './analysis';

// Widget: ranking de clientes con mayor saldo pendiente por conciliar, con
// barras HTML (sin librerías de gráficos). Autocontenido, no recibe props.

const TOP_N = 6;

export default function TopPendingWidget() {
  const { invoices, loading, error } = useReconciliationData();
  const rows = useMemo(() => pendingByCustomer(invoices).slice(0, TOP_N), [invoices]);

  if (loading) return <StateMsg>Cargando…</StateMsg>;
  if (error) return <StateMsg tone="error">{error}</StateMsg>;
  if (rows.length === 0) return <StateMsg>Sin saldos pendientes.</StateMsg>;

  const max = rows[0]?.pending || 1;

  return (
    <div className="h-full flex flex-col gap-2 overflow-y-auto py-1">
      {rows.map((r) => (
        <div key={r.name} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-gray-700 truncate" title={r.name}>{r.name}</span>
            <span className="text-xs font-bold text-red-600 whitespace-nowrap">{formatMoney(r.pending)}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-red-500"
              style={{ width: `${Math.max(4, (r.pending / max) * 100)}%` }}
            />
          </div>
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
