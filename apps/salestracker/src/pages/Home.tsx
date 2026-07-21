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
import './home/home.css';

export default function Home() {
  const q = useQuery({ queryKey: ['sales'], queryFn: fetchSales });
  const rows = q.data ?? [];

  const anioActual = new Date().getFullYear();
  const years = availableYears(rows);
  const [year, setYear] = useState(anioActual);
  const yearSel = years.includes(year) ? year : (years[0] ?? anioActual);

  if (q.isLoading) return <div className="st-home"><div className="p-10 text-[#6E6B64]">Cargando…</div></div>;
  if (q.error) return <div className="st-home"><div className="p-10 text-red-600">{(q.error as Error).message}</div></div>;

  const k = buildHomeKpis(rows, yearSel);
  const yearOptions = years.length > 0 ? years.slice(0, 4) : [yearSel];

  return (
    <div className="st-home">
      <div className="st-grain" />
      <div className="st-wrap max-w-[1160px] mx-auto px-6 md:px-8 py-10">
        {/* Cabecera */}
        <div className="st-reveal flex items-center justify-between gap-6 flex-wrap mb-6">
          <div>
            <h1 className="text-[34px] leading-[1.05] font-extrabold tracking-tight text-[#24231F]">
              Sales<span className="font-bold text-[#9A968E]">Tracker</span>
            </h1>
            <p className="text-[14.5px] text-[#6E6B64] mt-1.5">Resumen anual de ventas · valores en USD</p>
          </div>
          <div className="st-years" role="group" aria-label="Año">
            {yearOptions.map((y) => (
              <button key={y} type="button" aria-pressed={y === yearSel} onClick={() => setYear(y)}>{y}</button>
            ))}
          </div>
        </div>

        {/* Panel hero con KPIs */}
        <section className="st-panel st-reveal p-6 md:p-7 mb-4" style={{ animationDelay: '70ms' }}>
          <div className="flex items-center justify-between gap-3 mb-5">
            <span className="text-[17px] font-bold tracking-tight text-[#24231F]">Resumen {yearSel}</span>
            <span className="st-status"><span className="dot" />En vivo</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <KpiTile label="Facturado · FAC" value={formatUSD(k.facturado)} deltaPct={computeDelta(k.facturado, k.facturadoPrev).deltaPct} />
            <KpiTile label="Órdenes · OV" value={formatUSD(k.ordenes)} deltaPct={computeDelta(k.ordenes, k.ordenesPrev).deltaPct} />
            <KpiTile label="Backlog" value={formatUSD(k.backlog)} tag="no facturado" />
            <KpiTile label="Ejecución" sublabel="FAC / OV" value={`${k.ejecucion.toFixed(1)}%`} ring={k.ejecucion} />
          </div>
        </section>

        {/* Bento de gráficos */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="st-reveal xl:col-span-2" style={{ animationDelay: '140ms' }}><MonthlyOvFacCard rows={rows} year={yearSel} /></div>
          <div className="st-reveal xl:col-span-1 xl:row-span-2" style={{ animationDelay: '210ms' }}><CategoryMixCard rows={rows} year={yearSel} /></div>
          <div className="st-reveal xl:col-span-2" style={{ animationDelay: '280ms' }}><CumulativeYoYCard rows={rows} year={yearSel} /></div>
          <div className="st-reveal xl:col-span-1" style={{ animationDelay: '350ms' }}><ExecutionMonthlyCard rows={rows} year={yearSel} /></div>
          <div className="st-reveal xl:col-span-2" style={{ animationDelay: '420ms' }}><TopClientesCard year={yearSel} /></div>
        </div>

        <p className="text-xs text-[#9A968E] font-medium mt-8">Datos en vivo desde el hub · valores en USD.</p>
      </div>
    </div>
  );
}
