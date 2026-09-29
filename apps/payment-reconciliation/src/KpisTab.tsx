import { Component, lazy, Suspense, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ReconciledRow } from './types';
import { computeYearlyTrend } from './metrics/yearlyTrendMetrics';
import { computeDelinquencyBands, computeDelinquencyConcentration } from './metrics/delinquencyBreakdown';
import type { ConcentrationRow } from './metrics/delinquencyBreakdown';
import { computeReceivablesAging } from './metrics/agingMetrics';
import type { AgingKey, ReceivablesAging } from './metrics/agingMetrics';
import { computeWorseningClients } from './metrics/worseningClients';
import type { WorseningClientsResult } from './metrics/worseningClients';
import { SkeletonAnalytics } from './SkeletonLoader';

const YearlyTrendCharts = lazy(() => import('./YearlyTrendCharts'));

interface KpisTabProps {
  reconciledData: ReconciledRow[];
  loading?: boolean;
  /** Reference date for "already due"; injectable for tests. */
  today?: Date;
}

// A stale chunk after a deploy (or any render failure) must not take down the whole portal.
class ChartsErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-10 text-center text-slate-500">
        <p>No se pudieron cargar los gráficos.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold"
        >
          Recargar
        </button>
      </div>
    );
  }
}

const oneDecimal = (n: number) =>
  n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const money = (n: number) =>
  n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

const days = (n: number | null) => (n === null ? '—' : `${oneDecimal(n)} días`);

const AGING_LABELS: Record<AgingKey, string> = {
  notDue: 'Por vencer',
  d1_30: '1–30 días',
  d31_60: '31–60 días',
  d61_90: '61–90 días',
  over90: 'Más de 90 días',
};

