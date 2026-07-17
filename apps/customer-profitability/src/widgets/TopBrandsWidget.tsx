import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useProfitabilityData } from './useProfitabilityData';
import { analyze, formatMoney } from './analysis';

// Widget: top marcas por ventas (BarChart horizontal). Autocontenido.

const BAR_COLOR = '#6366f1';

/** Acorta la etiqueta del eje para que no se parta en varias líneas. */
const truncate = (s: string, max = 16) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

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
          width={120}
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickFormatter={(v: string) => truncate(v)}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <Tooltip
          formatter={(v) => [formatMoney(Number(v) || 0), 'Ventas']}
          labelFormatter={(label) => String(label)}
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
