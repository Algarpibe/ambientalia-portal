import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { APP_BASE } from '../appBase';
import { fetchCustomerItemSales, type RecordTypeIO } from '../api';
import {
  filterRows,
  groupByCustomer,
  computeGrandTotals,
  bucketForCategory,
  customerItemToCsv,
  BUCKET_LABELS,
  type Bucket,
  type CustomerGroup,
} from '../lib/customer-item';
import { formatUSD } from '../lib/format';
import CustomerItemCompareTable from './CustomerItemCompareTable';

// Mismo layout de columnas que customerItemToCsv, pero unido por tabuladores (para pegar en Excel).
function groupsToTsv(groups: CustomerGroup[], grand: Record<Bucket, number>): string {
  const header = ['SKU', 'Marca', 'Nombre', 'Categoría', 'Cantidad', 'Mano de Obra/Cal', 'C&R', 'Equipos', 'Operación'];
  const lines: (string | number)[][] = [header];
  for (const g of groups) {
    lines.push([g.customer, '', '', '', '', g.totals.mano_obra.toFixed(2), g.totals.cr.toFixed(2), g.totals.equipos.toFixed(2), g.totals.operacion.toFixed(2)]);
    for (const it of g.items) {
      const b = bucketForCategory(it.categoria);
      lines.push([
        it.sku ?? '',
        it.marca ?? '',
        it.nombre,
        it.categoria ?? 'Sin categoría',
        it.cantidad,
        b === 'mano_obra' ? it.importe.toFixed(2) : '',
        b === 'cr' ? it.importe.toFixed(2) : '',
        b === 'equipos' ? it.importe.toFixed(2) : '',
        b === 'operacion' ? it.importe.toFixed(2) : '',
      ]);
    }
  }
  lines.push(['TOTAL', '', '', '', '', grand.mano_obra.toFixed(2), grand.cr.toFixed(2), grand.equipos.toFixed(2), grand.operacion.toFixed(2)]);
  return lines.map((row) => row.join('\t')).join('\n');
}

