import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useReconciliationData } from './useReconciliationData';
import { openInvoices, formatMoney, STATUS_LABEL, type PaymentStatus, type OpenInvoiceRow } from './analysis';
import { useSortable, sortArrow } from '../useSortable';
import { useColumnOrder } from '../useColumnOrder';

// Widget: facturas de la pestaña Conciliación con estado de pago Pendiente o
// Parcial (las que aún tienen saldo). Autocontenido: carga sus propios datos y
// no recibe props del Portal. Con filtros de cliente y rango de fecha de factura.

const STATUSES: PaymentStatus[] = ['pending', 'partial'];

const CHIP: Record<PaymentStatus, string> = {
  paid: 'bg-emerald-50 text-emerald-700',
  partial: 'bg-amber-50 text-amber-700',
  pending: 'bg-slate-100 text-slate-600',
};

// Un input date 'YYYY-MM-DD' a ms (inicio del día). NaN si vacío.
const dayMs = (v: string) => (v ? new Date(`${v}T00:00:00`).getTime() : NaN);

// Columnas. `key` es el campo por el que ORDENA: 'Fecha' ordena por invoiceTime y
// 'Vencimiento' por dueTime (ms), aunque muestren el texto ya formateado. `render`
// genera la celda (para poder reordenar columnas).
interface Col {
  key: keyof OpenInvoiceRow;
  label: string;
  align: 'left' | 'right';
  cellClass?: string;
  render: (r: OpenInvoiceRow) => ReactNode;
  title?: (r: OpenInvoiceRow) => string;
}

const COLUMNS: Col[] = [
  { key: 'invoiceNumber', label: 'Factura', align: 'left', cellClass: 'font-semibold text-gray-800', render: (r) => r.invoiceNumber },
  { key: 'clientName', label: 'Cliente', align: 'left', cellClass: 'text-gray-700 max-w-[180px] truncate', render: (r) => r.clientName, title: (r) => r.clientName },
  { key: 'invoiceTime', label: 'Fecha', align: 'left', cellClass: 'text-gray-500', render: (r) => r.invoiceDate },
  { key: 'dueTime', label: 'Vencimiento', align: 'left', cellClass: 'text-gray-500', render: (r) => r.dueDate },
  { key: 'total', label: 'Total', align: 'right', cellClass: 'tabular-nums text-gray-700', render: (r) => formatMoney(r.total) },
  { key: 'balance', label: 'Saldo', align: 'right', cellClass: 'tabular-nums font-semibold text-red-600', render: (r) => formatMoney(r.balance) },
  {
    key: 'status', label: 'Estado', align: 'left',
    render: (r) => (
      <>
        <span className={`inline-block px-2 py-0.5 rounded-full font-medium ${CHIP[r.status]}`}>{STATUS_LABEL[r.status]}</span>
        {r.status === 'partial' && <span className="ml-1.5 text-gray-400 tabular-nums">{Math.round(r.paidPercent * 100)}%</span>}
      </>
    ),
  },
];

export default function OpenInvoicesWidget() {
  const { invoices, loading, error } = useReconciliationData();
  const allRows = useMemo(() => openInvoices(invoices, STATUSES), [invoices]);

  const [client, setClient] = useState<string>('all');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  const clients = useMemo(
    () => [...new Set(allRows.map((r) => r.clientName))].sort(),
    [allRows],
  );

  const rows = useMemo(() => {
    const fromMs = dayMs(from);
    const toMs = dayMs(to) + 24 * 60 * 60 * 1000 - 1; // incluye todo el día 'hasta'
    return allRows.filter((r) => {
      if (client !== 'all' && r.clientName !== client) return false;
      if (!Number.isNaN(fromMs) && !(r.invoiceTime >= fromMs)) return false;
      if (!Number.isNaN(dayMs(to)) && !(r.invoiceTime <= toMs)) return false;
      return true;
    });
  }, [allRows, client, from, to]);

  const totalPending = useMemo(() => rows.reduce((s, r) => s + r.balance, 0), [rows]);

  // Orden por defecto: vencimiento ascendente (lo más vencido primero).
  const { sorted, sortKey, sortDir, toggle } = useSortable<OpenInvoiceRow>(rows, 'dueTime', 'asc');
  const { order, dragProps, dragging } = useColumnOrder('cols_open_invoices', COLUMNS.map((c) => c.key));
  const colMap = useMemo(() => Object.fromEntries(COLUMNS.map((c) => [c.key, c])) as Record<string, Col>, []);
  const orderedCols = order.map((k) => colMap[k]).filter(Boolean);

  if (loading) return <StateMsg>Cargando…</StateMsg>;
  if (error) return <StateMsg tone="error">{error}</StateMsg>;
  if (allRows.length === 0) return <StateMsg>No hay facturas pendientes ni parciales. 🎉</StateMsg>;

  const inputCls = 'text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none';

  return (
    <div className="h-full flex flex-col">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-2 shrink-0">
        <select aria-label="Filtrar por cliente" value={client} onChange={(e) => setClient(e.target.value)} className={`${inputCls} max-w-[45%]`}>
          <option value="all">Todos los clientes ({clients.length})</option>
          {clients.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="text-xs text-gray-400 flex items-center gap-1">
          Desde <input type="date" aria-label="Fecha desde" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="text-xs text-gray-400 flex items-center gap-1">
          Hasta <input type="date" aria-label="Fecha hasta" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </label>
        {(client !== 'all' || from || to) && (
          <button
            onClick={() => { setClient('all'); setFrom(''); setTo(''); }}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Limpiar
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 mb-2 shrink-0 text-xs">
        <span className="text-gray-500">
          <strong className="text-gray-800">{rows.length}</strong> facturas con saldo
        </span>
        <span className="text-gray-500">
          Pendiente: <strong className="text-red-600">{formatMoney(totalPending)}</strong>
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs border-collapse min-w-[620px]">
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr>
              {orderedCols.map((c) => (
                <th
                  key={c.key}
                  {...dragProps(c.key)}
                  onClick={() => toggle(c.key)}
                  title="Clic para ordenar · arrastra para mover la columna"
                  className={`px-2 py-1.5 font-semibold text-gray-500 border-b border-gray-200 whitespace-nowrap cursor-move select-none hover:text-gray-700 ${c.align === 'right' ? 'text-right' : 'text-left'} ${dragging === c.key ? 'opacity-40' : ''}`}
                >
                  {c.label} <span className="text-gray-300">{sortArrow(sortKey === c.key, sortDir)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={orderedCols.length} className="px-2 py-8 text-center text-gray-400">
                  No hay facturas con estos filtros.
                </td>
              </tr>
            )}
            {sorted.map((r, i) => (
              <tr key={`${r.invoiceNumber}-${i}`} className="border-b border-gray-100 hover:bg-gray-50">
                {orderedCols.map((c) => (
                  <td
                    key={c.key}
                    title={c.title?.(r)}
                    className={`px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.cellClass ?? ''}`}
                  >
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
