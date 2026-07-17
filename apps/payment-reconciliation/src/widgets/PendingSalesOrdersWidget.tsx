import { useMemo } from 'react';
import { usePendingSalesOrders } from './usePendingSalesOrders';
import { formatMoney } from './analysis';

// Widget: órdenes de venta pendientes de facturar (sin facturar + parcial).
// Compacto: KPIs arriba + top órdenes por valor pendiente. Autocontenido.

const MAX_ROWS = 6;

export default function PendingSalesOrdersWidget() {
  const { orders, loading, error } = usePendingSalesOrders();

  const { totalPending, partialCount, top } = useMemo(() => {
    const totalPending = orders.reduce((s, o) => s + o.pending, 0);
    const partialCount = orders.filter((o) => o.status === 'partially_invoiced').length;
    const top = [...orders].sort((a, b) => b.pending - a.pending).slice(0, MAX_ROWS);
    return { totalPending, partialCount, top };
  }, [orders]);

  if (loading) return <StateMsg>Cargando…</StateMsg>;
  if (error) return <StateMsg tone="error">{error}</StateMsg>;
  if (orders.length === 0) return <StateMsg>No hay órdenes por facturar. 🎉</StateMsg>;

  const maxPending = top[0]?.pending || 1;

  return (
    <div className="h-full flex flex-col">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 mb-3 shrink-0">
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
          <div className="text-xs text-gray-500">Órdenes por facturar</div>
          <div className="text-lg font-bold text-gray-900">
            {orders.length}
            <span className="text-xs font-medium text-amber-600 ml-1">({partialCount} parciales)</span>
          </div>
        </div>
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
          <div className="text-xs text-gray-500">Valor pendiente</div>
          <div className="text-lg font-bold text-indigo-700 truncate">{formatMoney(totalPending)}</div>
        </div>
      </div>

      {/* Top órdenes por pendiente */}
      <ul className="flex-1 flex flex-col gap-2 overflow-y-auto pr-1">
        {top.map((o) => (
          <li key={o.salesorder_number} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-slate-700 truncate" title={o.customer_name ?? ''}>
                {o.salesorder_number} · {o.customer_name ?? '—'}
              </span>
              <span className="shrink-0 font-semibold text-indigo-700 tabular-nums">{formatMoney(o.pending)}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full ${o.status === 'partially_invoiced' ? 'bg-amber-500' : 'bg-indigo-500'}`}
                style={{ width: `${Math.max(4, Math.round((o.pending / maxPending) * 100))}%` }}
              />
            </div>
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