export default function ClienteArticulo() {
  const anioActual = new Date().getFullYear();
  const [tipo, setTipo] = useState<RecordTypeIO>('INVOICE');
  const [anio, setAnio] = useState(anioActual);
  const [search, setSearch] = useState('');
  const [comparar, setComparar] = useState(false);
  const [anioA, setAnioA] = useState(anioActual);
  const [anioB, setAnioB] = useState(anioActual - 1);

  const q = useQuery({
    queryKey: ['customer-item-sales', tipo, anio],
    queryFn: () => fetchCustomerItemSales({ tipo, anio }),
    enabled: !comparar,
  });

  const rows = q.data ?? [];
  const groups = useMemo(() => groupByCustomer(filterRows(rows, search)), [rows, search]);
  const grand = useMemo(() => computeGrandTotals(groups), [groups]);
  const noRows = groups.length === 0;

  const exportCsv = () => {
    const blob = new Blob([customerItemToCsv(groups, grand)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ventas_cliente_articulo_${tipo}_${anio}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copiar = () => {
    void navigator.clipboard.writeText(groupsToTsv(groups, grand));
  };

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Ventas por cliente × artículo</h1>
        <p className="text-gray-500">Por cliente, importe neto por artículo clasificado en 4 macro-categorías.</p>
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

        {!comparar && (
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
        )}

        <label className="flex flex-col text-sm text-gray-600">
          Buscar
          <input
            type="text"
            placeholder="Buscar cliente, artículo o SKU…"
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
          Comparar años
        </label>

        {comparar && (
          <>
            <label className="flex flex-col text-sm text-gray-600">
              Año A
              <input
                type="number"
                min={2000}
                max={anioActual}
                className="mt-1 w-24 rounded-md border px-2 py-1.5 text-gray-900"
                value={anioA}
                onChange={(e) => setAnioA(Number(e.target.value) || anioActual)}
              />
            </label>
            <label className="flex flex-col text-sm text-gray-600">
              Año B
              <input
                type="number"
                min={2000}
                max={anioActual}
                className="mt-1 w-24 rounded-md border px-2 py-1.5 text-gray-900"
                value={anioB}
                onChange={(e) => setAnioB(Number(e.target.value) || anioActual)}
              />
            </label>
          </>
        )}

        {!comparar && (
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
        )}
      </div>

      {comparar ? (
        <CustomerItemCompareTable tipo={tipo} anioA={anioA} anioB={anioB} search={search} />
      ) : q.isLoading ? (
        <div className="text-gray-600">Cargando…</div>
      ) : q.error ? (
        <div className="text-red-600">{(q.error as Error).message}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-left">Marca</th>
                <th className="px-3 py-2 text-left">Nombre</th>
                <th className="px-3 py-2 text-left">Categoría</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-right">{BUCKET_LABELS.mano_obra}</th>
                <th className="px-3 py-2 text-right">{BUCKET_LABELS.cr}</th>
                <th className="px-3 py-2 text-right">{BUCKET_LABELS.equipos}</th>
                <th className="px-3 py-2 text-right">{BUCKET_LABELS.operacion}</th>
              </tr>
            </thead>
            <tbody>
              {noRows ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-gray-500">
                    Sin ventas en el año seleccionado.
                  </td>
                </tr>
              ) : (
                groups.map((g) => (
                  <Fragment key={g.customer}>
                    <tr className="bg-gray-100 font-semibold border-t">
                      <td className="px-3 py-2" colSpan={5}>
                        <Link
                          to={`${APP_BASE}/clientes/${encodeURIComponent(g.customer)}`}
                          className="text-blue-600 hover:underline"
                        >
                          {g.customer}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right">{formatUSD(g.totals.mano_obra)}</td>
                      <td className="px-3 py-2 text-right">{formatUSD(g.totals.cr)}</td>
                      <td className="px-3 py-2 text-right">{formatUSD(g.totals.equipos)}</td>
                      <td className="px-3 py-2 text-right">{formatUSD(g.totals.operacion)}</td>
                    </tr>
                    {g.items.map((it, i) => {
                      const b = bucketForCategory(it.categoria);
                      return (
                        <tr key={`${g.customer}-${it.sku ?? it.nombre}-${i}`} className="border-t">
                          <td className="px-3 py-2 font-mono text-xs">{it.sku ?? '—'}</td>
                          <td className="px-3 py-2">{it.marca ?? '—'}</td>
                          <td className="px-3 py-2">{it.nombre}</td>
                          <td className="px-3 py-2">{it.categoria ?? 'Sin categoría'}</td>
                          <td className="px-3 py-2 text-right">{it.cantidad.toLocaleString('es-CO')}</td>
                          <td className="px-3 py-2 text-right">{b === 'mano_obra' ? formatUSD(it.importe) : ''}</td>
                          <td className="px-3 py-2 text-right">{b === 'cr' ? formatUSD(it.importe) : ''}</td>
                          <td className="px-3 py-2 text-right">{b === 'equipos' ? formatUSD(it.importe) : ''}</td>
                          <td className="px-3 py-2 text-right">{b === 'operacion' ? formatUSD(it.importe) : ''}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))
              )}
            </tbody>
            {!noRows && (
              <tfoot className="border-t-2 bg-gray-50 font-bold text-gray-900">
                <tr>
                  <td className="px-3 py-2" colSpan={5}>TOTAL ({groups.length} clientes)</td>
                  <td className="px-3 py-2 text-right">{formatUSD(grand.mano_obra)}</td>
                  <td className="px-3 py-2 text-right">{formatUSD(grand.cr)}</td>
                  <td className="px-3 py-2 text-right">{formatUSD(grand.equipos)}</td>
                  <td className="px-3 py-2 text-right">{formatUSD(grand.operacion)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
