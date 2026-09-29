import type { ReactElement } from 'react';
import {
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EvaluationResult } from '../../engine';
import { formatNumber, formatPpb } from '../../lib/format';
import { chartSeries } from '../../lib/results';

/** One hue per cycle; same order everywhere (points, lines, residuals). */
export const CYCLE_COLORS = ['#2563eb', '#059669', '#d97706'];
const IDENTITY = '#9ca3af';

const noShape = () => <g />;
const axisTick = (v: number) => formatNumber(v, 0);

function ChartBox({ title, note, children }: { title: string; note: string; children: ReactElement }) {
  return (
    <figure className="rounded-2xl border border-gray-200 bg-white p-4">
      <figcaption className="mb-2">
        <span className="block text-sm font-semibold text-gray-800">{title}</span>
        <span className="block text-xs text-gray-500">{note}</span>
      </figcaption>
      <div className="h-72 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** y vs x with each cycle's regression line and the 1:1 line; residuals per cycle. */
export default function ResultsCharts({ evaluation }: { evaluation: EvaluationResult }) {
  const s = chartSeries(evaluation);
  const tooltip = (
    <Tooltip
      cursor={{ strokeDasharray: '3 3' }}
      formatter={(v) => formatPpb(Number(v))}
      labelFormatter={() => ''}
    />
  );
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartBox title="Candidato (y) frente a patrón (x)" note="Puntos por ciclo, recta de regresión de cada ciclo (Ec. 5) y línea 1:1 discontinua. ppb.">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis type="number" dataKey="x" name="x" stroke="#6b7280" tickFormatter={axisTick} domain={[0, 'dataMax']} />
          <YAxis type="number" dataKey="y" name="y" stroke="#6b7280" tickFormatter={axisTick} domain={[0, 'dataMax']} width={48} />
          {tooltip}
          <Legend />
          <Scatter name="1:1" data={s.identity} line={{ stroke: IDENTITY, strokeDasharray: '6 4' }} shape={noShape} legendType="plainline" isAnimationActive={false} />
          {s.cycles.map((c, i) => (
            <Scatter key={`p${c.index}`} name={`Ciclo ${c.index}`} data={c.points} fill={CYCLE_COLORS[i % 3]} isAnimationActive={false} />
          ))}
          {s.cycles.map((c, i) =>
            c.line ? (
              <Scatter
                key={`l${c.index}`}
                name={`Recta ciclo ${c.index}`}
                data={c.line}
                line={{ stroke: CYCLE_COLORS[i % 3], strokeWidth: 1.5 }}
                shape={noShape}
                legendType="none"
                isAnimationActive={false}
              />
            ) : null,
          )}
        </ScatterChart>
      </ChartBox>
      <ChartBox title="Residuos" note="y − ŷ de cada punto frente a x, por ciclo. ppb.">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis type="number" dataKey="x" name="x" stroke="#6b7280" tickFormatter={axisTick} />
          <YAxis type="number" dataKey="residual" name="residuo" stroke="#6b7280" tickFormatter={(v: number) => formatNumber(v, 1)} width={48} />
          {tooltip}
          <Legend />
          <ReferenceLine y={0} stroke={IDENTITY} />
          {s.cycles.map((c, i) => (
            <Scatter
              key={c.index}
              name={`Ciclo ${c.index}`}
              data={c.points.filter((p) => p.residual !== null)}
              fill={CYCLE_COLORS[i % 3]}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </ChartBox>
    </div>
  );
}
