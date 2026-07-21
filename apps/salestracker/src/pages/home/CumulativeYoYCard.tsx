import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { SalesRow } from '../../api';
import { buildCumulativeYoY } from '../../lib/home-metrics';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import HomeCard, { ChipLegend } from './HomeCard';
import HomeTooltip from './HomeTooltip';
import { T } from './homeTheme';

const icon = (
  <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 13l4-5 3 3 5-7" /></svg>
);

export default function CumulativeYoYCard({ rows, year }: { rows: SalesRow[]; year: number }) {
  const data = buildCumulativeYoY(rows, year);
  const vacio = data.every((d) => d.actual === 0 && d.previo === 0);
  const last = data.length - 1;

  // Punto naranja resaltado en el último mes (guiño al referente).
  const renderDot = (props: { cx?: number; cy?: number; index?: number }) => {
    if (props.index !== last || props.cx == null || props.cy == null) {
      return <g key={props.index} />;
    }
    return (
      <g key="last">
        <circle cx={props.cx} cy={props.cy} r={9} fill={T.accent} opacity={0.16} />
        <circle cx={props.cx} cy={props.cy} r={4.5} fill={T.accent} stroke={T.surface} strokeWidth={2} />
      </g>
    );
  };

  return (
    <HomeCard
      icon={icon}
      title="Facturación acumulada"
      subtitle={`${year} vs ${year - 1}`}
      right={<ChipLegend items={[{ color: T.fac, label: String(year), line: true }, { color: T.prev, label: String(year - 1), line: true }]} />}
    >
      {vacio ? (
        <p className="text-[#9A968E] py-10 text-center">Sin datos.</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 12, right: 16, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={T.grid} />
            <XAxis dataKey="mes" tickLine={false} axisLine={false} tick={{ fill: T.muted, fontSize: 11 }} />
            <YAxis tickFormatter={(v) => formatCompactUSD(Number(v))} tickLine={false} axisLine={false} tick={{ fill: T.muted, fontSize: 11 }} width={56} />
            <Tooltip content={(p) => <HomeTooltip active={p.active} label={p.label as string} payload={p.payload as ReadonlyArray<{ name?: string; value?: number | string }>} fmt={formatUSD} />} />
            <Line type="monotone" dataKey="previo" name={String(year - 1)} stroke={T.prev} strokeWidth={2} strokeDasharray="5 4" dot={false} />
            <Line type="monotone" dataKey="actual" name={String(year)} stroke={T.fac} strokeWidth={2.6} dot={renderDot} activeDot={{ r: 4, fill: T.fac }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </HomeCard>
  );
}
