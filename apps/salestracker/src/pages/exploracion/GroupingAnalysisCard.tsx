import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchGroupingAnalysis, type RecordTypeIO } from '../../api';
import { formatUSD } from '../../lib/format';
import { APP_BASE } from '../../appBase';
import { tooltip } from '../../ui/ChartTooltip';
import ChartCard from '../comercial/ChartCard';

export default function GroupingAnalysisCard({ tipo }: { tipo: RecordTypeIO }) {
  const q = useQuery({ queryKey: ['grouping-analysis', tipo], queryFn: () => fetchGroupingAnalysis(tipo) });

  return (
    <ChartCard title="Análisis por agrupaciones" subtitle="Participación promedio por grupo (% del total anual).">
      {q.isLoading ? (
        <p className="text-gray-500">Cargando…</p>
      ) : q.error ? (
        <p className="text-red-600">{(q.error as Error).message}</p>
      ) : !q.data || q.data.rows.length === 0 ? (
        <div className="text-sm text-gray-500">
          <p className="mb-2">Sin agrupaciones definidas. Créalas en la sección Agrupaciones de Categorías.</p>
          <Link className="text-[#B4541A] font-semibold underline" to={`${APP_BASE}/categorias`}>Ir a Categorías</Link>
        </div>
      ) : (
        (() => {
          const { rows, years } = q.data;
          const sorted = [...rows]
            .map((row) => ({ row, total: years.reduce((s, y) => s + (row.years[y]?.amount ?? 0), 0) }))
            .sort((a, b) => b.total - a.total);
          const yearSums = years.map((y) => sorted.reduce((s, { row }) => s + (row.years[y]?.amount ?? 0), 0));
          const grandTotal = sorted.reduce((s, { total }) => s + total, 0);
          const totalPct = sorted.reduce((s, { row }) => s + row.average.percentage, 0);
          const pie = sorted
            .filter(({ row }) => row.average.percentage > 0)
            .map(({ row }) => ({ name: row.groupName, value: row.average.percentage, color: row.color }));

          return (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-1.5 pr-3 text-left font-medium">Grupo</th>
                      {years.map((y) => (
                        <th key={y} className="px-2 py-1.5 font-medium">{y}</th>
                      ))}
                      <th className="px-2 py-1.5 font-medium">Total</th>
                      <th className="pl-2 py-1.5 font-medium">% part.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(({ row, total }) => (
                      <tr key={row.groupId} className="border-b">
                        <td className="py-1.5 pr-3 text-left text-gray-700">
                          <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: row.color }} />
                          {row.groupName}
                        </td>
                        {years.map((y) => (
                          <td key={y} className="px-2 py-1.5">{formatUSD(row.years[y]?.amount ?? 0)}</td>
                        ))}
                        <td className="px-2 py-1.5 font-semibold">{formatUSD(total)}</td>
                        <td className="pl-2 py-1.5">{row.average.percentage.toFixed(1)}%</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 font-semibold text-gray-900">
                      <td className="py-1.5 pr-3 text-left">TOTAL</td>
                      {years.map((y, i) => (
                        <td key={y} className="px-2 py-1.5">{formatUSD(yearSums[i])}</td>
                      ))}
                      <td className="px-2 py-1.5">{formatUSD(grandTotal)}</td>
                      <td className="pl-2 py-1.5">{totalPct.toFixed(1)}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="mt-6 mb-2 text-xs font-medium text-gray-500">Participación promedio por grupo</p>
              <ResponsiveContainer width="100%" height={340}>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={80} outerRadius={130}>
                    {pie.map((p) => (
                      <Cell key={p.name} fill={p.color} />
                    ))}
                  </Pie>
                  <Tooltip content={tooltip((n) => `${n.toFixed(1)}%`)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </>
          );
        })()
      )}
    </ChartCard>
  );
}
