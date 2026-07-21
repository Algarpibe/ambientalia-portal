import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, PieChart, Pie, Cell, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { APP_BASE } from '../appBase';
import {
  fetchCustomerSales,
  fetchCustomerItemSales,
  fetchCustomerMonthSales,
  fetchMarginByCustomer,
  type RecordTypeIO,
} from '../api';
import {
  customerYearSeries,
  customerFirstYear,
  customerTotalVentas,
  customerBuckets,
  customerTopItems,
  customerMonths,
  customerMarginKpi,
} from '../lib/customer-detail';
import { BUCKET_LABELS, type Bucket } from '../lib/customer-item';
import { formatUSD, MONTHS } from '../lib/format';
import { CHART, donutColor } from '../ui/warmTheme';
import { tooltip } from '../ui/ChartTooltip';

const anioActual = new Date().getFullYear();

// Buckets del mix por categoría (la dona usa la rampa cálida vía donutColor).
const BUCKET_KEYS: Bucket[] = ['mano_obra', 'cr', 'equipos', 'operacion'];

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="st-tile p-5">
      <div className="text-[12.5px] font-semibold text-[#6E6B64]">{label}</div>
      <div className="mt-1 text-[24px] font-extrabold tracking-tight text-[#24231F] tabular-nums">{value}</div>
    </div>
  );
}

