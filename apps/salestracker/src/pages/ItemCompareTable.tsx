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

  if (qA.isLoading || qB.isLoading) return <div className="p-6 text-[#6E6B64]">Cargando comparación…</div>;
  if (qA.error || qB.error) return <div className="p-6 text-red-600">{((qA.error ?? qB.error) as Error).message}</div>;

  return (
    <div className="st-table-wrap">
      <table className="st-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Nombre</th>
            <th className="num">{anioA}</th>
            <th className="num">{anioB}</th>
            <th className="num">Δ%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId}>
              <td>{r.sku ?? '—'}</td>
              <td>{r.nombre}</td>
              <td className="num">{formatUSD(r.importeA)}</td>
              <td className="num">{formatUSD(r.importeB)}</td>
              <td className="num" style={{ color: (r.deltaPct ?? 0) >= 0 ? '#346538' : '#9F2F2D' }}>{formatDeltaPct(r.deltaPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
