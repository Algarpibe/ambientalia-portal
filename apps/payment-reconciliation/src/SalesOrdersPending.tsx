import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useSortable, sortArrow } from './useSortable';
import { useColumnOrder } from './useColumnOrder';
import ColumnOrderMenu from './ColumnOrderMenu';
import DetalleModal from './DetalleModal';

// Vista "Órdenes por Facturar": OV pendientes de facturar (sin facturar + parcial),
// desde el endpoint hub-api /api/sales-orders/pending. Autocontenida.

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

import { authHeaders } from '@suite/auth-client';

interface PendingOrder {
  salesorder_number: string;
  date: string;
  customer_name: string | null;
  status: string;
  currency_code: string | null;
  total: number;
  pending: number;
  shipment_date: string | null;
}

type StatusFilter = 'all' | 'unbilled' | 'partial';

const money = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);

const fmtDate = (iso: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('T')[0].split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

const isPartial = (status: string) => status === 'partially_invoiced';

// Columnas de la tabla. `key` es el campo por el que ordena (el subyacente, no el
// texto formateado): `date`/`shipment_date` son ISO → orden lexicográfico = cronológico.
// `render` genera la celda (para poder reordenar columnas: encabezado y cuerpo se
// pintan siguiendo el mismo orden).
interface Col {
  key: keyof PendingOrder;
  label: string;
  align: 'left' | 'right';
  cellClass?: string;
  render: (o: PendingOrder) => ReactNode;
  title?: (o: PendingOrder) => string;
}

const COLUMNS: Col[] = [
  { key: 'date', label: 'Fecha', align: 'left', cellClass: 'text-slate-500', render: (o) => fmtDate(o.date) },
  { key: 'salesorder_number', label: 'Orden de Venta', align: 'left', cellClass: 'font-semibold text-indigo-700', render: (o) => o.salesorder_number },
  { key: 'customer_name', label: 'Cliente', align: 'left', cellClass: 'text-slate-700 max-w-[240px] truncate', render: (o) => o.customer_name ?? '—', title: (o) => o.customer_name ?? '' },
  {
    key: 'status', label: 'Estado', align: 'left',
    render: (o) => {
      const partial = isPartial(o.status);
      return (
        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${partial ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
          {partial ? '◐ Parcial' : '○ Sin facturar'}
        </span>
      );
    },
  },
  { key: 'total', label: 'Total', align: 'right', cellClass: 'tabular-nums text-slate-700', render: (o) => money(o.total) },
  { key: 'pending', label: 'Pendiente por Facturar', align: 'right', cellClass: 'tabular-nums font-semibold text-indigo-700', render: (o) => money(o.pending) },
  { key: 'shipment_date', label: 'Entrega', align: 'left', cellClass: 'text-slate-500', render: (o) => fmtDate(o.shipment_date) },
];

// `bare`: sin la tarjeta exterior y ocupando todo el alto — para embeberla en una
// celda del dashboard (el WidgetCell ya aporta tarjeta y padding). Sin `bare` se
// usa como vista de pestaña en la app, con su propia tarjeta.
export default function SalesOrdersPending({ bare = false }: { bare?: boolean }) {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<string>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [detalleOV, setDetalleOV] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!API_BASE) throw new Error('Falta VITE_HUB_API_URL');
      const res = await fetch(`${API_BASE}/api/sales-orders/pending`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.orders)) throw new Error('Formato inesperado del hub');
      setOrders(data.orders);
    } catch (err) {
      setError('No se pudieron cargar las órdenes por facturar.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clients = useMemo(
    () => [...new Set(orders.map((o) => o.customer_name).filter((c): c is string => !!c))].sort(),
    [orders],
  );

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (client !== 'all' && o.customer_name !== client) return false;
      if (status === 'partial' && !isPartial(o.status)) return false;
      if (status === 'unbilled' && isPartial(o.status)) return false;
      return true;
    });
  }, [orders, client, status]);

  const totalPending = useMemo(() => filtered.reduce((s, o) => s + o.pending, 0), [filtered]);

  // Orden por defecto: pendiente por facturar descendente (como llega del endpoint).
  const { sorted, sortKey, sortDir, toggle } = useSortable<PendingOrder>(filtered, 'pending', 'desc');
  const { order, move } = useColumnOrder('cols_sales_orders_pending', COLUMNS.map((c) => c.key));
  const colMap = useMemo(() => Object.fromEntries(COLUMNS.map((c) => [c.key, c])) as Record<string, Col>, []);
  const orderedCols = order.map((k) => colMap[k]).filter(Boolean);

  const stateBox = 'flex flex-col items-center justify-center h-full min-h-[240px] gap-4';

  if (loading) {
    return (
      <div className={stateBox}>
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        <span className="text-slate-500 font-medium">Cargando órdenes por facturar…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={stateBox}>
        <div className="p-4 bg-red-50 text-red-600 rounded-xl flex items-center gap-2 text-sm border border-red-100">
          <AlertCircle size={18} /> {error}
        </div>
        <button onClick={load} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold">
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col overflow-hidden ${
        bare ? 'h-full' : 'bg-white rounded-2xl border border-slate-100 shadow-soft'
      }`}
    >
      {/* Controles */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-100 shrink-0">
        <select
          value={client}
          onChange={(e) => setClient(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none max-w-xs"
        >
          <option value="all">Todos los clientes ({clients.length})</option>
          {clients.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none"
        >
          <option value="all">Todos los estados</option>
          <option value="unbilled">Sin facturar</option>
          <option value="partial">Parcial</option>
        </select>

        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="text-slate-500">
            <strong className="text-slate-800">{filtered.length}</strong> órdenes
          </span>
          <span className="text-slate-500">
            Pendiente por facturar: <strong className="text-indigo-700">{money(totalPending)}</strong>
          </span>
          <ColumnOrderMenu columns={orderedCols.map((c) => ({ key: String(c.key), label: c.label }))} onMove={move} />
          <button onClick={load} title="Actualizar" className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-sm border-collapse min-w-[820px]">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr>
              {orderedCols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggle(c.key)}
                  title={`Ordenar por ${c.label}`}
                  className={`px-4 py-3 font-semibold text-slate-500 whitespace-nowrap cursor-pointer select-none hover:text-slate-700 ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {c.label} <span className="text-slate-300">{sortArrow(sortKey === c.key, sortDir)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={orderedCols.length} className="px-4 py-10 text-center text-slate-400">
                  No hay órdenes por facturar con estos filtros.
                </td>
              </tr>
            ) : (
              sorted.map((o) => (
                <tr key={o.salesorder_number} onClick={() => setDetalleOV(o.salesorder_number)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                  {orderedCols.map((c) => (
                    <td
                      key={c.key}
                      title={c.title?.(o)}
                      className={`px-4 py-3 whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.cellClass ?? ''}`}
                    >
                      {c.render(o)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {detalleOV && <DetalleModal tipo="ov" numero={detalleOV} onClose={() => setDetalleOV(null)} />}
    </div>
  );
}
