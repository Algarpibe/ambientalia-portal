import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchSales, type RecordTypeIO } from '../../api';
import { buildBucketMixByYear } from '../../lib/analytics-comercial';
import { formatUSD, formatCompactUSD, SERIES } from '../../lib/format';
import ChartCard from './ChartCard';

export default function BucketMixCard({ tipo }: { tipo: RecordTypeIO }) {
  const q = useQuery({ queryKey: ['sales'], queryFn: fetchSales });
  const data = buildBucketMixByYear(q.data ?? [], tipo);
  return (
    <ChartCard title="Mix por bucket y año" subtitle="Ventas apiladas por bucket (mano de obra, C&R, equipos, operación) desde 2021.">
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : data.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart data={data}>
            <XAxis dataKey="year" />
            <YAxis tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <Tooltip formatter={(v) => formatUSD(Number(v))} />
            <Legend />
            <Area stackId="1" dataKey="mano_obra" name="Mano de Obra / Cal" stroke={SERIES[0]} fill={SERIES[0]} fillOpacity={0.5} />
            <Area stackId="1" dataKey="cr" name="C&R" stroke={SERIES[1]} fill={SERIES[1]} fillOpacity={0.5} />
            <Area stackId="1" dataKey="equipos" name="Equipos" stroke={SERIES[2]} fill={SERIES[2]} fillOpacity={0.5} />
            <Area stackId="1" dataKey="operacion" name="Operación" stroke={SERIES[3]} fill={SERIES[3]} fillOpacity={0.5} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
