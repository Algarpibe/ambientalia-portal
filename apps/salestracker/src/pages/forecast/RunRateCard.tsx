import { formatUSD } from '../../lib/format';

export default function RunRateCard({ title, stat }: {
  title: string;
  stat: { value: number; low: number; high: number; actual: number; reference: number; deltaPct: number | null; onTrack: boolean };
}) {
  const progress = stat.value > 0 ? Math.min(100, (stat.actual / stat.value) * 100) : 0;
  const hasBand = stat.high > stat.low;
  return (
    <div className="rounded-xl border bg-white p-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500">{title}</h3>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-gray-900">{formatUSD(stat.value)}</span>
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Forecast</span>
          </div>
          {hasBand && <p className="text-xs text-gray-500 tabular-nums mt-0.5">Rango: {formatUSD(stat.low)} – {formatUSD(stat.high)}</p>}
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${stat.onTrack ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
          {stat.onTrack ? 'On track' : 'En riesgo'}
        </span>
      </div>
      <div className="mt-4 flex justify-between text-sm">
        <div><div className="text-gray-500">Actual</div><div className="font-bold tabular-nums">{formatUSD(stat.actual)}</div></div>
        <div className="text-right"><div className="text-gray-500">Año anterior</div><div className="font-bold tabular-nums text-gray-500">{formatUSD(stat.reference)}</div></div>
      </div>
      <div className="mt-3 h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full bg-blue-600" style={{ width: `${progress}%` }} />
      </div>
      {stat.deltaPct !== null && (
        <p className={`mt-2 text-xs font-medium ${stat.deltaPct >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
          {stat.deltaPct >= 0 ? '+' : ''}{(stat.deltaPct * 100).toFixed(1)}% vs mismo periodo del año anterior
        </p>
      )}
    </div>
  );
}
