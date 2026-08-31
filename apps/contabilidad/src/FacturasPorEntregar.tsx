import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { fetchFacturasPorEntregar, type FacturaPorEntregar } from './api';
import DetalleModal from './DetalleModal';

/**
 * Parte de trabajo de bodega: SOLO las facturas cuya mercancía ya facturada sigue sin
 * empaquetar. Deliberadamente NO muestra importes ni cartera — esto no es una vista de
 * facturación, y la app `ov-pendientes` la usa gente que no debe ver esos datos.
 * Al hacer clic se abre el detalle, donde las líneas pendientes salen sombreadas.
 */
export default function FacturasPorEntregar() {
  const [filas, setFilas] = useState<FacturaPorEntregar[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [detalle, setDetalle] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetchFacturasPorEntregar()
      .then((f) => vivo && (setFilas(f), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, []);

  const visibles = useMemo(() => {
    if (!filas) return [];
    const q = filtro.trim().toLowerCase();
    if (!q) return filas;
    return filas.filter(
      (f) =>
        f.invoiceNumber.toLowerCase().includes(q) ||
        f.cliente.toLowerCase().includes(q) ||
        f.ov.toLowerCase().includes(q),
    );
  }, [filas, filtro]);

  const totalUds = useMemo(() => visibles.reduce((a, f) => a + f.unidadesPorDespachar, 0), [visibles]);
  const sel = filas?.find((f) => f.invoiceNumber === detalle);

  return (
    <section className="space-y-3">
      {cargando && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Cargando facturas…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {filas && !cargando && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar factura, cliente u OV…"
              className="w-72 rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none"
            />
            <span className="text-sm text-gray-500">{visibles.length} facturas</span>
            <span className="text-sm text-gray-700">
              Unidades sin empaquetar: <b className="tabular-nums">{totalUds}</b>
            </span>
          </div>

          {filas.length === 0 ? (
            <div className="flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              No hay facturas con mercancía pendiente de empaquetar. Todo lo facturado está preparado.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-soft">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold">FACTURA</th>
                    <th className="px-2 py-2 text-left font-semibold">CLIENTE</th>
                    <th className="px-2 py-2 text-left font-semibold">FECHA</th>
                    <th className="px-2 py-2 text-left font-semibold">OV</th>
                    <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">SIN EMPAQUETAR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibles.map((f) => (
                    <tr
                      key={f.invoiceNumber}
                      onClick={() => setDetalle(f.invoiceNumber)}
                      className="cursor-pointer hover:bg-violet-50/50"
                    >
                      <td className="px-2 py-1 whitespace-nowrap font-medium">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-violet-500 align-middle" />
                        {f.invoiceNumber}
                      </td>
                      <td className="px-2 py-1">{f.cliente || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{f.fecha}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{f.ov || '—'}</td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums text-violet-700">
                        {f.unidadesPorDespachar}
                      </td>
                    </tr>
                  ))}
                  {visibles.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-4 text-center text-gray-400">
                        Ninguna factura coincide con la búsqueda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {detalle && (
        <DetalleModal
          tipo="factura"
          numero={detalle}
          onClose={() => setDetalle(null)}
          indicios={[
            {
              label: 'Entrega pendiente',
              cls: 'bg-violet-500',
              title: `${sel?.unidadesPorDespachar ?? 0} unidad(es) sin empaquetar`,
            },
          ]}
        />
      )}
    </section>
  );
}
