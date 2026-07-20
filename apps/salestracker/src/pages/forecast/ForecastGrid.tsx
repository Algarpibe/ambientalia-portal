import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchSales, type RecordTypeIO } from '../../api';
import { buildForecastInput } from '../../lib/forecast-input';
import { computeForecast } from '../../lib/forecast';
import { formatUSD, formatCompactUSD, MONTHS } from '../../lib/format';
import ChartCard from '../comercial/ChartCard';
import RunRateCard from './RunRateCard';

export default function ForecastGrid({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['sales'], queryFn: fetchSales });
  const { forecast, chartData } = useMemo(() => {
    const rows = q.data ?? [];
    const input = buildForecastInput(rows, { yearA: year, tipo, now: new Date() });
    const fc = computeForecast(input);
    const cd = MONTHS.map((m, i) => ({
      mes: m,
      ventasA: input.currentYearMonthly[i],
      ventasB: input.lastYearMonthly[i],
      tendencia: Math.round(fc.monthlyForecast[i] * 100) / 100,
    }));
    return { forecast: fc, chartData: cd };
  }, [q.data, year, tipo]);

  if (q.isLoading) return <p className="p-8 text-gray-600">Cargando forecast…</p>;
  if (q.error) return <p className="p-8 text-red-600">{(q.error as Error).message}</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <RunRateCard title={`Proyección de cierre · mes actual`} stat={forecast.month} />
        <RunRateCard title={`Proyección de cierre · año ${year}`} stat={forecast.year} />
      </div>
      <ChartCard title={`Proyección estacional ${year}`} subtitle={`Barras: ${year} vs ${year - 1}. Línea: forecast estacional del año.`}>
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="mes" />
            <YAxis tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <Tooltip formatter={(v) => formatUSD(Number(v))} />
            <Legend />
            <Bar dataKey="ventasA" name={`${year}`} fill="#2563eb" />
            <Bar dataKey="ventasB" name={`${year - 1}`} fill="#cbd5e1" />
            <Line dataKey="tendencia" name="Forecast" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
