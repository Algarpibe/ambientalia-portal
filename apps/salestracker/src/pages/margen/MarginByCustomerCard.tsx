import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchMarginByCustomer, type RecordTypeIO } from '../../api';
import { buildMarginCustomers } from '../../lib/analytics-margin';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import { APP_BASE } from '../../appBase';
import ChartCard from '../comercial/ChartCard';
import AmountToggle, { type AmountMode } from './AmountToggle';

export default function MarginByCustomerCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['margin-customer', tipo, year], queryFn: () => fetchMarginByCustomer({ tipo, anio: year }) });
  const [mode, setMode] = useState<AmountMode>('money');
  const navigate = useNavigate();
  const items = buildMarginCustomers(q.data ?? []);
  const top = (mode === 'pct' ? [...items].sort((a, b) => b.margenPct - a.margenPct || a.customer.localeCompare(b.customer)) : items).slice(0, 15);

  const handleBarClick = (payload: { payload?: { customer?: string } }) => {
    const customer = payload?.payload?.customer;
    if (customer) navigate(`${APP_BASE}/clientes/${encodeURIComponent(customer)}`);
  };

  return (
    <ChartCard title={`Margen por cliente ${year} (top 15)`} subtitle="Costo estándar del maestro (purchase_rate); solo bienes. Clic en un cliente para ver su detalle.">
      <div className="flex justify-end mb-2"><AmountToggle value={mode} onChange={setMode} /></div>
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : top.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={440}>
          <BarChart data={top} layout="vertical" margin={{ left: 20 }}>
            <XAxis type="number" tickFormatter={(v) => (mode === 'pct' ? `${Math.round(Number(v))}%` : formatCompactUSD(Number(v)))} />
            <YAxis type="category" dataKey="customer" width={160} tick={{ fontSize: 11 }} interval={0} />
            <Tooltip formatter={(v, n) => (n === 'margenPct' ? `${Number(v).toFixed(1)}%` : formatUSD(Number(v)))} />
            <Bar dataKey={mode === 'pct' ? 'margenPct' : 'margen'} fill="#10b981" cursor="pointer" onClick={handleBarClick} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
