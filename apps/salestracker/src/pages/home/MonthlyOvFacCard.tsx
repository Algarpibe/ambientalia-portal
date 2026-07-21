import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { SalesRow } from '../../api';
import { buildMonthlyOvFac } from '../../lib/home-metrics';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import ChartCard from '../comercial/ChartCard';

export default function MonthlyOvFacCard({ rows, year }: { rows: SalesRow[]; year: number }) {
  const data = buildMonthlyOvFac(rows, year);
  const vacio = data.every((d) => d.ov === 0 && d.fac === 0);
  return (
    <ChartCard title="Ventas mensuales OV vs FAC">
      {vacio ? (
        <p className="text-gray-500">Sin datos.</p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="mes" />
            <YAxis tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <Tooltip formatter={(v) => formatUSD(Number(v))} />
            <Legend />
            <Bar dataKey="ov" name="Órdenes (OV)" fill="#6366f1" />
            <Bar dataKey="fac" name="Facturado (FAC)" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
