import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchMarginByItem, type RecordTypeIO } from '../../api';
import { buildMarginItems } from '../../lib/analytics-margin';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import { CHART } from '../../ui/warmTheme';
import { tooltip } from '../../ui/ChartTooltip';
import ChartCard from '../comercial/ChartCard';
import AmountToggle, { type AmountMode } from './AmountToggle';

export default function MarginByItemCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['margin-item', tipo, year], queryFn: () => fetchMarginByItem({ tipo, anio: year }) });
  const [mode, setMode] = useState<AmountMode>('money');
  const items = buildMarginItems(q.data ?? []);
  const top = (mode === 'pct' ? [...items].sort((a, b) => b.margenPct - a.margenPct || a.label.localeCompare(b.label)) : items).slice(0, 15);

  return (
    <ChartCard title={`Margen por artículo ${year} (top 15)`} subtitle="Costo estándar del maestro (purchase_rate); solo bienes.">
      <div className="flex justify-end mb-2"><AmountToggle value={mode} onChange={setMode} /></div>
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : top.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={440}>
          <BarChart data={top} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} tickFormatter={(v) => (mode === 'pct' ? `${Math.round(Number(v))}%` : formatCompactUSD(Number(v)))} />
            <YAxis type="category" dataKey="label" width={160} tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} interval={0} />
            <Tooltip content={tooltip(mode === 'pct' ? (n) => `${n.toFixed(1)}%` : formatUSD)} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            <Bar dataKey={mode === 'pct' ? 'margenPct' : 'margen'} fill={CHART.fac} radius={[0, 5, 5, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
