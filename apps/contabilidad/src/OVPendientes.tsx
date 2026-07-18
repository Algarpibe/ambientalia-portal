import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, PackageOpen } from 'lucide-react';
import { fetchOVPendientes, type PendingSalesOrder } from './api';
import { formatCOP } from './format';

type SortKey = keyof PendingSalesOrder;

// Etiqueta + color por estado de la OV (los que devuelve getPendingSalesOrders).
const ESTADO: Record<string, { texto: string; cls: string }> = {
  open: { texto: 'Abierta', cls: 'bg-blue-50 text-blue-700' },
  overdue: { texto: 'Vencida', cls: 'bg-red-50 text-red-700' },
  partially_invoiced: { texto: 'Parcial', cls: 'bg-amber-50 text-amber-700' },
};
const estadoDe = (s: string) => ESTADO[s] ?? { texto: s, cls: 'bg-gray-100 text-gray-600' };

const COLS: { key: SortKey; label: string; align: 'left' | 'right'; kind: 'text' | 'money' | 'estado' }[] = [
  { key: 'salesorder_number', label: 'OV', align: 'left', kind: 'text' },
  { key: 'customer_name', label: 'CLIENTE', align: 'left', kind: 'text' },
  { key: 'date', label: 'FECHA OV', align: 'left', kind: 'text' },
  { key: 'shipment_date', label: 'ENTREGA', align: 'left', kind: 'text' },
  { key: 'total', label: 'TOTAL ($)', align: 'right', kind: 'money' },
  { key: 'pending', label: 'POR FACTURAR ($)', align: 'right', kind: 'money' },
  { key: 'status', label: 'ESTADO', align: 'left', kind: 'estado' },
];

export default function OVPendientes() {
  const [ordenes, setOrdenes] = useState<PendingSalesOrder[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState('todos');
  const [filtro, setFiltro] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'pending', dir: -1 });

  useEffect(() => {
    let vivo = true;
    fetchOVPendientes()
      .then((o) => vivo && (setOrdenes(o), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, []);

  const filtradas = useMemo(() => {
    if (!ordenes) return [];
    const q = filtro.trim().toLowerCase();
    const arr = ordenes.filter((o) => {
      if (estado !== 'todos' && o.status !== estado) return false;
      if (q && !(o.salesorder_number.toLowerCase().includes(q) || (o.customer_name ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
    arr.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
      return String(av ?? '').localeCompare(String(bv ?? ''), 'es') * sort.dir;
    });
    return arr;
  }, [ordenes, estado, filtro, sort]);

  const totales = useMemo(
    () => filtradas.reduce((a, o) => ({ n: a.n + 1, total: a.total + o.total, pending: a.pending + o.pending }), { n: 0, total: 0, pending: 0 }),
    [filtradas],
  );

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'pending' || key === 'total' ? -1 : 1 }));

  return (
    <section className="mt-10 space-y-3">
      <div className="flex items-center gap-2">
        <PackageOpen className="h-5 w-5 text-amber-600" />
        <h2 className="text-sm font-semibold text-gray-700">OV pendientes de facturar</h2>
      </div>

      {cargando && (
        <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Cargando OV…</div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {ordenes && !cargando && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select className="rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="todos">Todos los estados</option>
              <option value="open">Abiertas</option>
              <option value="overdue">Vencidas</option>
              <option value="partially_invoiced">Parciales</option>
            </select>
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar OV o cliente…" className="w-64 rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none" />
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-gray-500">{totales.n} OV</span>
              <span className="text-gray-700">Total: <b className="tabular-nums">{formatCOP(totales.total)}</b></span>
              <span className="text-gray-700">Por facturar: <b className="tabular-nums">{formatCOP(totales.pending)}</b></span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-soft">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} onClick={() => toggleSort(c.key)} className={`cursor-pointer select-none px-2 py-2 font-semibold whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} hover:text-gray-900`}>
                      {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtradas.map((o) => (
                  <tr key={o.salesorder_number} className="hover:bg-amber-50/40">
                    {COLS.map((c) => {
                      const v = o[c.key];
                      if (c.kind === 'money') return <td key={c.key} className="px-2 py-1 text-right tabular-nums">{formatCOP(v as number)}</td>;
                      if (c.kind === 'estado') {
                        const e = estadoDe(o.status);
                        return <td key={c.key} className="px-2 py-1"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${e.cls}`}>{e.texto}</span></td>;
                      }
                      return <td key={c.key} className="px-2 py-1 whitespace-nowrap">{String(v ?? '') || '—'}</td>;
                    })}
                  </tr>
                ))}
                {filtradas.length === 0 && (
                  <tr><td colSpan={COLS.length} className="px-2 py-4 text-center text-gray-400">Sin OV pendientes con estos filtros.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
