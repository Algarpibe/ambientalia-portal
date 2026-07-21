import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchCategoryMonthSales, type RecordTypeIO } from '../../api';
import { buildBucketSeason } from '../../lib/analytics-comercial';
import { formatUSD, formatCompactUSD, MONTHS, SERIES } from '../../lib/format';
import { CHART } from '../../ui/warmTheme';
import { tooltip } from '../../ui/ChartTooltip';
import ChartCard from './ChartCard';

export default function SeasonByBucketCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['category-month-sales', tipo, year], queryFn: () => fetchCategoryMonthSales({ tipo, anio: year }) });
  const data = buildBucketSeason(q.data ?? []).map((r) => ({ ...r, mesLabel: MONTHS[r.mes - 1] }));
  const hasData = data.some((r) => r.mano_obra || r.cr || r.equipos || r.operacion);
  return (
    <ChartCard title="Estacionalidad por bucket" subtitle="Ventas mensuales apiladas por bucket (mano de obra, C&R, equipos, operación).">
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : !hasData ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={380}>
          <BarChart data={data}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis dataKey="mesLabel" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} tickFormatter={(v) => formatCompactUSD(Number(v))} />
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
