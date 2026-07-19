import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { APP_BASE } from '../appBase';
import { fetchCustomerSales, type RecordTypeIO } from '../api';
import {
  buildCustomerMatrix,
  computeColumnTotals,
  filterCustomers,
  sortCustomerMatrix,
  customerMatrixToCsv,
  type CustomerSortKey,
  type CustomerSortDir,
  type CustomerMatrixRow,
} from '../lib/customer-sales';
import { computeDelta, formatDeltaPct } from '../lib/compare';
import { formatUSD, yearRange } from '../lib/format';

function matrixToTsv(
  matrix: CustomerMatrixRow[],
  years: number[],
  grand: number
): string {
  const pct = (n: number) => (grand > 0 ? `${((n / grand) * 100).toFixed(1)}%` : '0%');
  const header = ['Cliente', ...years.map(String), 'Total', '%'];
  const body = matrix.map((r) => [
    r.customer,
    ...years.map((y) => (r.byYear[y] ?? 0).toFixed(2)),
    r.total.toFixed(2),
    pct(r.total),
  ]);
  const totals = computeColumnTotals(matrix, years);
  const totalRow = [
    'TOTAL',
    ...years.map((y) => totals.byYear[y].toFixed(2)),
    totals.grand.toFixed(2),
    pct(totals.grand),
  ];
  return [header, ...body, totalRow].map((row) => row.join('\t')).join('\n');
}

