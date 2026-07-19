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

  if (q.isLoading) return <div className="p-8 text-gray-600">Cargando artículos…</div>;
  if (q.error) return <div className="p-8 text-red-600">{(q.error as Error).message}</div>;

  const noRows = filtered.length === 0;

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Artículos</h1>
        <p className="text-gray-500">Ventas por artículo (USD)</p>
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
          Desde
          <input
            type="date"
            className="mt-1 rounded-md border px-2 py-1.5 text-gray-900"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </label>

        <label className="flex flex-col text-sm text-gray-600">
          Hasta
          <input
            type="date"
            className="mt-1 rounded-md border px-2 py-1.5 text-gray-900"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </label>

        <label className="flex flex-col text-sm text-gray-600">
          Buscar
          <input
            type="text"
            placeholder="Buscar SKU o nombre…"
            className="mt-1 rounded-md border px-2 py-1.5 text-gray-900"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <label className="flex flex-col text-sm text-gray-600">
          Categoría
          <select
            className="mt-1 rounded-md border px-2 py-1.5 text-gray-900"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            {categorias.map((c) => (
              <option key={c} value={c}>{c === '' ? 'Todas las categorías' : c}</option>
            ))}
          </select>
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

      {comparar ? (
        <ItemCompareTable tipo={tipo} anioA={anioA} anioB={anioB} search={search} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`cursor-pointer select-none px-3 py-2 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
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
                <tr key={r.itemId} className="border-t">
                  <td className="px-3 py-2">{r.sku ?? '—'}</td>
                  <td className="px-3 py-2">{r.nombre}</td>
                  <td className="px-3 py-2">{categoriaLabel(r)}</td>
                  <td className="px-3 py-2 text-right">{r.cantidad.toLocaleString('es-CO')}</td>
                  <td className="px-3 py-2 text-right">{formatUSD(r.importe)}</td>
                  <td className="px-3 py-2 text-right">{formatUSD(precioPromedio(r))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-gray-50 font-semibold text-gray-900">
              <tr>
                <td className="px-3 py-2">TOTAL</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right">{totals.cantidad.toLocaleString('es-CO')}</td>
                <td className="px-3 py-2 text-right">{formatUSD(totals.importe)}</td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
