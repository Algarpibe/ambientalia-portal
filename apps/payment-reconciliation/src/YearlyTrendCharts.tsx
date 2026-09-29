import type React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { YearlyTrendRow } from './metrics/yearlyTrendMetrics';

const oneDecimal = (n: number) =>
  n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Rounded top corners only, so bars sit flat on the X axis.
const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-6">
      <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-4">{title}</h3>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

// Loaded with React.lazy from KpisTab: Recharts is downloaded only when the tab opens.
export default function YearlyTrendCharts({ rows }: { rows: YearlyTrendRow[] }) {
  const data = rows.map((r) => ({ ...r, label: r.isPartialYear ? `${r.year}*` : String(r.year) }));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <ChartCard title="DPD promedio por año (días)">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }} barGap={4}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" stroke="#64748b" />
          <YAxis stroke="#64748b" allowDecimals={false} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => `${oneDecimal(Number(v))} días`} />
          <Legend />
          <Bar dataKey="averageDPD" name="DPD promedio" fill="#4f46e5" radius={BAR_RADIUS} maxBarSize={48} />
          <Bar dataKey="weightedDPD" name="DPD ponderado por valor" fill="#dc2626" radius={BAR_RADIUS} maxBarSize={48} />
        </BarChart>
      </ChartCard>

      <ChartCard title="% de facturas pagadas a tiempo">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" stroke="#64748b" />
          <YAxis stroke="#64748b" domain={[0, 100]} unit="%" />
          <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => `${oneDecimal(Number(v))} %`} />
          <Legend />
          <Bar dataKey="onTimePercentage" name="% a tiempo" fill="#059669" radius={BAR_RADIUS} maxBarSize={48} />
        </BarChart>
      </ChartCard>
    </div>
  );
}
