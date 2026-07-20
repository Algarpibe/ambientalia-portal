import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchCustomerSales, type RecordTypeIO } from '../../api';
import { buildNewVsRecurring } from '../../lib/analytics-comercial';
import { formatUSD, formatCompactUSD } from '../../lib/format';
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
            <XAxis dataKey="year" />
            <YAxis yAxisId="l" tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <YAxis yAxisId="r" orientation="right" allowDecimals={false} />
            <Tooltip formatter={(v, n) => (n === 'countNuevos' ? Number(v).toLocaleString('es-CO') : formatUSD(Number(v)))} />
            <Legend />
            <Bar yAxisId="l" stackId="1" dataKey="nuevos" name="Nuevos" fill="#10b981" />
            <Bar yAxisId="l" stackId="1" dataKey="recurrentes" name="Recurrentes" fill="#6366f1" />
            <Line yAxisId="r" dataKey="countNuevos" name="Nº clientes nuevos" stroke="#f59e0b" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
