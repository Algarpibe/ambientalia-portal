import { useQuery } from '@tanstack/react-query';
import { fetchCustomerMonthSales, type RecordTypeIO } from '../../api';
import { buildMonthHeatmap } from '../../lib/analytics-comercial';
import { formatCompactUSD, MONTHS } from '../../lib/format';
import ChartCard from './ChartCard';

export default function MonthHeatmapCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['customer-month-sales', tipo, year], queryFn: () => fetchCustomerMonthSales({ tipo, anio: year }) });
  const rows = buildMonthHeatmap(q.data ?? []).slice(0, 15);
  const max = Math.max(1, ...rows.flatMap((r) => r.months));
  return (
    <ChartCard title="Estacionalidad por cliente (heatmap)" subtitle="Top 15 clientes · intensidad = importe del mes.">
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : rows.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead><tr><th className="sticky left-0 bg-white px-2 py-1 text-left">Cliente</th>{MONTHS.map((m) => <th key={m} className="px-2 py-1 text-center">{m}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.customer}>
                  <td className="sticky left-0 bg-white px-2 py-1 whitespace-nowrap max-w-[180px] truncate">{r.customer}</td>
                  {r.months.map((v, i) => (
                    <td key={i} className="px-2 py-1 text-right tabular-nums" style={{ backgroundColor: `rgba(16,185,129,${v > 0 ? 0.08 + 0.92 * (v / max) : 0})` }}>
                      {v > 0 ? formatCompactUSD(v) : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}