export default function ClienteDetalle() {
  const { customer = '' } = useParams();
  const nombre = decodeURIComponent(customer);
  const [tipo, setTipo] = useState<RecordTypeIO>('INVOICE');
  const [anio, setAnio] = useState(anioActual);

  const qYears = useQuery({
    queryKey: ['customer-sales', tipo, anioActual - 6, anioActual],
    queryFn: () => fetchCustomerSales({ tipo, desdeAnio: anioActual - 6, hastaAnio: anioActual }),
  });
  const qItems = useQuery({
    queryKey: ['customer-item-sales', tipo, anio],
    queryFn: () => fetchCustomerItemSales({ tipo, anio }),
  });
  const qMonths = useQuery({
    queryKey: ['customer-month-sales', tipo, anio],
    queryFn: () => fetchCustomerMonthSales({ tipo, anio }),
  });
  const qMargin = useQuery({
    queryKey: ['margin-by-customer', tipo, anio],
    queryFn: () => fetchMarginByCustomer({ tipo, anio }),
  });

  const evolucion = customerYearSeries(qYears.data ?? [], nombre);
  const ventasAnio = evolucion.find((p) => p.year === anio)?.ventas ?? 0;
  const ventasHist = customerTotalVentas(qYears.data ?? [], nombre);
  const clienteDesde = customerFirstYear(qYears.data ?? [], nombre);
  const buckets = customerBuckets(qItems.data ?? [], nombre);
  const topItems = customerTopItems(qItems.data ?? [], nombre, 15);
  const meses = customerMonths(qMonths.data ?? [], nombre);
  const margen = customerMarginKpi(qMargin.data ?? [], nombre);

  const mixData = BUCKET_KEYS.map((k) => ({ name: BUCKET_LABELS[k], value: buckets[k] })).filter(
    (d) => d.value > 0
  );
  const estacionalidad = MONTHS.map((m, i) => ({ mes: m, importe: meses[i] }));

  const cargando = qYears.isLoading || qItems.isLoading || qMonths.isLoading || qMargin.isLoading;
  const error = (qYears.error ?? qItems.error ?? qMonths.error ?? qMargin.error) as Error | undefined;

  return (
    <div className="st-page">
      <div className="st-grain" />
      <div className="st-wrap px-6 md:px-8 py-8 space-y-6">
        <header className="space-y-2">
          <Link to={`${APP_BASE}/clientes`} className="text-[#B4541A] hover:underline text-sm">
            ← Volver a Clientes
          </Link>
          <h1 className="text-[26px] font-extrabold tracking-tight text-[#24231F]">{nombre}</h1>
          <p className="text-[#6E6B64]">Ficha de cliente (USD)</p>
        </header>

        <div className="flex flex-wrap items-end gap-3">
          <label className="st-field">
            Tipo
            <select
              className="st-input"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as RecordTypeIO)}
            >
              <option value="INVOICE">Facturas (FAC)</option>
              <option value="SALES_ORDER">Órdenes de Venta (OV)</option>
            </select>
          </label>
          <label className="st-field">
            Año
            <input
              type="number"
              min={2000}
              max={anioActual}
              className="st-input w-24"
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value) || anioActual)}
            />
          </label>
        </div>

        {error ? (
          <div className="text-red-600">{error.message}</div>
        ) : cargando ? (
          <div className="text-[#6E6B64]">Cargando ficha…</div>
        ) : (
          <>
            {/* 1. KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiTile label={`Ventas ${anio}`} value={formatUSD(ventasAnio)} />
              <KpiTile label="Margen %" value={`${margen.margenPct.toFixed(1)}%`} />
              <KpiTile label="Ventas histórico" value={formatUSD(ventasHist)} />
              <KpiTile label="Cliente desde" value={clienteDesde !== null ? String(clienteDesde) : '—'} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 2. Evolución anual */}
              <div className="st-card p-6">
                <h2 className="text-[15px] font-bold tracking-tight text-[#24231F] mb-4">Evolución anual</h2>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={evolucion}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => formatUSD(Number(v))} width={90} tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} />
                    <Tooltip content={tooltip(formatUSD)} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                    <Bar dataKey="ventas" fill={CHART.fac} radius={[4, 4, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* 3. Mix por categoría */}
              <div className="st-card p-6">
                <h2 className="text-[15px] font-bold tracking-tight text-[#24231F] mb-4">Mix por categoría</h2>
                {mixData.length === 0 ? (
                  <div className="text-[#6E6B64]">Sin ventas en {anio}.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={mixData} dataKey="value" nameKey="name" innerRadius={64} outerRadius={100} label>
                        {mixData.map((d, i) => (
                          <Cell key={i} fill={donutColor(i, d.name)} />
                        ))}
                      </Pie>
                      <Tooltip content={tooltip(formatUSD)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* 4. Top artículos */}
              <div className="st-card p-6">
                <h2 className="text-[15px] font-bold tracking-tight text-[#24231F] mb-4">Top artículos ({anio})</h2>
                {topItems.length === 0 ? (
                  <div className="text-[#6E6B64]">Sin ventas en {anio}.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(280, topItems.length * 26)}>
                    <BarChart layout="vertical" data={topItems} margin={{ left: 24 }}>
                      <CartesianGrid horizontal={false} stroke={CHART.grid} />
                      <XAxis type="number" tickFormatter={(v) => formatUSD(Number(v))} tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" width={160} tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} interval={0} />
                      <Tooltip content={tooltip(formatUSD)} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                      <Bar dataKey="importe" fill={CHART.fac} radius={[0, 4, 4, 0]} maxBarSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* 5. Margen */}
              <div className="st-card p-6">
                <h2 className="text-[15px] font-bold tracking-tight text-[#24231F]">Margen ({anio})</h2>
                <p className="mb-4 text-xs text-[#6E6B64]">Margen estimado — costo estándar del maestro.</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <KpiTile label="Ventas" value={formatUSD(margen.ventas)} />
                  <KpiTile label="Costo" value={formatUSD(margen.costo)} />
                  <KpiTile label="Margen" value={formatUSD(margen.margen)} />
                  <KpiTile label="Margen %" value={`${margen.margenPct.toFixed(1)}%`} />
                </div>
              </div>

              {/* 6. Estacionalidad */}
              <div className="st-card p-6 lg:col-span-2">
                <h2 className="text-[15px] font-bold tracking-tight text-[#24231F] mb-4">Estacionalidad ({anio})</h2>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={estacionalidad}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="mes" tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => formatUSD(Number(v))} width={90} tickLine={false} axisLine={false} tick={{ fill: CHART.muted, fontSize: 11 }} />
                    <Tooltip content={tooltip(formatUSD)} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                    <Bar dataKey="importe" fill={CHART.fac} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
