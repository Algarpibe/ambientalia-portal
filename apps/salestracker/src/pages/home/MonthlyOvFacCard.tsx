import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { SalesRow } from '../../api';
import { buildMonthlyOvFac } from '../../lib/home-metrics';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import HomeCard, { ChipLegend } from './HomeCard';
import HomeTooltip from './HomeTooltip';
import { T } from './homeTheme';

const icon = (
  <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 15V9M9 15V4M15 15v-8" /></svg>
);

export default function MonthlyOvFacCard({ rows, year }: { rows: SalesRow[]; year: number }) {
  const data = buildMonthlyOvFac(rows, year);
  const vacio = data.every((d) => d.ov === 0 && d.fac === 0);
  return (
    <HomeCard
      icon={icon}
      title="Ventas mensuales"
      subtitle="Órdenes vs Facturado"
      right={<ChipLegend items={[{ color: T.ov, label: 'OV' }, { color: T.fac, label: 'FAC' }]} />}
    >
      {vacio ? (
        <p className="text-[#9A968E] py-10 text-center">Sin datos.</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={T.grid} />
            <XAxis dataKey="mes" tickLine={false} axisLine={false} tick={{ fill: T.muted, fontSize: 11 }} />
            <YAxis tickFormatter={(v) => formatCompactUSD(Number(v))} tickLine={false} axisLine={false} tick={{ fill: T.muted, fontSize: 11 }} width={56} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} content={(p) => <HomeTooltip active={p.active} label={p.label as string} payload={p.payload as ReadonlyArray<{ name?: string; value?: number | string }>} fmt={formatUSD} />} />
            <Bar dataKey="ov" name="OV" fill={T.ov} radius={[4, 4, 0, 0]} maxBarSize={16} />
            <Bar dataKey="fac" name="FAC" fill={T.fac} radius={[4, 4, 0, 0]} maxBarSize={16} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </HomeCard>
  );
}
