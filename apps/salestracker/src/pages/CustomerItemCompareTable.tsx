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

  if (qA.isLoading || qB.isLoading) return <div className="p-6 text-[#6E6B64]">Cargando comparación…</div>;
  if (qA.error || qB.error) return <div className="p-6 text-red-600">{((qA.error ?? qB.error) as Error).message}</div>;

  const deltaColor = (d: number | null) => ((d ?? 0) >= 0 ? '#346538' : '#9F2F2D');

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
          {groups.map((g) => (
            <Fragment key={g.customer}>
              <tr className="group">
                <td colSpan={2}>{g.customer}</td>
                <td className="num">{formatUSD(g.totalA)}</td>
                <td className="num">{formatUSD(g.totalB)}</td>
                <td className="num" style={{ color: deltaColor(g.deltaPct) }}>{formatDeltaPct(g.deltaPct)}</td>
              </tr>
              {g.items.map((it, i) => (
                <tr key={`${g.customer}-${it.sku ?? it.nombre}-${i}`}>
                  <td className="font-mono text-xs">{it.sku ?? '—'}</td>
                  <td>{it.nombre}</td>
                  <td className="num">{formatUSD(it.importeA)}</td>
                  <td className="num">{formatUSD(it.importeB)}</td>
                  <td className="num" style={{ color: deltaColor(it.deltaPct) }}>{formatDeltaPct(it.deltaPct)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
