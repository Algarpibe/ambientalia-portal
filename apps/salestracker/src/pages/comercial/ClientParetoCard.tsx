import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { fetchCustomerSales, type RecordTypeIO } from '../../api';
import { buildClientPareto } from '../../lib/analytics-comercial';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import { CHART } from '../../ui/warmTheme';
import { tooltip } from '../../ui/ChartTooltip';
import ChartCard from './ChartCard';

export default function ClientParetoCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['customer-sales', tipo, year, year], queryFn: () => fetchCustomerSales({ tipo, desdeAnio: year, hastaAnio: year }) });
  const data = buildClientPareto(q.data ?? []).slice(0, 20);
  return (
    <ChartCard title="Pareto de clientes" subtitle="Top 20 · la línea es el % acumulado (referencia 80%).">
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : data.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={data} margin={{ bottom: 60 }}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis dataKey="customer" angle={-40} textAnchor="end" height={80} interval={0} tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} />
            <YAxis yAxisId="l" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip content={tooltip(formatUSD)} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            <ReferenceLine yAxisId="r" y={80} stroke={CHART.reference} strokeDasharray="4 4" />
            <Bar yAxisId="l" dataKey="ventas" fill={CHART.fac} radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Line yAxisId="r" dataKey="cumPct" stroke={CHART.accent} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
