import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { SalesRow } from '../../api';
import { buildCategoryMix } from '../../lib/home-metrics';
import { formatUSD, PALETTE, OTROS_COLOR } from '../../lib/format';
import ChartCard from '../comercial/ChartCard';

export default function CategoryMixCard({ rows, year }: { rows: SalesRow[]; year: number }) {
  const mix = buildCategoryMix(rows, year, 8);
  return (
    <ChartCard title="Mix de categorías (FAC)">
      {mix.length === 0 ? (
        <p className="text-gray-500">Sin datos.</p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <PieChart>
            <Pie data={mix} dataKey="importe" nameKey="categoria" innerRadius={70} outerRadius={120} label>
              {mix.map((s, i) => (
                <Cell key={i} fill={s.categoria === 'Otros' ? OTROS_COLOR : PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => formatUSD(Number(v))} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
