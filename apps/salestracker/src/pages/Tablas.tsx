import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSales, fetchCategories, type RecordType } from '../api';
import {
  availableYears,
  buildCategoryMonthPivot,
  orderAndColorRows,
  pivotToCsv,
  type CategoryMonthPivot,
} from '../lib/category-month-pivot';
import { formatUSD, MONTHS } from '../lib/format';

const TIPOS: { value: RecordType; label: string }[] = [
  { value: 'INVOICE', label: 'Facturas (FAC)' },
  { value: 'SALES_ORDER', label: 'Órdenes de Venta (OV)' },
  { value: 'BACKLOG', label: 'Backlog' },
];

/** TSV del pivote (para portapapeles): mismas filas que el CSV pero separadas por tabuladores. */
function pivotToTsv(p: CategoryMonthPivot): string {
  const header = ['Categoría', ...MONTHS, 'Total'];
  const body = p.rows.map((r) => [r.categoryName, ...r.months.map((v) => v.toFixed(2)), r.total.toFixed(2)]);
  const mensual = ['TOTAL MENSUAL', ...p.monthlyTotals.map((v) => v.toFixed(2)), p.grandTotal.toFixed(2)];
  const acumulado = ['TOTAL ACUMULADO', ...p.cumulative.map((v) => v.toFixed(2)), p.grandTotal.toFixed(2)];
  return [header, ...body, mensual, acumulado].map((row) => row.join('\t')).join('\n');
}

export default function Tablas() {
  const [tipo, setTipo] = useState<RecordType>('INVOICE');
  const [year, setYear] = useState<number>(new Date().getFullYear());

  const q = useQuery({ queryKey: ['sales'], queryFn: fetchSales });
  const cq = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });

  const years = availableYears(q.data ?? []);
  const yearSel = years.includes(year) ? year : (years[0] ?? new Date().getFullYear());
  const pivot = buildCategoryMonthPivot(q.data ?? [], yearSel, tipo);
  const displayRows = orderAndColorRows(pivot.rows, cq.data ?? []);
  const noRows = pivot.rows.length === 0;

  const exportCsv = () => {
    const blob = new Blob([pivotToCsv(pivot)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tablas-${tipo}-${yearSel}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copiar = () => {
    void navigator.clipboard.writeText(pivotToTsv(pivot));
  };

  if (q.isLoading)
    return (
      <div className="st-page">
        <div className="st-grain" />
        <div className="st-wrap px-6 md:px-8 py-8 text-[#6E6B64]">Cargando…</div>
      </div>
    );
  if (q.error)
    return (
      <div className="st-page">
        <div className="st-grain" />
        <div className="st-wrap px-6 md:px-8 py-8 text-red-600">{(q.error as Error).message}</div>
      </div>
    );

  return (
    <div className="st-page">
      <div className="st-grain" />
      <div className="st-wrap px-6 md:px-8 py-8 space-y-6">
        <header>
          <h1 className="text-[26px] font-extrabold tracking-tight text-[#24231F]">Tablas</h1>
          <p className="text-[#6E6B64]">Ventas por categoría y mes (USD).</p>
        </header>

        <div className="flex flex-wrap items-end gap-3">
          <label className="st-field">
            Tipo
            <select
              className="st-input"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as RecordType)}
            >
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          <label className="st-field">
            Año
            <select
              className="st-input"
              value={yearSel}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {(years.length > 0 ? years : [yearSel]).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>

          <div className="ml-auto flex gap-2">
            <button type="button" onClick={exportCsv} disabled={noRows} className="st-btn">
              CSV
            </button>
            <button type="button" onClick={copiar} disabled={noRows} className="st-btn">
              Copiar
            </button>
          </div>
        </div>

        <p className="text-xs text-[#6E6B64]">
          El CSV/portapapeles conserva el orden por total; la tabla se muestra en el orden de configuración.
        </p>

        {noRows ? (
          <div className="st-panel p-8 text-center text-[#6E6B64]">
            Sin datos para {yearSel} / {tipo}.
          </div>
        ) : (
          <div className="st-table-wrap">
            <table className="st-table">
              <thead>
                <tr>
                  <th>Categoría</th>
                  {MONTHS.map((m) => (
                    <th key={m} className="num">{m}</th>
                  ))}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r) => (
                  <tr key={r.categoryName}>
                    <td>
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle"
                        style={{ backgroundColor: r.color ?? '#94a3b8' }}
                      />
                      {r.categoryName}
                    </td>
                    {r.months.map((v, i) => (
                      <td key={i} className="num">{formatUSD(v)}</td>
                    ))}
                    <td className="num font-bold">{formatUSD(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>TOTAL MENSUAL</td>
                  {pivot.monthlyTotals.map((v, i) => (
                    <td key={i} className="num">{formatUSD(v)}</td>
                  ))}
                  <td className="num">{formatUSD(pivot.grandTotal)}</td>
                </tr>
                <tr>
                  <td>TOTAL ACUMULADO</td>
                  {pivot.cumulative.map((v, i) => (
                    <td key={i} className="num">{formatUSD(v)}</td>
                  ))}
                  <td className="num">{formatUSD(pivot.grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
