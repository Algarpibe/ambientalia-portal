import type React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { YearlyTrendRow } from './metrics/yearlyTrendMetrics';
import { BAND_KEYS, bandShares } from './metrics/delinquencyBreakdown';
import type { BandKey, DelinquencyBandRow } from './metrics/delinquencyBreakdown';
import DpdByYearChart from './DpdByYearChart';

const oneDecimal = (n: number) =>
  n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

const BAND_SERIES: Record<BandKey, { name: string; color: string }> = {
  onTime: { name: 'A tiempo', color: '#059669' },
  d1_15: { name: '1–15 días', color: '#ca8a04' },
  d16_30: { name: '16–30 días', color: '#f97316' },
  d31_60: { name: '31–60 días', color: '#dc2626' },
  over60: { name: 'Más de 60 días', color: '#7f1d1d' },
};

const yearLabel = (year: number, isPartialYear: boolean) => (isPartialYear ? `${year}*` : String(year));

function ChartCard({ title, className = '', children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-soft p-6 ${className}`}>
      <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-4">{title}</h3>
      <div className="h-72">{children}</div>
    </div>
  );
}

// Loaded with React.lazy from KpisTab: Recharts is downloaded only when the tab opens.
export default function YearlyTrendCharts({ rows, bands }: { rows: YearlyTrendRow[]; bands: DelinquencyBandRow[] }) {
  const onTimeData = rows.map((r) => ({ ...r, label: yearLabel(r.year, r.isPartialYear) }));
  // Each band carries its share (for the stacked bar) and its count (for the tooltip).
  const bandData = bands.map((b) => {
    const shares = bandShares(b);
    const entry: Record<string, number | string> = { label: yearLabel(b.year, b.isPartialYear) };
    for (const key of BAND_KEYS) {
      entry[key] = shares[key];
      entry[`${key}Count`] = b[key];
    }
    return entry;
  });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <ChartCard title="DPD promedio por año (días)">
        <DpdByYearChart rows={rows} />
      </ChartCard>

      <ChartCard title="% pagado a tiempo">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={onTimeData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" stroke="#64748b" />
            <YAxis stroke="#64748b" domain={[0, 100]} unit="%" />
            <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => `${oneDecimal(Number(v))} %`} />
            <Legend />
            <Bar dataKey="onTimePercentage" name="% de facturas a tiempo" fill="#059669" radius={BAR_RADIUS} maxBarSize={48} />
            <Bar dataKey="onTimeValuePercentage" name="% del valor a tiempo" fill="#0d9488" radius={BAR_RADIUS} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Días de cobro (DSO) por año">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={onTimeData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" stroke="#64748b" />
            <YAxis stroke="#64748b" allowDecimals={false} />
            <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => `${oneDecimal(Number(v))} días`} />
            <Legend />
            <Bar dataKey="averageCollectionDays" name="DSO promedio" fill="#0284c7" radius={BAR_RADIUS} maxBarSize={48} />
            <Bar dataKey="weightedCollectionDays" name="DSO ponderado por valor" fill="#7c3aed" radius={BAR_RADIUS} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Facturas por tramo de mora (%)">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bandData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" stroke="#64748b" />
            {/* Stacked shares can add up to 100.00000000000001; without allowDataOverflow Recharts stretches the axis past 100 %. */}
            <YAxis stroke="#64748b" domain={[0, 100]} unit="%" allowDataOverflow />
            <Tooltip
              cursor={{ fill: '#f1f5f9' }}
              formatter={(v, _name, item) => {
                const count = (item?.payload as Record<string, unknown> | undefined)?.[`${String(item?.dataKey)}Count`];
                return `${oneDecimal(Number(v))} % (${String(count ?? 0)} facturas)`;
              }}
            />
            <Legend />
            {BAND_KEYS.map((key) => (
              <Bar key={key} dataKey={key} stackId="bands" name={BAND_SERIES[key].name} fill={BAND_SERIES[key].color} maxBarSize={64} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
