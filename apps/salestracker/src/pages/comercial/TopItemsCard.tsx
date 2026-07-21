import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchItemSales, type RecordTypeIO } from '../../api';
import { topItems } from '../../lib/analytics-comercial';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import { CHART } from '../../ui/warmTheme';
import { tooltip } from '../../ui/ChartTooltip';
import ChartCard from './ChartCard';

export default function TopItemsCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const [metric, setMetric] = useState<'importe' | 'cantidad'>('importe');
  const q = useQuery({
    queryKey: ['item-sales', tipo, `${year}-01-01`, `${year}-12-31`],
    queryFn: () => fetchItemSales({ tipo, desde: `${year}-01-01`, hasta: `${year}-12-31` }),
  });
  const data = topItems(q.data ?? [], metric, 15);
  const fmt = (n: number) => (metric === 'importe' ? formatUSD(n) : Number(n).toLocaleString('es-CO'));
  return (
    <ChartCard title="Top artículos" subtitle="Los 15 artículos con más ventas del año.">
      <div className="st-seg flat mb-3">
        <button type="button" aria-pressed={metric === 'importe'} onClick={() => setMetric('importe')}>Importe</button>
        <button type="button" aria-pressed={metric === 'cantidad'} onClick={() => setMetric('cantidad')}>Cantidad</button>
      </div>
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : data.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={420}>
          <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis type="number" dataKey={metric} tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} tickFormatter={(v) => (metric === 'importe' ? formatCompactUSD(Number(v)) : Number(v).toLocaleString('es-CO'))} />
            <YAxis type="category" dataKey="nombre" width={180} tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} interval={0} />
            <Tooltip content={tooltip(fmt)} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            <Bar dataKey={metric} fill={CHART.fac} radius={[0, 5, 5, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
