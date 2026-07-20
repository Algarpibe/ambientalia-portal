import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { fetchCustomerSales, type RecordTypeIO } from '../../api';
import { buildClientPareto } from '../../lib/analytics-comercial';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import ChartCard from './ChartCard';

export default function ClientParetoCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['customer-sales', tipo, year, year], queryFn: () => fetchCustomerSales({ tipo, desdeAnio: year, hastaAnio: year }) });
  const data = buildClientPareto(q.data ?? []).slice(0, 20);
  return (
    <ChartCard title="Pareto de clientes" subtitle="Top 20 · la línea es el % acumulado (referencia 80%).">
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : data.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={data} margin={{ bottom: 60 }}>
            <XAxis dataKey="customer" angle={-40} textAnchor="end" height={80} interval={0} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="l" tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v, n) => (n === 'cumPct' ? `${Number(v).toFixed(1)}%` : formatUSD(Number(v)))} />
            <ReferenceLine yAxisId="r" y={80} stroke="#ef4444" strokeDasharray="4 4" />
            <Bar yAxisId="l" dataKey="ventas" fill="#2563eb" />
            <Line yAxisId="r" dataKey="cumPct" stroke="#f59e0b" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
