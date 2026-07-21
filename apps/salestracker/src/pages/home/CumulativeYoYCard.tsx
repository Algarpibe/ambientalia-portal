import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { SalesRow } from '../../api';
import { buildCumulativeYoY } from '../../lib/home-metrics';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import ChartCard from '../comercial/ChartCard';

export default function CumulativeYoYCard({ rows, year }: { rows: SalesRow[]; year: number }) {
  const data = buildCumulativeYoY(rows, year);
  const vacio = data.every((d) => d.actual === 0 && d.previo === 0);
  return (
    <ChartCard title="Facturación acumulada (interanual)">
      {vacio ? (
        <p className="text-gray-500">Sin datos.</p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="mes" />
            <YAxis tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <Tooltip formatter={(v) => formatUSD(Number(v))} />
            <Legend />
            <Line type="monotone" dataKey="actual" name={String(year)} stroke="#10b981" strokeWidth={3} dot={false} />
            <Line type="monotone" dataKey="previo" name={String(year - 1)} stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
