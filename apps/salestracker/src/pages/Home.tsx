import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSales } from '../api';
import { availableYears } from '../lib/category-month-pivot';
import { buildHomeKpis } from '../lib/home-metrics';
import { computeDelta } from '../lib/compare';
import { formatUSD } from '../lib/format';
import KpiTile from './home/KpiTile';
import MonthlyOvFacCard from './home/MonthlyOvFacCard';
import CumulativeYoYCard from './home/CumulativeYoYCard';
import ExecutionMonthlyCard from './home/ExecutionMonthlyCard';
import CategoryMixCard from './home/CategoryMixCard';
import TopClientesCard from './home/TopClientesCard';

export default function Home() {
  const q = useQuery({ queryKey: ['sales'], queryFn: fetchSales });
  const rows = q.data ?? [];

  const anioActual = new Date().getFullYear();
  const years = availableYears(rows);
  const [year, setYear] = useState(anioActual);
  const yearSel = years.includes(year) ? year : (years[0] ?? anioActual);

  if (q.isLoading) return <div className="p-8 text-gray-600">Cargando…</div>;
  if (q.error) return <div className="p-8 text-red-600">{(q.error as Error).message}</div>;

  const k = buildHomeKpis(rows, yearSel);

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <header>
          <h1 className="text-2xl font-bold text-gray-900">SalesTracker</h1>
          <p className="text-gray-500">Resumen anual de ventas (USD).</p>
        </header>
        <label className="flex flex-col text-sm text-gray-600">
          Año
          <select
            className="mt-1 rounded-md border px-2 py-1.5 text-gray-900"
            value={yearSel}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {(years.length > 0 ? years : [yearSel]).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiTile label="Facturado (FAC)" value={formatUSD(k.facturado)} deltaPct={computeDelta(k.facturado, k.facturadoPrev).deltaPct} />
        <KpiTile label="Órdenes (OV)" value={formatUSD(k.ordenes)} deltaPct={computeDelta(k.ordenes, k.ordenesPrev).deltaPct} />
        <KpiTile label="Backlog" value={formatUSD(k.backlog)} />
        <KpiTile label="% Ejecución" value={`${k.ejecucion.toFixed(1)}%`} deltaPct={computeDelta(k.ejecucion, k.ejecucionPrev).deltaPct} hint="FAC / OV" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <MonthlyOvFacCard rows={rows} year={yearSel} />
        <CumulativeYoYCard rows={rows} year={yearSel} />
        <ExecutionMonthlyCard rows={rows} year={yearSel} />
        <CategoryMixCard rows={rows} year={yearSel} />
        <TopClientesCard year={yearSel} />
      </div>
    </div>
  );
}
