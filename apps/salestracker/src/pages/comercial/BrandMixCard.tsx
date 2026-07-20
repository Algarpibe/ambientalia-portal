import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchCustomerItemSales, type RecordTypeIO } from '../../api';
import { buildBrandMix } from '../../lib/analytics-comercial';
import { formatUSD, PALETTE, OTROS_COLOR } from '../../lib/format';
import ChartCard from './ChartCard';

export default function BrandMixCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['customer-item-sales', tipo, year], queryFn: () => fetchCustomerItemSales({ tipo, anio: year }) });
  const all = buildBrandMix(q.data ?? []);
  const top = all.slice(0, 8);
  const restSum = all.slice(8).reduce((s, b) => s + b.importe, 0);
  const slices = restSum > 0 ? [...top, { marca: 'Otros', importe: restSum }] : top;
  return (
    <ChartCard title="Mix de marcas" subtitle="Reparto de ventas por marca · top 8 + «Otros».">
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : slices.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={440}>
          <PieChart>
            <Pie data={slices} dataKey="importe" nameKey="marca" innerRadius={70} outerRadius={120} label>
              {slices.map((s, i) => (
                <Cell key={i} fill={s.marca === 'Otros' ? OTROS_COLOR : PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => formatUSD(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