export default function Clientes() {
  const anioActual = new Date().getFullYear();
  const [tipo, setTipo] = useState<RecordTypeIO>('INVOICE');
  const [desdeAnio, setDesdeAnio] = useState(anioActual - 3);
  const [hastaAnio, setHastaAnio] = useState(anioActual);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<CustomerSortKey>('total');
  const [sortDir, setSortDir] = useState<CustomerSortDir>('desc');
  const [comparar, setComparar] = useState(false);
  const [anioA, setAnioA] = useState(anioActual);
  const [anioB, setAnioB] = useState(anioActual - 1);

  const years = useMemo(
    () =>
      desdeAnio >= 2000 && hastaAnio >= desdeAnio && hastaAnio - desdeAnio <= 30
        ? yearRange(desdeAnio, hastaAnio)
        : [],
    [desdeAnio, hastaAnio]
  );

  const q = useQuery({
    queryKey: ['customer-sales', tipo, desdeAnio, hastaAnio],
    queryFn: () => fetchCustomerSales({ tipo, desdeAnio, hastaAnio }),
  });

  const matrix = useMemo(() => buildCustomerMatrix(q.data ?? []), [q.data]);
  const filtered = useMemo(() => filterCustomers(matrix, search), [matrix, search]);
  const sorted = useMemo(
    () => sortCustomerMatrix(filtered, sortKey, sortDir, comparar ? { a: anioA, b: anioB } : undefined),
    [filtered, sortKey, sortDir, comparar, anioA, anioB]
  );
  const totals = useMemo(() => computeColumnTotals(sorted, years), [sorted, years]);
  const grand = totals.grand;

  const pct = (n: number) => (grand > 0 ? `${((n / grand) * 100).toFixed(1)}%` : '0%');

  const toggleSort = (key: CustomerSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const exportCsv = () => {
    const blob = new Blob([customerMatrixToCsv(sorted, years, grand)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clientes-${tipo}-${desdeAnio}_${hastaAnio}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copiar = () => {
    void navigator.clipboard.writeText(matrixToTsv(sorted, years, grand));
  };

  if (q.isLoading) return <div className="p-8 text-gray-600">Cargando clientes…</div>;
  if (q.error) return <div className="p-8 text-red-600">{(q.error as Error).message}</div>;

  const noRows = sorted.length === 0;
  const sortIcon = (active: boolean) =>
    active ? <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span> : null;

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
        <p className="text-gray-500">Ventas por cliente y año (USD)</p>
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
          Desde año
          <input
            type="number"
            className="mt-1 w-24 rounded-md border px-2 py-1.5 text-gray-900"
            value={desdeAnio}
            onChange={(e) => setDesdeAnio(Number(e.target.value))}
          />
        </label>

        <label className="flex flex-col text-sm text-gray-600">
          Hasta año
          <input
            type="number"
            className="mt-1 w-24 rounded-md border px-2 py-1.5 text-gray-900"
            value={hastaAnio}
            onChange={(e) => setHastaAnio(Number(e.target.value))}
          />
        </label>

        <label className="flex flex-col text-sm text-gray-600">
          Buscar
          <input
            type="text"
            placeholder="Buscar cliente…"
            className="mt-1 rounded-md border px-2 py-1.5 text-gray-900"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={comparar}
            onChange={(e) => setComparar(e.target.checked)}
          />
          Comparar
        </label>

        {comparar && (
          <>
            <label className="flex flex-col text-sm text-gray-600">
              Año A
              <input
                type="number"
                className="mt-1 w-24 rounded-md border px-2 py-1.5 text-gray-900"
                value={anioA}
                onChange={(e) => setAnioA(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col text-sm text-gray-600">
              Año B
              <input
                type="number"
                className="mt-1 w-24 rounded-md border px-2 py-1.5 text-gray-900"
                value={anioB}
                onChange={(e) => setAnioB(Number(e.target.value))}
              />
            </label>
          </>
        )}

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={noRows}
            className="rounded-md border px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            CSV
          </button>
          <button
            type="button"
            onClick={copiar}
            disabled={noRows}
            className="rounded-md border px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Copiar
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th
                onClick={() => toggleSort('customer')}
                className="cursor-pointer select-none px-3 py-2 text-left"
              >
                Cliente{sortIcon(sortKey === 'customer')}
              </th>
              {years.map((y) => (
                <th
                  key={y}
                  onClick={() => toggleSort(y)}
                  className="cursor-pointer select-none px-3 py-2 text-right"
                >
                  {y}{sortIcon(sortKey === y)}
                </th>
              ))}
              <th
                onClick={() => toggleSort('total')}
                className="cursor-pointer select-none px-3 py-2 text-right"
              >
                Total{sortIcon(sortKey === 'total')}
              </th>
              <th className="px-3 py-2 text-right">%</th>
              {comparar && (
                <th
                  onClick={() => toggleSort('delta')}
                  className="cursor-pointer select-none px-3 py-2 text-right"
                >
                  Δ%{sortIcon(sortKey === 'delta')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const deltaPct = comparar
                ? computeDelta(r.byYear[anioA] ?? 0, r.byYear[anioB] ?? 0).deltaPct
                : null;
              return (
                <tr key={r.customer} className="border-t">
                  <td className="px-3 py-2">
                    <Link
                      to={`${APP_BASE}/clientes/${encodeURIComponent(r.customer)}`}
                      className="text-blue-600 hover:underline"
                    >
                      {r.customer}
                    </Link>
                  </td>
                  {years.map((y) => (
                    <td key={y} className="px-3 py-2 text-right">{formatUSD(r.byYear[y] ?? 0)}</td>
                  ))}
                  <td className="px-3 py-2 text-right">{formatUSD(r.total)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.total)}</td>
                  {comparar && (
                    <td
                      className={`px-3 py-2 text-right ${
                        deltaPct !== null && deltaPct < 0
                          ? 'text-red-600'
                          : deltaPct !== null && deltaPct > 0
                          ? 'text-green-600'
                          : ''
                      }`}
                    >
                      {formatDeltaPct(deltaPct)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t bg-gray-50 font-semibold text-gray-900">
            <tr>
              <td className="px-3 py-2">TOTAL</td>
              {years.map((y) => (
                <td key={y} className="px-3 py-2 text-right">{formatUSD(totals.byYear[y])}</td>
              ))}
              <td className="px-3 py-2 text-right">{formatUSD(totals.grand)}</td>
              <td className="px-3 py-2 text-right">{pct(totals.grand)}</td>
              {comparar && <td className="px-3 py-2" />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
