import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchCustomerSales, type RecordTypeIO } from '../../api';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import ChartCard from '../comercial/ChartCard';

export default function TopClientesCard({ tipo = 'INVOICE', year }: { tipo?: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['customer-sales', tipo, year, year], queryFn: () => fetchCustomerSales({ tipo, desdeAnio: year, hastaAnio: year }) });

  const totals = new Map<string, number>();
  for (const r of q.data ?? []) totals.set(r.customer, (totals.get(r.customer) ?? 0) + r.ventas);
  const top = [...totals.entries()]
    .map(([customer, ventas]) => ({ customer, ventas }))
    .sort((a, b) => b.ventas - a.ventas)
    .slice(0, 10);

  return (
    <ChartCard title="Top clientes (FAC)" subtitle="Los 10 clientes con más ventas del año.">
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : top.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={top} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <YAxis type="category" dataKey="customer" width={160} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => formatUSD(Number(v))} />
            <Bar dataKey="ventas" name="Ventas" fill="#6366f1" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
