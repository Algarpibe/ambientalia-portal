import { useState } from 'react';
import type { RecordTypeIO } from '../api';
import BucketMixCard from './comercial/BucketMixCard';
import ClientParetoCard from './comercial/ClientParetoCard';
import TopItemsCard from './comercial/TopItemsCard';
import SkuParetoCard from './comercial/SkuParetoCard';
import BucketByClientCard from './comercial/BucketByClientCard';
import BrandMixCard from './comercial/BrandMixCard';
import NewVsRecurringCard from './comercial/NewVsRecurringCard';
import MonthHeatmapCard from './comercial/MonthHeatmapCard';
import SeasonByBucketCard from './comercial/SeasonByBucketCard';

const anioActual = new Date().getFullYear();
const YEARS: number[] = [];
for (let y = anioActual; y >= 2021; y--) YEARS.push(y);

export default function Analisis() {
  const [tipo, setTipo] = useState<RecordTypeIO>('INVOICE');
  const [yearA, setYearA] = useState(anioActual);
  const [tab] = useState<'comercial'>('comercial'); // 'margen'/'forecast' en 3B/3C
  void tab;

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Análisis</h1>
        <p className="text-gray-500">Analítica comercial en vivo del hub.</p>
      </header>
      {/* Pestañas (solo Comercial por ahora) */}
      <div className="flex gap-2 border-b">
        <button className="px-3 py-2 text-sm font-medium border-b-2 border-blue-600 text-blue-600">Comercial</button>
      </div>
      {/* Controles compartidos */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={tipo} onChange={(e) => setTipo(e.target.value as RecordTypeIO)} className="rounded-md border px-3 py-1.5 text-sm">
          <option value="INVOICE">Facturas (FAC)</option>
          <option value="SALES_ORDER">Órdenes de Venta (OV)</option>
        </select>
        <select value={yearA} onChange={(e) => setYearA(Number(e.target.value))} className="rounded-md border px-3 py-1.5 text-sm">
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      {/* Grid de tarjetas comerciales */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <BucketMixCard tipo={tipo} />
        <ClientParetoCard tipo={tipo} year={yearA} />
        <TopItemsCard tipo={tipo} year={yearA} />
        <SkuParetoCard tipo={tipo} year={yearA} />
        <BucketByClientCard tipo={tipo} year={yearA} />
        <BrandMixCard tipo={tipo} year={yearA} />
        <NewVsRecurringCard tipo={tipo} />
        <MonthHeatmapCard tipo={tipo} year={yearA} />
        <SeasonByBucketCard tipo={tipo} year={yearA} />
      </div>
    </div>
  );
}
