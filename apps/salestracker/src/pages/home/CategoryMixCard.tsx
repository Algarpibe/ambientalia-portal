import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { SalesRow } from '../../api';
import { buildCategoryMix } from '../../lib/home-metrics';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import HomeCard from './HomeCard';
import HomeTooltip from './HomeTooltip';
import { donutColor } from './homeTheme';

const icon = (
  <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="6" /><path d="M9 3v6l4 2.5" /></svg>
);

export default function CategoryMixCard({ rows, year }: { rows: SalesRow[]; year: number }) {
  const mix = buildCategoryMix(rows, year, 8);
  const total = mix.reduce((s, m) => s + m.importe, 0);
  return (
    <HomeCard icon={icon} title="Mix de categorías" subtitle="Participación FAC" className="h-full">
      {mix.length === 0 ? (
        <p className="text-[#9A968E] py-10 text-center">Sin datos.</p>
      ) : (
        <div className="flex gap-5 items-center flex-wrap">
          <ResponsiveContainer width={190} height={190} className="!flex-none">
            <PieChart>
              <Pie data={mix} dataKey="importe" nameKey="categoria" innerRadius={52} outerRadius={86} paddingAngle={2} stroke="none">
                {mix.map((s, i) => (
                  <Cell key={s.categoria} fill={donutColor(i, s.categoria)} />
                ))}
              </Pie>
              <Tooltip content={(p) => <HomeTooltip active={p.active} payload={p.payload as ReadonlyArray<{ name?: string; value?: number | string }>} fmt={formatUSD} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 min-w-[150px]">
            <div className="text-[11.5px] font-medium text-[#9A968E]">Total</div>
            <div className="text-[18px] font-extrabold tracking-tight text-[#24231F] mb-3 tabular-nums">{formatCompactUSD(total)}</div>
            <ul className="flex flex-col gap-2.5">
              {mix.map((s, i) => (
                <li key={s.categoria} className="flex items-center gap-2.5 text-[12.5px]">
                  <span className="w-2.5 h-2.5 rounded-[4px] flex-none" style={{ background: donutColor(i, s.categoria) }} />
                  <span className="flex-1 truncate text-[#6E6B64] font-medium">{s.categoria}</span>
                  <span className="font-bold tabular-nums text-[#24231F]">{total > 0 ? ((s.importe / total) * 100).toFixed(1) : '0.0'}%</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </HomeCard>
  );
}
