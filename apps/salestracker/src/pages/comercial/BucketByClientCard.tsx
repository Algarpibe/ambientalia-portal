import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchCustomerItemSales, type RecordTypeIO } from '../../api';
import { buildBucketByClient } from '../../lib/analytics-comercial';
import { formatUSD, formatCompactUSD, SERIES } from '../../lib/format';
import { CHART } from '../../ui/warmTheme';
import { tooltip } from '../../ui/ChartTooltip';
import ChartCard from './ChartCard';

export default function BucketByClientCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['customer-item-sales', tipo, year], queryFn: () => fetchCustomerItemSales({ tipo, anio: year }) });
  const data = buildBucketByClient(q.data ?? []).slice(0, 15);
  return (
    <ChartCard title="Bucket por cliente" subtitle="Top 15 clientes · ventas apiladas por bucket (mano de obra, C&R, equipos, operación).">
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : data.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={440}>
          <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <YAxis type="category" dataKey="customer" width={160} tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} interval={0} />
            <Tooltip content={tooltip(formatUSD)} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            <Legend />
            <Bar stackId="1" dataKey="mano_obra" name="Mano de Obra / Cal" fill={SERIES[0]} />
            <Bar stackId="1" dataKey="cr" name="C&R" fill={SERIES[1]} />
            <Bar stackId="1" dataKey="equipos" name="Equipos" fill={SERIES[2]} />
            <Bar stackId="1" dataKey="operacion" name="Operación" fill={SERIES[3]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
