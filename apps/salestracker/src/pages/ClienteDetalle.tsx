import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
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

const anioActual = new Date().getFullYear();

// Paleta para los sectores del pie (mix por categoría/bucket).
const BUCKET_KEYS: Bucket[] = ['mano_obra', 'cr', 'equipos', 'operacion'];
const PIE_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#8b5cf6'];

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white p-6">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">{value}</div>
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
    <div className="p-8 space-y-6">
      <header className="space-y-2">
        <Link to={`${APP_BASE}/clientes`} className="text-sm text-blue-600 hover:underline">
          ← Volver a Clientes
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{nombre}</h1>
        <p className="text-gray-500">Ficha de cliente (USD)</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm text-gray-600">
          Tipo
          <select
            className="mt-1 rounded-md border px-2 py-1.5 text-gray-900"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as RecordTypeIO)}
          >
            <option value="INVOICE">Facturas (FAC)</option>
            <option value="SALES_ORDER">Órdenes de Venta (OV)</option>
          </select>
        </label>
        <label className="flex flex-col text-sm text-gray-600">
          Año
          <input
            type="number"
            min={2000}
            max={anioActual}
            className="mt-1 w-24 rounded-md border px-2 py-1.5 text-gray-900"
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value) || anioActual)}
          />
        </label>
      </div>

      {error ? (
        <div className="text-red-600">{error.message}</div>
      ) : cargando ? (
        <div className="text-gray-600">Cargando ficha…</div>
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
            <div className="rounded-xl border bg-white p-6">
              <h2 className="text-lg font-semibold mb-4">Evolución anual</h2>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={evolucion}>
                  <XAxis dataKey="year" />
                  <YAxis tickFormatter={(v) => formatUSD(Number(v))} width={90} />
                  <Tooltip formatter={(v) => formatUSD(Number(v))} />
                  <Bar dataKey="ventas" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 3. Mix por categoría */}
            <div className="rounded-xl border bg-white p-6">
              <h2 className="text-lg font-semibold mb-4">Mix por categoría</h2>
              {mixData.length === 0 ? (
                <div className="text-gray-500">Sin ventas en {anio}.</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={mixData} dataKey="value" nameKey="name" outerRadius={100} label>
                      {mixData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatUSD(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 4. Top artículos */}
            <div className="rounded-xl border bg-white p-6">
              <h2 className="text-lg font-semibold mb-4">Top artículos ({anio})</h2>
              {topItems.length === 0 ? (
                <div className="text-gray-500">Sin ventas en {anio}.</div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(280, topItems.length * 26)}>
                  <BarChart layout="vertical" data={topItems} margin={{ left: 24 }}>
                    <XAxis type="number" tickFormatter={(v) => formatUSD(Number(v))} />
                    <YAxis type="category" dataKey="label" width={160} />
                    <Tooltip formatter={(v) => formatUSD(Number(v))} />
                    <Bar dataKey="importe" fill="#16a34a" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 5. Margen */}
            <div className="rounded-xl border bg-white p-6">
              <h2 className="text-lg font-semibold">Margen ({anio})</h2>
              <p className="mb-4 text-xs text-gray-500">Margen estimado — costo estándar del maestro.</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiTile label="Ventas" value={formatUSD(margen.ventas)} />
                <KpiTile label="Costo" value={formatUSD(margen.costo)} />
                <KpiTile label="Margen" value={formatUSD(margen.margen)} />
                <KpiTile label="Margen %" value={`${margen.margenPct.toFixed(1)}%`} />
              </div>
            </div>

            {/* 6. Estacionalidad */}
            <div className="rounded-xl border bg-white p-6 lg:col-span-2">
              <h2 className="text-lg font-semibold mb-4">Estacionalidad ({anio})</h2>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={estacionalidad}>
                  <XAxis dataKey="mes" />
                  <YAxis tickFormatter={(v) => formatUSD(Number(v))} width={90} />
                  <Tooltip formatter={(v) => formatUSD(Number(v))} />
                  <Bar dataKey="importe" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
