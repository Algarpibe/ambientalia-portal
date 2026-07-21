import { formatDeltaPct } from '../../lib/compare';

export default function KpiTile({ label, value, deltaPct, hint }: { label: string; value: string; deltaPct?: number | null; hint?: string }) {
  const badgeClass =
    deltaPct === null || deltaPct === undefined
      ? 'bg-gray-100 text-gray-500'
      : deltaPct >= 0
        ? 'bg-green-100 text-green-700'
        : 'bg-red-100 text-red-700';
  return (
    <div className="rounded-xl border bg-white p-5">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {deltaPct !== undefined && (
        <span className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-xs font-medium ${badgeClass}`}>
          {formatDeltaPct(deltaPct)}
        </span>
      )}
      {hint && <div className="text-xs text-gray-400">{hint}</div>}
    </div>
  );
}
