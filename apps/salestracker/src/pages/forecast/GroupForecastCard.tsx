import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchGroupingAnalysis, type RecordTypeIO } from '../../api';
import { formatUSD, formatCompactUSD, MONTHS } from '../../lib/format';
import { calculateSeasonalityFactors, getSeasonalForecast, calculateRunRate } from '../../lib/math-utils';
import { APP_BASE } from '../../appBase';
import { CHART } from '../../ui/warmTheme';
import { tooltip } from '../../ui/ChartTooltip';
import ChartCard from '../comercial/ChartCard';

export default function GroupForecastCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['grouping-analysis', tipo], queryFn: () => fetchGroupingAnalysis(tipo) });

  return (
    <ChartCard
      title="Forecast estacional por grupo"
      subtitle="Barras = ventas reales del año; línea = proyección total (estacionalidad histórica + run-rate del mes en curso)."
    >
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
          const { rows } = q.data;
          const baseYear = year;
          const now = new Date();
          const isCurrentYear = baseYear === now.getFullYear();
          const currentMonthIdx = now.getMonth(); // 0..11
          const lastElapsedMonth = isCurrentYear ? currentMonthIdx + 1 : 12;
          const histYears = [baseYear - 1, baseYear - 2, baseYear - 3];

          // Precompute forecast per group once (nothing here depends on the month index).
          const perGroup = rows.map((r) => {
            const histMatrix = histYears.map((y) => MONTHS.map((_, m) => r.months[y]?.[m + 1] ?? 0));
            const factors = calculateSeasonalityFactors(histMatrix, [3, 2, 1]);
            const rawCur = MONTHS.map((_, m) => r.months[baseYear]?.[m + 1] ?? 0);
            const elapsed = rawCur.slice(0, lastElapsedMonth);
            if (isCurrentYear && elapsed.length > currentMonthIdx) {
              const totalDays = new Date(now.getFullYear(), currentMonthIdx + 1, 0).getDate();
              elapsed[currentMonthIdx] = calculateRunRate(elapsed[currentMonthIdx] ?? 0, now.getDate(), totalDays);
            }
            const projected = getSeasonalForecast(elapsed, factors);
            return { row: r, projected };
          });

          const chartData = MONTHS.map((label, idx) => {
            const monthNum = idx + 1;
            const entry: Record<string, string | number> = { eje: label };
            let totalForecast = 0;
            perGroup.forEach(({ row, projected }) => {
              totalForecast += Math.round((projected[idx] || 0) * 100) / 100;
              entry[row.groupName] = monthNum <= lastElapsedMonth ? (row.months[baseYear]?.[monthNum] ?? 0) : 0;
            });
            entry.total_forecast = totalForecast;
            return entry;
          });

          return (
            <ResponsiveContainer width="100%" height={440}>
              <ComposedChart data={chartData}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="eje" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} tickFormatter={(v) => formatCompactUSD(Number(v))} />
                <Tooltip content={tooltip(formatUSD)} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                <Legend />
                {rows.map((r) => (
                  <Bar key={r.groupId} dataKey={r.groupName} stackId="g" fill={r.color} />
                ))}
                <Line
                  type="monotone"
                  dataKey="total_forecast"
                  name="Forecast total"
                  stroke={CHART.accent}
                  strokeWidth={3}
                  strokeDasharray="6 4"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          );
        })()
      )}
    </ChartCard>
  );
}
