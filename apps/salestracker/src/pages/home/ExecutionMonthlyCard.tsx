import { BarChart, Bar, Cell, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import type { SalesRow } from '../../api';
import { buildExecutionMonthly, buildMonthlyOvFac } from '../../lib/home-metrics';
import HomeCard from './HomeCard';
import HomeTooltip from './HomeTooltip';
import { T } from './homeTheme';

const icon = (
  <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 12a6 6 0 0112 0" /><path d="M9 12l3-3" /></svg>
);
const pct = (n: number) => `${n.toFixed(1)}%`;

export default function ExecutionMonthlyCard({ rows, year }: { rows: SalesRow[]; year: number }) {
  const data = buildExecutionMonthly(rows, year);
  const mov = buildMonthlyOvFac(rows, year);
  const vacio = mov.every((m) => m.ov === 0 && m.fac === 0);
  return (
    <HomeCard icon={icon} title="Ejecución mensual" subtitle="FAC / OV · %">
      {vacio ? (
        <p className="text-[#9A968E] py-10 text-center">Sin datos.</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={T.grid} />
            <XAxis dataKey="mes" tickLine={false} axisLine={false} tick={{ fill: T.muted, fontSize: 10 }} interval={1} />
            <YAxis domain={[0, (max: number) => Math.max(100, max)]} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} tickLine={false} axisLine={false} tick={{ fill: T.muted, fontSize: 11 }} width={40} />
            <ReferenceLine y={100} stroke={T.baseline} strokeDasharray="3 3" />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} content={(p) => <HomeTooltip active={p.active} label={p.label as string} payload={(p.payload as ReadonlyArray<{ name?: string; value?: number | string }>)?.map((x) => ({ ...x, name: 'Ejecución' }))} fmt={(n) => pct(n)} />} />
            <Bar dataKey="pct" name="Ejecución" radius={[4, 4, 0, 0]} maxBarSize={16}>
              {data.map((d) => (
                <Cell key={d.mes} fill={d.pct > 100 ? T.accent : T.fac} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </HomeCard>
  );
}
