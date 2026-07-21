import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { SalesRow } from '../../api';
import { buildExecutionMonthly, buildMonthlyOvFac } from '../../lib/home-metrics';
import ChartCard from '../comercial/ChartCard';

export default function ExecutionMonthlyCard({ rows, year }: { rows: SalesRow[]; year: number }) {
  const data = buildExecutionMonthly(rows, year);
  const mov = buildMonthlyOvFac(rows, year);
  const vacio = mov.every((m) => m.ov === 0 && m.fac === 0);
  return (
    <ChartCard title="Ejecución mensual (FAC/OV)">
      {vacio ? (
        <p className="text-gray-500">Sin datos.</p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="mes" />
            <YAxis domain={[0, (max: number) => Math.max(100, max)]} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
            <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Bar dataKey="pct" name="% Ejecución" fill="#0ea5e9" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