function ConcentrationTable({ rows }: { rows: ConcentrationRow[] }) {
  const th = 'px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider';
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
      <h3 className="px-6 pt-6 text-sm font-bold text-slate-600 uppercase tracking-wider">Concentración de la mora</h3>
      <table className="w-full text-left border-collapse mt-4">
        <caption className="sr-only">Concentración de la mora por año</caption>
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th scope="col" className={th}>Año</th>
            <th scope="col" className={`${th} text-right`}>Clientes</th>
            <th scope="col" className={`${th} text-right`}>Con mora</th>
            <th scope="col" className={`${th} text-right`}>Suman el 80 %</th>
            <th scope="col" className={th}>Principales</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.year}>
              <td className="px-6 py-4 font-medium text-slate-900">{r.isPartialYear ? `${r.year} (parcial)` : r.year}</td>
              <td className="px-6 py-4 text-right text-slate-600">{r.totalClients}</td>
              <td className="px-6 py-4 text-right text-slate-600">{r.clientsWithDelinquency}</td>
              <td className="px-6 py-4 text-right text-slate-900 font-semibold">{r.clientsFor80 || '—'}</td>
              <td className="px-6 py-4 text-slate-600">
                {r.topClients.length === 0
                  ? '—'
                  : r.topClients.map((c) => `${c.name} (${oneDecimal(c.share)} %)`).join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgingSection({ aging }: { aging: ReceivablesAging }) {
  return (
    <section aria-labelledby="kpis-aging-title" className="bg-white rounded-2xl border border-slate-100 shadow-soft p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h3 id="kpis-aging-title" className="text-sm font-bold text-slate-600 uppercase tracking-wider">
          Cartera por antigüedad (hoy)
        </h3>
        <p className="text-sm text-slate-600">
          Total vencido: <strong className="text-red-700">{money(aging.overdueBalance)}</strong> ·{' '}
          {aging.overdueInvoiceCount} facturas
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {aging.buckets.map((b) => (
          <div
            key={b.key}
            className={`rounded-xl border px-4 py-3 ${b.key === 'notDue' ? 'bg-slate-50 border-slate-100' : 'bg-red-50/40 border-red-100'}`}
          >
            <p className="text-xs font-semibold text-slate-500">{AGING_LABELS[b.key]}</p>
            <p className="text-lg font-bold text-slate-900 truncate" title={money(b.balance)}>{money(b.balance)}</p>
            <p className="text-xs text-slate-500">
              {b.invoiceCount} facturas · {b.clientCount} clientes
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WorseningClientsTable({ result }: { result: WorseningClientsResult }) {
  const th = 'px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider';
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
      <h3 className="px-6 pt-6 text-sm font-bold text-slate-600 uppercase tracking-wider">
        Clientes que empeoraron ({result.previousYear} → {result.currentYear} a la fecha)
      </h3>
      {result.clients.length === 0 ? (
        <p className="px-6 py-6 text-sm text-slate-500">Ningún cliente empeoró frente a {result.previousYear}.</p>
      ) : (
        <table className="w-full text-left border-collapse mt-4">
          <caption className="sr-only">Clientes cuyo DPD subió frente al año anterior</caption>
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th scope="col" className={th}>Cliente</th>
              <th scope="col" className={`${th} text-right`}>DPD {result.previousYear}</th>
              <th scope="col" className={`${th} text-right`}>DPD {result.currentYear}</th>
              <th scope="col" className={`${th} text-right`}>Cambio</th>
              <th scope="col" className={`${th} text-right`}>Saldo vencido hoy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result.clients.map((c) => (
              <tr key={c.name}>
                <td className="px-6 py-4 font-medium text-slate-900">{c.name}</td>
                <td className="px-6 py-4 text-right text-slate-600">{oneDecimal(c.previousDPD)} días</td>
                <td className="px-6 py-4 text-right text-slate-900">{oneDecimal(c.currentDPD)} días</td>
                <td className="px-6 py-4 text-right font-semibold text-red-700">+{oneDecimal(c.change)} días</td>
                <td className="px-6 py-4 text-right text-slate-900">{c.overdueBalance > 0 ? money(c.overdueBalance) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CalculationNotes() {
  return (
    <section
      aria-labelledby="kpis-calculation-title"
      className="bg-white rounded-2xl border border-slate-100 shadow-soft p-6 text-sm text-slate-600"
    >
      <h3 id="kpis-calculation-title" className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-4">
        ¿Cómo se calculan estos indicadores?
      </h3>
      <div className="flex flex-col gap-3">
        <p>
          <strong className="text-slate-800">DPD de una factura</strong> (días de mora): los días entre el
          vencimiento y el pago más tardío. Si la factura todavía tiene saldo, cuenta los días que ese saldo lleva
          vencido hasta hoy. Una factura pagada a tiempo tiene 0 días.
        </p>
        <p>
          <strong className="text-slate-800">DPD promedio</strong> = Σ DPD de cada factura ÷ número de facturas.
          Cada factura pesa igual, sin importar su valor.
        </p>
        <p>
          <strong className="text-slate-800">DPD ponderado por valor</strong> = Σ (DPD × valor de la factura) ÷ Σ
          valor de las facturas. Las facturas grandes pesan más. Si el ponderado supera al promedio, la mora se
          concentra en las facturas de mayor valor.
        </p>
        <p>
          <strong className="text-slate-800">Tramos de mora</strong>: qué parte de las facturas de cada año se pagó
          a tiempo, con 1–15, 16–30, 31–60 o más de 60 días de mora. Muestra si la mora sube por muchos retrasos
          pequeños o por pocos retrasos graves.
        </p>
        <p>
          <strong className="text-slate-800">Concentración de la mora</strong>: la mora de un cliente es Σ (DPD ×
          valor) de sus facturas del año. «Suman el 80 %» es el menor número de clientes cuya mora llega al 80 % de
          la mora total del año; si son pocos, la tendencia la arrastran unos pocos clientes.
        </p>
        <p>
          <strong className="text-slate-800">% del valor a tiempo</strong>: la parte del valor facturado (en pesos)
          que se pagó sin mora. Si el % de facturas a tiempo baja pero el % del valor se mantiene, los retrasos están
          en facturas pequeñas.
        </p>
        <p>
          <strong className="text-slate-800">DSO (días de cobro)</strong>: los días entre la fecha de la factura y el
          último pago; si todavía tiene saldo, hasta hoy. El promedio simple pesa igual cada factura; el ponderado
          pesa por valor. Las facturas pagadas sin un pago registrado no entran en el DSO.
        </p>
        <p>
          <strong className="text-slate-800">Cartera por antigüedad</strong>: el saldo que se debe hoy, según los días
          que lleva vencido. «Por vencer» es el saldo que aún no vence y no suma al total vencido. Incluye todos los
          años, también 2020.
        </p>
        <p>
          <strong className="text-slate-800">Clientes que empeoraron</strong>: compara el DPD promedio de cada cliente
          en lo que va del año con el del año anterior completo. Solo entran clientes con al menos 2 facturas vencidas
          en cada año; se muestran los 10 con mayor aumento. Las facturas del año anterior que siguen sin pagar
          acumulan días hasta hoy, así que la comparación tiende a favorecer al año en curso: un aumento es una señal
          clara.
        </p>
        <p className="text-slate-500">
          Ejemplo: una factura de $1.000.000 pagada a tiempo (0 días) y otra de $9.000.000 con 30 días de mora dan
          un DPD promedio de (0 + 30) ÷ 2 = 15 días y un DPD ponderado de (0 × 1.000.000 + 30 × 9.000.000) ÷
          10.000.000 = 27 días.
        </p>
        <p className="text-slate-500">
          Cada factura cuenta en el año de su vencimiento. Solo entran las ya vencidas; se excluyen las anuladas,
          los borradores y el año 2020, que tiene historial incompleto. El % a tiempo es la parte de las facturas
          con 0 días de mora.
        </p>
      </div>
    </section>
  );
}

export default function KpisTab({ reconciledData, loading = false, today }: KpisTabProps) {
  const rows = useMemo(
    () => computeYearlyTrend(reconciledData, today ?? new Date()),
    [reconciledData, today],
  );

  const bands = useMemo(
    () => computeDelinquencyBands(reconciledData, today ?? new Date()),
    [reconciledData, today],
  );
  const concentration = useMemo(
    () => computeDelinquencyConcentration(reconciledData, today ?? new Date()),
    [reconciledData, today],
  );

  const aging = useMemo(
    () => computeReceivablesAging(reconciledData, today ?? new Date()),
    [reconciledData, today],
  );
  const worsening = useMemo(
    () => computeWorseningClients(reconciledData, today ?? new Date()),
    [reconciledData, today],
  );

  if (loading) return <SkeletonAnalytics cards={3} />;

  const hasAging = aging.buckets.some((b) => b.invoiceCount > 0);
  const emptyTrend = (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-10 text-center text-slate-500">
      No hay facturas vencidas para calcular la tendencia.
    </div>
  );

  if (rows.length === 0 && !hasAging) return emptyTrend;

  const th = 'px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider';

  return (
    <div className="flex flex-col gap-6">
      {hasAging && <AgingSection aging={aging} />}

      {rows.length === 0 ? (
        emptyTrend
      ) : (
        <>
          <p className="text-sm text-slate-500">
            Cada factura cuenta en el año de su <strong>vencimiento</strong> y solo entran las ya vencidas.
            El año en curso se marca con * en los gráficos y como «parcial» en la tabla.
          </p>

          <ChartsErrorBoundary>
            <Suspense fallback={<SkeletonAnalytics cards={2} />}>
              <YearlyTrendCharts rows={rows} bands={bands} />
            </Suspense>
          </ChartsErrorBoundary>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <caption className="sr-only">Tendencia anual de mora por año de vencimiento</caption>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th scope="col" className={th}>Año</th>
                  <th scope="col" className={`${th} text-right`}>Facturas</th>
                  <th scope="col" className={`${th} text-right`}>DPD promedio</th>
                  <th scope="col" className={`${th} text-right`}>DPD ponderado</th>
                  <th scope="col" className={`${th} text-right`}>% a tiempo</th>
                  <th scope="col" className={`${th} text-right`}>% a tiempo (valor)</th>
                  <th scope="col" className={`${th} text-right`}>DSO promedio</th>
                  <th scope="col" className={`${th} text-right`}>DSO ponderado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.year}>
                    <td className="px-6 py-4 font-medium text-slate-900">
                      {r.isPartialYear ? `${r.year} (parcial)` : r.year}
                    </td>
                    <td className="px-6 py-4 text-right text-slate-600">{r.invoiceCount}</td>
                    <td className="px-6 py-4 text-right text-slate-900">{oneDecimal(r.averageDPD)} días</td>
                    <td className="px-6 py-4 text-right text-slate-900">{oneDecimal(r.weightedDPD)} días</td>
                    <td className="px-6 py-4 text-right text-slate-900">{oneDecimal(r.onTimePercentage)} %</td>
                    <td className="px-6 py-4 text-right text-slate-900">{oneDecimal(r.onTimeValuePercentage)} %</td>
                    <td className="px-6 py-4 text-right text-slate-900">{days(r.averageCollectionDays)}</td>
                    <td className="px-6 py-4 text-right text-slate-900">{days(r.weightedCollectionDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <WorseningClientsTable result={worsening} />

          <ConcentrationTable rows={concentration} />
        </>
      )}

      <CalculationNotes />
    </div>
  );
}
