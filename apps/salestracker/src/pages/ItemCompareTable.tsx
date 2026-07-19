import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchItemSales, type RecordTypeIO } from '../api';
import { buildItemCompare } from '../lib/item-compare';
import { formatUSD } from '../lib/format';
import { formatDeltaPct } from '../lib/compare';

export default function ItemCompareTable({ tipo, anioA, anioB, search }: {
  tipo: RecordTypeIO; anioA: number; anioB: number; search: string;
}) {
  const qA = useQuery({ queryKey: ['item-sales', tipo, anioA], queryFn: () => fetchItemSales({ tipo, desde: `${anioA}-01-01`, hasta: `${anioA}-12-31` }) });
  const qB = useQuery({ queryKey: ['item-sales', tipo, anioB], queryFn: () => fetchItemSales({ tipo, desde: `${anioB}-01-01`, hasta: `${anioB}-12-31` }) });

  const rows = useMemo(() => {
    if (!qA.data || !qB.data) return [];
    const q = search.trim().toLowerCase();
    return buildItemCompare(qA.data, qB.data)
      .filter((r) => !q || (r.sku ?? '').toLowerCase().includes(q) || r.nombre.toLowerCase().includes(q))
      .sort((a, b) => b.importeA - a.importeA);
  }, [qA.data, qB.data, search]);

  if (qA.isLoading || qB.isLoading) return <div className="p-6 text-gray-500">Cargando comparación…</div>;
  if (qA.error || qB.error) return <div className="p-6 text-red-600">{String((qA.error ?? qB.error) as Error)}</div>;

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
          {rows.map((r) => (
            <tr key={r.itemId} className="border-t">
              <td className="px-3 py-2">{r.sku ?? '—'}</td>
              <td className="px-3 py-2">{r.nombre}</td>
              <td className="px-3 py-2 text-right">{formatUSD(r.importeA)}</td>
              <td className="px-3 py-2 text-right">{formatUSD(r.importeB)}</td>
              <td className={`px-3 py-2 text-right ${(r.deltaPct ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{formatDeltaPct(r.deltaPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
