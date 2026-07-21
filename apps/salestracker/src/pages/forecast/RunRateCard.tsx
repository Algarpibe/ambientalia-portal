import { formatUSD } from '../../lib/format';

export default function RunRateCard({ title, stat }: {
  title: string;
  stat: { value: number; low: number; high: number; actual: number; reference: number; deltaPct: number | null; onTrack: boolean };
}) {
  const progress = stat.value > 0 ? Math.min(100, (stat.actual / stat.value) * 100) : 0;
  const hasBand = stat.high > stat.low;
  return (
    <div className="st-tile rounded-2xl p-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-[#9A968E]">{title}</h3>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-[#24231F]">{formatUSD(stat.value)}</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: '#B4541A', background: '#FBE7D4' }}>Forecast</span>
          </div>
          {hasBand && <p className="text-xs text-[#9A968E] tabular-nums mt-0.5">Rango: {formatUSD(stat.low)} – {formatUSD(stat.high)}</p>}
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded-full" style={stat.onTrack ? { color: '#346538', background: '#EDF3EC' } : { color: '#B4541A', background: '#FBE7D4' }}>
          {stat.onTrack ? 'On track' : 'En riesgo'}
        </span>
      </div>
      <div className="mt-4 flex justify-between text-sm">
        <div><div className="text-[#9A968E]">Actual</div><div className="font-bold tabular-nums text-[#24231F]">{formatUSD(stat.actual)}</div></div>
        <div className="text-right"><div className="text-[#9A968E]">Año anterior</div><div className="font-bold tabular-nums text-[#9A968E]">{formatUSD(stat.reference)}</div></div>
      </div>
      <div className="mt-3 h-2.5 w-full rounded-full overflow-hidden" style={{ background: '#E5E2DB' }}>
        <div className="h-full" style={{ width: `${progress}%`, background: '#EE7A21' }} />
      </div>
      {stat.deltaPct !== null && (
        <p className="mt-2 text-xs font-medium" style={{ color: stat.deltaPct >= 0 ? '#346538' : '#B4541A' }}>
          {stat.deltaPct >= 0 ? '+' : ''}{(stat.deltaPct * 100).toFixed(1)}% vs mismo periodo del año anterior
        </p>
      )}
    </div>
  );
}
