import { useMemo, useState } from 'react';
import { useReconciliationData } from './useReconciliationData';
import { openInvoices, formatMoney, STATUS_LABEL, type PaymentStatus } from './analysis';

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
              {['Factura', 'Cliente', 'Fecha', 'Vencimiento'].map((h) => (
                <th key={h} className="px-2 py-1.5 text-left font-semibold text-gray-500 border-b border-gray-200 whitespace-nowrap">
                  {h}
                </th>
              ))}
              {['Total', 'Saldo'].map((h) => (
                <th key={h} className="px-2 py-1.5 text-right font-semibold text-gray-500 border-b border-gray-200 whitespace-nowrap">
                  {h}
                </th>
              ))}
              <th className="px-2 py-1.5 text-left font-semibold text-gray-500 border-b border-gray-200 whitespace-nowrap">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-8 text-center text-gray-400">
                  No hay facturas con estos filtros.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={`${r.invoiceNumber}-${i}`} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-2 py-1.5 font-semibold text-gray-800 whitespace-nowrap">{r.invoiceNumber}</td>
                <td className="px-2 py-1.5 text-gray-700 max-w-[180px] truncate" title={r.clientName}>{r.clientName}</td>
                <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{r.invoiceDate}</td>
                <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{r.dueDate}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-700 whitespace-nowrap">{formatMoney(r.total)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-red-600 whitespace-nowrap">{formatMoney(r.balance)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <span className={`inline-block px-2 py-0.5 rounded-full font-medium ${CHIP[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                  {r.status === 'partial' && (
                    <span className="ml-1.5 text-gray-400 tabular-nums">{Math.round(r.paidPercent * 100)}%</span>
                  )}
                </td>
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
