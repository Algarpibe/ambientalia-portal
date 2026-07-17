import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useProfitabilityData } from './useProfitabilityData';
import { analyze, formatMoney } from './analysis';

// Widget: top marcas por ventas (BarChart horizontal). Autocontenido.

const BAR_COLOR = '#6366f1';

export default function TopBrandsWidget() {
  const { sales, products, loading, error } = useProfitabilityData();
  const data = useMemo(() => {
    const { brands } = analyze(sales, products);
    return brands.slice(0, 8).map((b) => ({ name: b.name, ventas: Math.round(b.sales) }));
  }, [sales, products]);

  if (loading) return <StateMsg>Cargando…</StateMsg>;
  if (error) return <StateMsg tone="error">{error}</StateMsg>;
  if (data.length === 0) return <StateMsg>Sin datos de marcas.</StateMsg>;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={(v) => [formatMoney(Number(v) || 0), 'Ventas']}
          cursor={{ fill: 'rgba(99,102,241,0.06)' }}
          contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
        />
        <Bar dataKey="ventas" radius={[0, 6, 6, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={BAR_COLOR} fillOpacity={1 - i * 0.08} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function StateMsg({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div className={`h-full flex items-center justify-center text-sm ${tone === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
      {children}
    </div>
  );
}
