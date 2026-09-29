import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { YearlyTrendRow } from './metrics/yearlyTrendMetrics';

// The yearly DPD bar chart (simple vs value-weighted). Fills its parent, which
// must have a height. Shared by the KPIs tab and the Dashboard widget; always
// load it lazily so Recharts stays out of eager chunks.

const oneDecimal = (n: number) =>
  n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

export default function DpdByYearChart({ rows }: { rows: YearlyTrendRow[] }) {
  const data = rows.map((r) => ({ ...r, label: r.isPartialYear ? `${r.year}*` : String(r.year) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="label" stroke="#64748b" />
        <YAxis stroke="#64748b" allowDecimals={false} />
        <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => `${oneDecimal(Number(v))} días`} />
        <Legend />
        <Bar dataKey="averageDPD" name="DPD promedio" fill="#4f46e5" radius={BAR_RADIUS} maxBarSize={48} />
        <Bar dataKey="weightedDPD" name="DPD ponderado por valor" fill="#dc2626" radius={BAR_RADIUS} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}
