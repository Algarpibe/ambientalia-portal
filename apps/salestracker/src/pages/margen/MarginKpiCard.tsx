import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { fetchMarginByYear, type RecordTypeIO } from '../../api';
import { buildMarginByYear } from '../../lib/analytics-margin';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import { CHART } from '../../ui/warmTheme';
import { tooltip } from '../../ui/ChartTooltip';
import ChartCard from '../comercial/ChartCard';
import AmountToggle, { type AmountMode } from './AmountToggle';

export default function MarginKpiCard({ tipo }: { tipo: RecordTypeIO }) {
  const q = useQuery({ queryKey: ['margin-year', tipo], queryFn: () => fetchMarginByYear({ tipo }) });
  const [mode, setMode] = useState<AmountMode>('pct');
  const { series, totals } = buildMarginByYear(q.data ?? []);

  const tiles: { label: string; value: string }[] = [
    { label: 'Ventas bienes', value: formatUSD(totals.ventas) },
    { label: 'Costo', value: formatUSD(totals.costo) },
    { label: 'Margen', value: formatUSD(totals.margen) },
    { label: 'Margen %', value: `${totals.margenPct.toFixed(1)}%` },
  ];

  return (
    <ChartCard title="Margen bruto estimado (solo bienes)" subtitle="Costo estándar del maestro (purchase_rate); excluye servicios.">
      <div className="flex justify-end mb-2"><AmountToggle value={mode} onChange={setMode} /></div>
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : series.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {tiles.map((t) => (
              <div key={t.label} className="st-tile rounded-2xl p-3">
                <p className="text-xs text-[#9A968E]">{t.label}</p>
                <p className="text-lg font-semibold text-[#24231F]">{t.value}</p>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={series} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} />
              <YAxis
                domain={mode === 'pct' ? [0, 100] : ['auto', 'auto']}
                ticks={mode === 'pct' ? [0, 25, 50, 75, 100] : undefined}
                tickLine={false}
                axisLine={false}
                tick={{ fill: CHART.muted, fontSize: 11 }}
                tickFormatter={mode === 'pct' ? (v) => `${Math.round(Number(v))}%` : (v) => formatCompactUSD(Number(v))}
              />
              <Tooltip content={tooltip(mode === 'pct' ? (n) => `${n.toFixed(1)}%` : formatUSD)} />
              <Line dataKey={mode === 'pct' ? 'margenPct' : 'margen'} stroke={CHART.fac} dot />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </ChartCard>
  );
}
