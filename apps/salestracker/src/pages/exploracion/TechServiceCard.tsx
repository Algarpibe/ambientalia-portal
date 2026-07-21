import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts';
import { fetchSales, type RecordTypeIO } from '../../api';
import { buildTechService, yoy, type TechViewMode } from '../../lib/analytics-exploracion';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import { CHART } from '../../ui/warmTheme';
import { tooltip } from '../../ui/ChartTooltip';
import ChartCard from '../comercial/ChartCard';

const MODES: { value: TechViewMode; label: string }[] = [
  { value: 'MONTHLY', label: 'Mensual' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'ANNUAL', label: 'Anual' },
];

export default function TechServiceCard({ tipo, yearA, yearB }: { tipo: RecordTypeIO; yearA: number; yearB: number }) {
  const [viewMode, setViewMode] = useState<TechViewMode>('QUARTERLY');
  const q = useQuery({ queryKey: ['sales'], queryFn: fetchSales });
  const rows = q.data ?? [];
  const data = buildTechService(rows, { yearA, yearB, tipo, viewMode });
  const totals = data.reduce(
    (acc, p) => ({
      st: acc.st + p.st,
      cr: acc.cr + p.cr,
      total: acc.total + p.total,
      st_prev: acc.st_prev + p.st_prev,
      cr_prev: acc.cr_prev + p.cr_prev,
      total_prev: acc.total_prev + p.total_prev,
    }),
    { st: 0, cr: 0, total: 0, st_prev: 0, cr_prev: 0, total_prev: 0 },
  );
  const hasData = data.some((p) => p.total || p.total_prev);

  return (
    <ChartCard
      title={`Análisis ST vs C&R · ${yearA} vs ${yearB}`}
      subtitle="Servicio Técnico (mano de obra/CAL/ST) vs Consumibles y Repuestos (C&R). Clasificación por categoría."
    >
      {/* Toggle de granularidad */}
      <div className="st-seg flat mb-4">
        {MODES.map((m) => (
          <button key={m.value} type="button" aria-pressed={viewMode === m.value} onClick={() => setViewMode(m.value)}>
            {m.label}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <p className="text-gray-500">Cargando…</p>
      ) : q.error ? (
        <p className="text-red-600">{(q.error as Error).message}</p>
      ) : !hasData ? (
        <p className="text-gray-500">Sin datos.</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={data}>
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} />
              <YAxis yAxisId="left" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} tickFormatter={(v) => formatCompactUSD(Number(v))} />
              <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} tickFormatter={(v) => formatCompactUSD(Number(v))} />
              <Tooltip content={tooltip(formatUSD)} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
              <Legend />
              <Bar yAxisId="left" dataKey="st" name={`ST ${yearA}`} stackId="a" fill={CHART.stack[0]} />
              <Bar yAxisId="left" dataKey="cr" name={`C&R ${yearA}`} stackId="a" fill={CHART.stack[1]} />
              <Bar yAxisId="left" dataKey="st_prev" name={`ST ${yearB}`} stackId="b" fill={CHART.stack[2]} />
              <Bar yAxisId="left" dataKey="cr_prev" name={`C&R ${yearB}`} stackId="b" fill={CHART.stack[3]} />
              <Line yAxisId="right" dataKey="acum" name={`Acum ${yearA}`} stroke={CHART.accent} strokeWidth={3} dot />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Tabla compacta */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="py-1.5 pr-3 text-left font-medium">Concepto</th>
                  {data.map((p) => (
                    <th key={p.label} className="px-2 py-1.5 font-medium">{p.label}</th>
                  ))}
                  <th className="pl-2 py-1.5 font-medium">YTD</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-1.5 pr-3 text-left text-gray-700">Servicio Técnico (ST)</td>
                  {data.map((p) => <td key={p.label} className="px-2 py-1.5">{formatUSD(p.st)}</td>)}
                  <td className="pl-2 py-1.5 font-semibold">{formatUSD(totals.st)}</td>
                </tr>
                <tr className="border-b">
                  <td className="py-1.5 pr-3 text-left text-gray-700">Consumibles (C&R)</td>
                  {data.map((p) => <td key={p.label} className="px-2 py-1.5">{formatUSD(p.cr)}</td>)}
                  <td className="pl-2 py-1.5 font-semibold">{formatUSD(totals.cr)}</td>
                </tr>
                <tr className="border-b font-semibold">
                  <td className="py-1.5 pr-3 text-left text-gray-900">Total</td>
                  {data.map((p) => <td key={p.label} className="px-2 py-1.5">{formatUSD(p.total)}</td>)}
                  <td className="pl-2 py-1.5">{formatUSD(totals.total)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 text-left text-gray-700">Var. acumulada YoY</td>
                  {data.map((p) => {
                    const v = yoy(p.acum, p.acum_prev);
                    return (
                      <td key={p.label} className={`px-2 py-1.5 ${v === null ? 'text-gray-400' : v >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
                      </td>
                    );
                  })}
                  <td className="pl-2 py-1.5" />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </ChartCard>
  );
}
