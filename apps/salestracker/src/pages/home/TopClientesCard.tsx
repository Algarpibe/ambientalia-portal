import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, Cell, LabelList, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchCustomerSales, type RecordTypeIO } from '../../api';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import HomeCard from './HomeCard';
import HomeTooltip from './HomeTooltip';
import { T } from './homeTheme';

const icon = (
  <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 5h12M3 9h9M3 13h6" /></svg>
);

export default function TopClientesCard({ tipo = 'INVOICE', year }: { tipo?: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['customer-sales', tipo, year, year], queryFn: () => fetchCustomerSales({ tipo, desdeAnio: year, hastaAnio: year }) });

  const totals = new Map<string, number>();
  for (const r of q.data ?? []) totals.set(r.customer, (totals.get(r.customer) ?? 0) + r.ventas);
  const top = [...totals.entries()]
    .map(([customer, ventas]) => ({ customer, ventas }))
    .sort((a, b) => b.ventas - a.ventas)
    .slice(0, 8);

  return (
    <HomeCard icon={icon} title="Top clientes" subtitle="Facturado del año · 8 mayores">
      {q.isLoading ? (
        <p className="text-[#9A968E] py-10 text-center">Cargando…</p>
      ) : q.error ? (
        <p className="text-red-600">{(q.error as Error).message}</p>
      ) : top.length === 0 ? (
        <p className="text-[#9A968E] py-10 text-center">Sin datos.</p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={top} layout="vertical" margin={{ top: 4, right: 52, left: 8, bottom: 4 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="customer" width={168} tick={{ fill: T.ink2, fontSize: 12 }} tickLine={false} axisLine={false} interval={0} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} content={(p) => <HomeTooltip active={p.active} payload={p.payload as ReadonlyArray<{ name?: string; value?: number | string }>} fmt={formatUSD} />} />
            <Bar dataKey="ventas" name="Ventas" radius={[0, 5, 5, 0]} maxBarSize={20}>
              {top.map((d, i) => (
                <Cell key={d.customer} fill={i === 0 ? T.accent : T.fac} />
              ))}
              <LabelList dataKey="ventas" position="right" formatter={(v: unknown) => formatCompactUSD(Number(v))} style={{ fill: T.ink, fontSize: 10.5, fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </HomeCard>
  );
}
