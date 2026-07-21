import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchSales, type RecordTypeIO } from '../../api';
import { monthlyByYear } from '../../lib/forecast-input';
import { formatUSD, formatCompactUSD, MONTHS } from '../../lib/format';
import { CHART } from '../../ui/warmTheme';
import { tooltip } from '../../ui/ChartTooltip';
import ChartCard from '../comercial/ChartCard';

export default function GlobalMonthlyCard({ tipo, yearA, yearB }: { tipo: RecordTypeIO; yearA: number; yearB: number }) {
  const q = useQuery({ queryKey: ['sales'], queryFn: fetchSales });
  const rows = q.data ?? [];
  const a = monthlyByYear(rows, yearA, tipo);
  const b = monthlyByYear(rows, yearB, tipo);
  const data = MONTHS.map((m, i) => ({ mes: m, ventasA: a[i], ventasB: b[i] }));
  const hasData = data.some((r) => r.ventasA || r.ventasB);
  return (
    <ChartCard title={`Comparativa mensual · ${yearA} vs ${yearB}`} subtitle="Ventas mensuales del año A frente al año B.">
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : !hasData ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={data}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis dataKey="mes" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <Tooltip content={tooltip(formatUSD)} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            <Legend />
            <Bar dataKey="ventasA" name={String(yearA)} fill={CHART.fac} radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Bar dataKey="ventasB" name={String(yearB)} fill={CHART.ov} radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
