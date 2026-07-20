import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { fetchItemSales, type RecordTypeIO } from '../../api';
import { buildItemPareto } from '../../lib/analytics-comercial';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import ChartCard from './ChartCard';

export default function SkuParetoCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({
    queryKey: ['item-sales', tipo, `${year}-01-01`, `${year}-12-31`],
    queryFn: () => fetchItemSales({ tipo, desde: `${year}-01-01`, hasta: `${year}-12-31` }),
  });
  const data = buildItemPareto(q.data ?? []).slice(0, 30);
  return (
    <ChartCard title="Pareto de SKU" subtitle="Top 30 · la línea es el % acumulado (referencia 80%).">
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : data.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={data} margin={{ bottom: 70 }}>
            <XAxis dataKey="label" angle={-45} textAnchor="end" height={90} interval={0} tick={{ fontSize: 10 }} />
            <YAxis yAxisId="l" tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v, n) => (n === 'cumPct' ? `${Number(v).toFixed(1)}%` : formatUSD(Number(v)))} />
            <ReferenceLine yAxisId="r" y={80} stroke="#ef4444" strokeDasharray="4 4" />
            <Bar yAxisId="l" dataKey="importe" fill="#2563eb" />
            <Line yAxisId="r" dataKey="cumPct" stroke="#f59e0b" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
