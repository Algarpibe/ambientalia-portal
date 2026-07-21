import { formatDeltaPct } from '../../lib/compare';
import { T } from './homeTheme';

/** Tile de KPI del dashboard: gris cálido, número grande y bold, y a la derecha
 *  un pill de delta YoY, un anillo de progreso, o una etiqueta. */
export default function KpiTile({
  label,
  sublabel,
  value,
  deltaPct,
  tag,
  ring,
}: {
  label: string;
  sublabel?: string;
  value: string;
  deltaPct?: number | null;
  tag?: string;
  ring?: number; // 0..100 → anillo de progreso naranja
}) {
  return (
    <div className="st-tile p-5 flex flex-col min-h-[118px]">
      <div className="flex items-start justify-between gap-2.5">
        <div>
          <div className="text-[12.5px] font-semibold text-[#6E6B64]">{label}</div>
          {sublabel && <div className="text-[11.5px] font-medium text-[#9A968E]">{sublabel}</div>}
        </div>
        {ring !== undefined ? (
          <Ring pct={ring} />
        ) : deltaPct !== undefined ? (
          <DeltaPill pct={deltaPct} />
        ) : tag ? (
          <span className="text-[11.5px] font-semibold text-[#9A968E] whitespace-nowrap">{tag}</span>
        ) : null}
      </div>
      <div className="mt-auto text-[27px] font-extrabold tracking-tight tabular-nums text-[#24231F]">
        {value}
      </div>
    </div>
  );
}

function DeltaPill({ pct }: { pct: number | null }) {
  const up = pct !== null && pct >= 0;
  const style = up
    ? { background: T.accentSoft, color: T.accentInk }
    : { background: '#E7E4DE', color: T.ink2 };
  return (
    <span
      className="inline-flex items-center gap-1 text-[11.5px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap"
      style={style}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <path d={up ? 'M4 1 L7 6 L1 6 Z' : 'M4 7 L1 2 L7 2 Z'} fill="currentColor" />
      </svg>
      {formatDeltaPct(pct)}
    </span>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 16;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <svg width="42" height="42" viewBox="0 0 42 42" aria-hidden="true">
      <circle cx="21" cy="21" r={r} fill="none" stroke={T.baseline} strokeWidth="4" />
      <circle
        cx="21"
        cy="21"
        r={r}
        fill="none"
        stroke={T.accent}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={off}
        transform="rotate(-90 21 21)"
      />
    </svg>
  );
}
