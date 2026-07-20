import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { fetchMarginByItem, type RecordTypeIO } from '../../api';
import { buildMarginItems, deriveMargin } from '../../lib/analytics-margin';
import { formatUSD, formatCompactUSD } from '../../lib/format';
import ChartCard from '../comercial/ChartCard';
import AmountToggle, { type AmountMode } from './AmountToggle';

const FLOOR_PCT = -50;
export default function MarginScatterCard({ tipo, year }: { tipo: RecordTypeIO; year: number }) {
  const q = useQuery({ queryKey: ['margin-item', tipo, year], queryFn: () => fetchMarginByItem({ tipo, anio: year }) });
  const [mode, setMode] = useState<AmountMode>('pct');
  const { points, overallPct } = useMemo(() => {
    const pts = buildMarginItems(q.data ?? []).map((p) => ({ ...p, yPlot: mode === 'pct' ? Math.max(p.margenPct, FLOOR_PCT) : p.margen }));
    const totV = pts.reduce((s, p) => s + p.ventas, 0);
    const totC = pts.reduce((s, p) => s + p.costo, 0);
    return { points: pts, overallPct: deriveMargin(totV, totC).margenPct };
  }, [q.data, mode]);
  return (
    <ChartCard title={`Importe vs margen ${mode === 'pct' ? '%' : '$'} · ${year}`} subtitle="Cada punto es un artículo (bienes con costo). Gris = equilibrio; ámbar = margen % global. Bajo −50% se recorta.">
      <div className="flex justify-end mb-2"><AmountToggle value={mode} onChange={setMode} /></div>
      {q.isLoading ? <p className="text-gray-500">Cargando…</p> : q.error ? <p className="text-red-600">{(q.error as Error).message}</p> : points.length === 0 ? <p className="text-gray-500">Sin datos.</p> : (
        <ResponsiveContainer width="100%" height={440}>
          <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey="ventas" name="Ventas" tickFormatter={(v) => formatCompactUSD(Number(v))} />
            <YAxis type="number" dataKey="yPlot" name={mode === 'pct' ? 'Margen %' : 'Margen $'} domain={mode === 'pct' ? [FLOOR_PCT, 100] : ['auto', 'auto']} ticks={mode === 'pct' ? [-50, -25, 0, 25, 50, 75, 100] : undefined} allowDataOverflow={mode === 'pct'} tickFormatter={mode === 'pct' ? (v) => `${Math.round(Number(v))}%` : (v) => formatCompactUSD(Number(v))} />
            <ZAxis range={[30, 30]} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v, n) => (n === 'Ventas' ? formatUSD(Number(v)) : n === 'Margen %' ? `${Number(v).toFixed(1)}%` : formatUSD(Number(v)))} />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" />
            {mode === 'pct' && <ReferenceLine y={overallPct} stroke="#f59e0b" strokeDasharray="4 4" />}
            <Scatter data={points} fill="#6366f1" fillOpacity={0.6} />
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
