import { Fragment, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCustomerItemSales, type RecordTypeIO } from '../api';
import { buildCustomerItemCompare } from '../lib/customer-item-compare';
import { formatUSD } from '../lib/format';
import { formatDeltaPct } from '../lib/compare';

export default function CustomerItemCompareTable({ tipo, anioA, anioB, search }: {
  tipo: RecordTypeIO; anioA: number; anioB: number; search: string;
}) {
  const qA = useQuery({ queryKey: ['customer-item-sales', tipo, anioA], queryFn: () => fetchCustomerItemSales({ tipo, anio: anioA }) });
  const qB = useQuery({ queryKey: ['customer-item-sales', tipo, anioB], queryFn: () => fetchCustomerItemSales({ tipo, anio: anioB }) });

  const groups = useMemo(() => {
    if (!qA.data || !qB.data) return [];
    const g = buildCustomerItemCompare(qA.data, qB.data);
    const q = search.trim().toLowerCase();
    if (!q) return g;
    return g.filter((grp) => grp.customer.toLowerCase().includes(q) ||
      grp.items.some((it) => (it.sku ?? '').toLowerCase().includes(q) || it.nombre.toLowerCase().includes(q)));
  }, [qA.data, qB.data, search]);

  if (qA.isLoading || qB.isLoading) return <div className="p-6 text-gray-500">Cargando comparación…</div>;
  if (qA.error || qB.error) return <div className="p-6 text-red-600">{((qA.error ?? qB.error) as Error).message}</div>;

  const deltaCls = (d: number | null) => `text-right ${(d ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`;

  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-3 py-2 text-left">SKU</th>
            <th className="px-3 py-2 text-left">Nombre</th>
            <th className="px-3 py-2 text-right">{anioA}</th>
            <th className="px-3 py-2 text-right">{anioB}</th>
            <th className="px-3 py-2 text-right">Δ%</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.customer}>
              <tr className="bg-gray-100 font-semibold border-t">
                <td className="px-3 py-2" colSpan={2}>{g.customer}</td>
                <td className="px-3 py-2 text-right">{formatUSD(g.totalA)}</td>
                <td className="px-3 py-2 text-right">{formatUSD(g.totalB)}</td>
                <td className={`px-3 py-2 ${deltaCls(g.deltaPct)}`}>{formatDeltaPct(g.deltaPct)}</td>
              </tr>
              {g.items.map((it, i) => (
                <tr key={`${g.customer}-${it.sku ?? it.nombre}-${i}`} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{it.sku ?? '—'}</td>
                  <td className="px-3 py-2">{it.nombre}</td>
                  <td className="px-3 py-2 text-right">{formatUSD(it.importeA)}</td>
                  <td className="px-3 py-2 text-right">{formatUSD(it.importeB)}</td>
                  <td className={`px-3 py-2 ${deltaCls(it.deltaPct)}`}>{formatDeltaPct(it.deltaPct)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
