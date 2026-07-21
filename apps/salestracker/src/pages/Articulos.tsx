import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchItemSales, type RecordTypeIO, type ItemSalesRow } from '../api';
import {
  filterAndSortItems,
  computeItemTotals,
  precioPromedio,
  categoriaLabel,
  itemsToCsv,
  type ItemSortKey,
  type SortDir,
} from '../lib/item-sales';
import { formatUSD } from '../lib/format';
import ItemCompareTable from './ItemCompareTable';

function itemsToTsv(rows: ItemSalesRow[]): string {
  const header = ['SKU', 'Nombre', 'Categoría', 'Cantidad', 'Importe', 'Precio promedio'];
  const body = rows.map((r) => [
    r.sku ?? '',
    r.nombre,
    categoriaLabel(r),
    String(r.cantidad),
    r.importe.toFixed(2),
    precioPromedio(r).toFixed(2),
  ].join('\t'));
  return [header.join('\t'), ...body].join('\n');
}

const COLUMNS: { key: ItemSortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'sku', label: 'SKU', align: 'left' },
  { key: 'nombre', label: 'Nombre', align: 'left' },
  { key: 'categoria', label: 'Categoría', align: 'left' },
  { key: 'cantidad', label: 'Cantidad', align: 'right' },
  { key: 'importe', label: 'Importe', align: 'right' },
  { key: 'precio', label: 'Precio promedio', align: 'right' },
];

export default function Articulos() {
  const anioActual = new Date().getFullYear();
  const [tipo, setTipo] = useState<RecordTypeIO>('INVOICE');
  const [desde, setDesde] = useState(`${anioActual}-01-01`);
  const [hasta, setHasta] = useState(`${anioActual}-12-31`);
  const [search, setSearch] = useState('');
  const [categoria, setCategoria] = useState('');
  const [sortKey, setSortKey] = useState<ItemSortKey>('importe');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [comparar, setComparar] = useState(false);
  const [anioA, setAnioA] = useState(anioActual);
  const [anioB, setAnioB] = useState(anioActual - 1);

  const q = useQuery({
    queryKey: ['item-sales', tipo, desde, hasta],
    queryFn: () => fetchItemSales({ tipo, desde, hasta }),
  });

  const categorias = useMemo(() => {
    const set = new Set<string>();
    for (const r of q.data ?? []) set.add(categoriaLabel(r));
    return ['', ...[...set].sort((a, b) => a.localeCompare(b, 'es'))];
  }, [q.data]);

  const filtered = useMemo(
    () => filterAndSortItems(q.data ?? [], { search, categoria, sortKey, sortDir }),
    [q.data, search, categoria, sortKey, sortDir]
  );
  const totals = useMemo(() => computeItemTotals(filtered), [filtered]);

  const toggleSort = (key: ItemSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const exportCsv = () => {
    const blob = new Blob([itemsToCsv(filtered)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `articulos-${tipo}-${desde}_${hasta}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copiar = () => {
    void navigator.clipboard.writeText(itemsToTsv(filtered));
  };

  if (q.isLoading)
    return (
      <div className="st-page">
        <div className="st-grain" />
        <div className="st-wrap px-6 md:px-8 py-8 text-[#6E6B64]">Cargando artículos…</div>
      </div>
    );
  if (q.error)
    return (
      <div className="st-page">
        <div className="st-grain" />
        <div className="st-wrap px-6 md:px-8 py-8 text-red-600">{(q.error as Error).message}</div>
      </div>
    );

  const noRows = filtered.length === 0;

  return (
    <div className="st-page">
      <div className="st-grain" />
      <div className="st-wrap px-6 md:px-8 py-8 space-y-6">
        <header>
          <h1 className="text-[26px] font-extrabold tracking-tight text-[#24231F]">Artículos</h1>
          <p className="text-[#6E6B64]">Ventas por artículo (USD)</p>
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
            Desde
            <input
              type="date"
              className="st-input"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </label>

          <label className="st-field">
            Hasta
            <input
              type="date"
              className="st-input"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </label>

          <label className="st-field">
            Buscar
            <input
              type="text"
              placeholder="Buscar SKU o nombre…"
              className="st-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>

          <label className="st-field">
            Categoría
            <select
              className="st-input"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
            >
              {categorias.map((c) => (
                <option key={c} value={c}>{c === '' ? 'Todas las categorías' : c}</option>
              ))}
            </select>
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

          <div className="ml-auto flex gap-2">
            <button type="button" onClick={exportCsv} disabled={noRows} className="st-btn">
              CSV
            </button>
            <button type="button" onClick={copiar} disabled={noRows} className="st-btn">
              Copiar
            </button>
          </div>
        </div>

        {comparar ? (
          <ItemCompareTable tipo={tipo} anioA={anioA} anioB={anioB} search={search} />
        ) : (
          <div className="st-table-wrap">
            <table className="st-table">
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      className={col.align === 'right' ? 'sortable num' : 'sortable'}
                    >
                      {col.label}
                      {sortKey === col.key && (
                        <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.itemId}>
                    <td>{r.sku ?? '—'}</td>
                    <td>{r.nombre}</td>
                    <td>{categoriaLabel(r)}</td>
                    <td className="num">{r.cantidad.toLocaleString('es-CO')}</td>
                    <td className="num">{formatUSD(r.importe)}</td>
                    <td className="num">{formatUSD(precioPromedio(r))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>TOTAL</td>
                  <td />
                  <td />
                  <td className="num">{totals.cantidad.toLocaleString('es-CO')}</td>
                  <td className="num">{formatUSD(totals.importe)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
