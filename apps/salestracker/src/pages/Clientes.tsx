import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { APP_BASE } from '../appBase';
import { fetchCustomerSales, fetchFavorites, toggleFavorite, type RecordTypeIO } from '../api';
import FavoriteStar from '../components/FavoriteStar';
import SavedViewsMenu from '../components/SavedViewsMenu';
import { type ClientesViewState } from '../lib/clientes-view-state';
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
  const [onlyFav, setOnlyFav] = useState(false);

  const qc = useQueryClient();
  const favQ = useQuery({ queryKey: ['favorites'], queryFn: fetchFavorites });
  const favSet = new Set(favQ.data ?? []);
  const toggleFav = useMutation({
    mutationFn: toggleFavorite,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
  });

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
  // Filtramos por "solo favoritos" ANTES de totales/exportes, igual que el filtro de búsqueda,
  // para que totales y CSV/copia reflejen exactamente las filas visibles.
  const shown = useMemo(
    () => (onlyFav ? sorted.filter((r) => favSet.has(r.customer)) : sorted),
    [sorted, onlyFav, favSet]
  );
  const totals = useMemo(() => computeColumnTotals(shown, years), [shown, years]);
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
    const blob = new Blob([customerMatrixToCsv(shown, years, grand)], { type: 'text/csv;charset=utf-8;' });
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
    void navigator.clipboard.writeText(matrixToTsv(shown, years, grand));
  };

  if (q.isLoading)
    return (
      <div className="st-page">
        <div className="st-grain" />
        <div className="st-wrap px-6 md:px-8 py-8 text-[#6E6B64]">Cargando clientes…</div>
      </div>
    );
  if (q.error)
    return (
      <div className="st-page">
        <div className="st-grain" />
        <div className="st-wrap px-6 md:px-8 py-8 text-red-600">{(q.error as Error).message}</div>
      </div>
    );

  const noRows = shown.length === 0;
  const sortIcon = (active: boolean) =>
    active ? <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span> : null;

  return (
    <div className="st-page">
      <div className="st-grain" />
      <div className="st-wrap px-6 md:px-8 py-8 space-y-6">
        <header>
          <h1 className="text-[26px] font-extrabold tracking-tight text-[#24231F]">Clientes</h1>
          <p className="text-[#6E6B64]">Ventas por cliente y año (USD)</p>
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
            Desde año
            <input
              type="number"
              className="st-input w-24"
              value={desdeAnio}
              onChange={(e) => setDesdeAnio(Number(e.target.value))}
            />
          </label>

          <label className="st-field">
            Hasta año
            <input
              type="number"
              className="st-input w-24"
              value={hastaAnio}
              onChange={(e) => setHastaAnio(Number(e.target.value))}
            />
          </label>

          <label className="st-field">
            Buscar
            <input
              type="text"
              placeholder="Buscar cliente…"
              className="st-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>

          <label className="st-check">
            <input
              type="checkbox"
              checked={comparar}
              onChange={(e) => setComparar(e.target.checked)}
            />
            Comparar
          </label>

          {comparar && (
            <>
              <label className="st-field">
                Año A
                <input
                  type="number"
                  className="st-input w-24"
                  value={anioA}
                  onChange={(e) => setAnioA(Number(e.target.value))}
                />
              </label>
              <label className="st-field">
                Año B
                <input
                  type="number"
                  className="st-input w-24"
                  value={anioB}
                  onChange={(e) => setAnioB(Number(e.target.value))}
                />
              </label>
            </>
          )}

          <label className="st-check">
            <input
              type="checkbox"
              checked={onlyFav}
              onChange={(e) => setOnlyFav(e.target.checked)}
            />
            Solo favoritos
          </label>

          <div className="ml-auto flex items-center gap-2">
            <SavedViewsMenu
              viewKey="clientes"
              currentState={{ tipo, desdeAnio, hastaAnio, search, sortKey, sortDir, comparar, anioA, anioB, onlyFav }}
              onApply={(s: ClientesViewState) => {
                setTipo(s.tipo);
                setDesdeAnio(s.desdeAnio);
                setHastaAnio(s.hastaAnio);
                setSearch(s.search);
                setSortKey(s.sortKey);
                setSortDir(s.sortDir);
                setComparar(s.comparar);
                setAnioA(s.anioA);
                setAnioB(s.anioB);
                setOnlyFav(s.onlyFav);
              }}
            />
            <button type="button" onClick={exportCsv} disabled={noRows} className="st-btn">
              CSV
            </button>
            <button type="button" onClick={copiar} disabled={noRows} className="st-btn">
              Copiar
            </button>
          </div>
        </div>

        <div className="st-table-wrap">
          <table className="st-table">
            <thead>
              <tr>
                <th className="w-8" aria-label="Favorito" />
                <th onClick={() => toggleSort('customer')} className="sortable">
                  Cliente{sortIcon(sortKey === 'customer')}
                </th>
                {years.map((y) => (
                  <th key={y} onClick={() => toggleSort(y)} className="sortable num">
                    {y}{sortIcon(sortKey === y)}
                  </th>
                ))}
                <th onClick={() => toggleSort('total')} className="sortable num">
                  Total{sortIcon(sortKey === 'total')}
                </th>
                <th className="num">%</th>
                {comparar && (
                  <th onClick={() => toggleSort('delta')} className="sortable num">
                    Δ%{sortIcon(sortKey === 'delta')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const deltaPct = comparar
                  ? computeDelta(r.byYear[anioA] ?? 0, r.byYear[anioB] ?? 0).deltaPct
                  : null;
                return (
                  <tr key={r.customer}>
                    <td className="text-center">
                      <FavoriteStar
                        active={favSet.has(r.customer)}
                        onToggle={() => toggleFav.mutate(r.customer)}
                      />
                    </td>
                    <td>
                      <Link to={`${APP_BASE}/clientes/${encodeURIComponent(r.customer)}`}>
                        {r.customer}
                      </Link>
                    </td>
                    {years.map((y) => (
                      <td key={y} className="num">{formatUSD(r.byYear[y] ?? 0)}</td>
                    ))}
                    <td className="num">{formatUSD(r.total)}</td>
                    <td className="num">{pct(r.total)}</td>
                    {comparar && (
                      <td
                        className="num"
                        style={
                          deltaPct !== null
                            ? { color: deltaPct >= 0 ? '#346538' : '#9F2F2D' }
                            : undefined
                        }
                      >
                        {formatDeltaPct(deltaPct)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>TOTAL</td>
                {years.map((y) => (
                  <td key={y} className="num">{formatUSD(totals.byYear[y])}</td>
                ))}
                <td className="num">{formatUSD(totals.grand)}</td>
                <td className="num">{pct(totals.grand)}</td>
                {comparar && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
