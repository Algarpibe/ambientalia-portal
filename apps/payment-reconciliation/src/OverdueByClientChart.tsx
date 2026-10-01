import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { formatMoney } from './currency';
import { compactMoney } from './overdueByClientFormat';

const BAR_RADIUS: [number, number, number, number] = [0, 4, 4, 0];

// Loaded with React.lazy from KpisTab: Recharts is downloaded only when the tab opens.
export default function OverdueByClientChart({ rows }: { rows: { name: string; overdueBalance: number }[] }) {
  // Rows arrive largest first; the chart draws the first row on top, so reverse to put the largest at the bottom.
  const data = [...rows].reverse();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical horizontal={false} />
        <XAxis type="number" stroke="#64748b" tickFormatter={compactMoney} />
        <YAxis type="category" dataKey="name" width={220} stroke="#64748b" tick={{ fontSize: 12 }} />
        <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => formatMoney(Number(v))} />
        <Bar dataKey="overdueBalance" name="Saldo vencido" fill="#3b82f6" radius={BAR_RADIUS} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
