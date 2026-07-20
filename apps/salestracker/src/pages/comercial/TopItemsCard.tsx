import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchItemSales, type RecordTypeIO } from '../../api';
import { topItems } from '../../lib/analytics-comercial';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import ChartCard from './ChartCard';

export default function TopItemsCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const [metric, setMetric] = useState<'importe' | 'cantidad'>('importe');
  const q = useQuery({
    queryKey: ['item-sales', tipo, `${year}-01-01`, `${year}-12-31`],
    queryFn: () => fetchItemSales({ tipo, desde: `${year}-01-01`, hasta: `${year}-12-31` }),
  });
  const data = topItems(q.data ?? [], metric, 15);
  const btn = (active: boolean) =>
    `px-2.5 py-1 text-xs font-medium rounded-md border ${active ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-600 hover:bg-gray-100'}`;
  return (
    <ChartCard title="Top artículos" subtitle="Los 15 artículos con más ventas del año.">
      <div className="flex gap-2 mb-3">
        <button type="button" className={btn(metric === 'importe')} onClick={() => setMetric('importe')}>Importe</button>
        <button type="button" className={btn(metric === 'cantidad')} onClick={() => setMetric('cantidad')}>Cantidad</button>
      </div>
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : data.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={420}>
          <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
            <XAxis type="number" dataKey={metric} tickFormatter={(v) => (metric === 'importe' ? formatCompactUSD(Number(v)) : Number(v).toLocaleString('es-CO'))} />
            <YAxis type="category" dataKey="nombre" width={180} tick={{ fontSize: 11 }} interval={0} />
            <Tooltip formatter={(v) => (metric === 'importe' ? formatUSD(Number(v)) : Number(v).toLocaleString('es-CO'))} />
            <Bar dataKey={metric} fill="#0ea5e9" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
