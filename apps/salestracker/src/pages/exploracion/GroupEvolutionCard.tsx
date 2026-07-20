import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchGroupingAnalysis, type RecordTypeIO } from '../../api';
import { formatUSD, formatCompactUSD, MONTHS } from '../../lib/format';
import { APP_BASE } from '../../appBase';
import ChartCard from '../comercial/ChartCard';

type ViewMode = 'ANNUAL' | 'QUARTERLY' | 'MONTHLY';

const MODES: { value: ViewMode; label: string }[] = [
  { value: 'ANNUAL', label: 'Anual' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'MONTHLY', label: 'Mensual' },
];

const QUARTERS: { label: string; months: number[] }[] = [
  { label: 'Q1', months: [1, 2, 3] },
  { label: 'Q2', months: [4, 5, 6] },
  { label: 'Q3', months: [7, 8, 9] },
  { label: 'Q4', months: [10, 11, 12] },
];

export default function GroupEvolutionCard({ tipo }: { tipo: RecordTypeIO }) {
  const q = useQuery({ queryKey: ['grouping-analysis', tipo], queryFn: () => fetchGroupingAnalysis(tipo) });
  const [viewMode, setViewMode] = useState<ViewMode>('ANNUAL');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const years = q.data?.years ?? [];
  useEffect(() => {
    if (selectedYear === null && years.length > 0) {
      setSelectedYear(years[years.length - 1]);
    }
  }, [years, selectedYear]);

  return (
    <ChartCard title="Evolución por grupo" subtitle="Ventas apiladas por grupo. Cambia la granularidad y el año.">
      {q.isLoading ? (
        <p className="text-gray-500">Cargando…</p>
      ) : q.error ? (
        <p className="text-red-600">{(q.error as Error).message}</p>
      ) : !q.data || q.data.rows.length === 0 ? (
        <div className="text-sm text-gray-500">
          <p className="mb-2">Sin agrupaciones definidas. Créalas en la sección Agrupaciones de Categorías.</p>
          <Link className="text-blue-600 underline" to={`${APP_BASE}/categorias`}>Ir a Categorías</Link>
        </div>
      ) : (
        (() => {
          const data = q.data;
          let chartData: Record<string, string | number>[];
          if (viewMode === 'ANNUAL') {
            chartData = data.years.map((y) => {
              const e: Record<string, string | number> = { eje: String(y) };
              data.rows.forEach((r) => { e[r.groupName] = r.years[y]?.amount ?? 0; });
              return e;
            });
          } else if (viewMode === 'QUARTERLY') {
            chartData = QUARTERS.map((qu) => {
              const e: Record<string, string | number> = { eje: qu.label };
              data.rows.forEach((r) => {
                e[r.groupName] = qu.months.reduce(
                  (s, m) => s + (selectedYear !== null ? (r.months[selectedYear]?.[m] ?? 0) : 0),
                  0,
                );
              });
              return e;
            });
          } else {
            chartData = MONTHS.map((label, i) => {
              const e: Record<string, string | number> = { eje: label };
              data.rows.forEach((r) => {
                e[r.groupName] = selectedYear !== null ? (r.months[selectedYear]?.[i + 1] ?? 0) : 0;
              });
              return e;
            });
          }

          return (
            <>
              {/* Controles */}
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-md border">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setViewMode(m.value)}
                      className={`px-3 py-1.5 text-sm ${viewMode === m.value ? 'bg-blue-600 text-white' : 'text-gray-600'}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {viewMode !== 'ANNUAL' && (
                  <div className="inline-flex rounded-md border">
                    {data.years.map((y) => (
                      <button
                        key={y}
                        type="button"
                        onClick={() => setSelectedYear(y)}
                        className={`px-3 py-1.5 text-sm ${selectedYear === y ? 'bg-blue-600 text-white' : 'text-gray-600'}`}
                      >
                        {y}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <ResponsiveContainer width="100%" height={420}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="eje" />
                  <YAxis tickFormatter={(v) => formatCompactUSD(Number(v))} />
                  <Tooltip formatter={(v) => formatUSD(Number(v))} />
                  <Legend />
                  {data.rows.map((r) => (
                    <Bar key={r.groupId} dataKey={r.groupName} stackId="g" fill={r.color} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </>
          );
        })()
      )}
    </ChartCard>
  );
}
