import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchCustomerSales, type RecordTypeIO } from '../../api';
import { buildNewVsRecurring } from '../../lib/analytics-comercial';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import { CHART } from '../../ui/warmTheme';
import { tooltip } from '../../ui/ChartTooltip';
import ChartCard from './ChartCard';

const anioActual = new Date().getFullYear();

export default function NewVsRecurringCard({ tipo }: { tipo: RecordTypeIO }) {
  const q = useQuery({
    queryKey: ['customer-sales', tipo, 2021, anioActual],
    queryFn: () => fetchCustomerSales({ tipo, desdeAnio: 2021, hastaAnio: anioActual }),
  });
  const data = buildNewVsRecurring(q.data ?? []);
  return (
    <ChartCard title="Nuevos vs recurrentes" subtitle="Ventas por año · barras = importe (nuevos/recurrentes), línea = nº de clientes nuevos.">
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : data.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={data}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} />
            <YAxis yAxisId="l" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <YAxis yAxisId="r" orientation="right" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} />
            <Tooltip content={tooltip((v, it) => (it?.dataKey === 'countNuevos' ? `${Math.round(v)} clientes` : formatUSD(v)))} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            <Legend />
            <Bar yAxisId="l" stackId="1" dataKey="nuevos" name="Nuevos" fill={CHART.fac} maxBarSize={40} />
            <Bar yAxisId="l" stackId="1" dataKey="recurrentes" name="Recurrentes" fill={CHART.ov} maxBarSize={40} />
            <Line yAxisId="r" dataKey="countNuevos" name="Nº clientes nuevos" stroke={CHART.accent} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
