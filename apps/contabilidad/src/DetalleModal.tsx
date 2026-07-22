import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle, X } from 'lucide-react';
import { fetchFacturaDetalle, fetchOVDetalle, type DetalleFactura, type DetalleOV } from './api';
import { formatCOP } from './format';

type Detalle = (DetalleFactura & { _tipo: 'factura' }) | (DetalleOV & { _tipo: 'ov' });

interface Props { tipo: 'factura' | 'ov'; numero: string; onClose: () => void; }

export default function DetalleModal({ tipo, numero, onClose }: Props) {
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  // FE-414 — mover el foco al diálogo al abrir y devolverlo al cerrar.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();
    return () => prev?.focus();
  }, []);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const p = tipo === 'factura'
      ? fetchFacturaDetalle(numero).then((d) => ({ ...d, _tipo: 'factura' as const }))
      : fetchOVDetalle(numero).then((d) => ({ ...d, _tipo: 'ov' as const }));
    p.then((d) => vivo && (setDetalle(d), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [tipo, numero]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="detalle-modal-title" className="mt-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-strong focus:outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h2 id="detalle-modal-title" className="text-lg font-semibold text-gray-900">
            {tipo === 'factura' ? 'Factura' : 'Orden de venta'} {numero}
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>

        {cargando && <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Cargando…</div>}
        {error && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</div>}

        {detalle && !cargando && (
          <div className="space-y-4">
            {/* Cabecera */}
            <div className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <Dato k="Cliente" v={detalle.cliente} />
              <Dato k="NIT" v={detalle.nit} />
              {detalle.direccion && <Dato k="Dirección" v={detalle.direccion} />}
              <Dato k="Fecha" v={detalle.fecha} />
              {detalle._tipo === 'factura' && <Dato k="Vencimiento" v={detalle.vencimiento} />}
              {detalle._tipo === 'ov' && <Dato k="Entrega" v={detalle.entrega} />}
              <Dato k="Términos" v={detalle.terminos} />
              {detalle._tipo === 'factura' && <Dato k="Orden de venta" v={detalle.ov} />}
              {detalle._tipo === 'factura' && <Dato k="Saldo" v={formatCOP(detalle.saldo)} />}
            </div>

            {/* Líneas */}
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold">SKU</th>
                    <th className="px-2 py-2 text-left font-semibold">DESCRIPCIÓN</th>
                    <th className="px-2 py-2 text-right font-semibold">UDS.</th>
                    <th className="px-2 py-2 text-right font-semibold">PRECIO</th>
                    <th className="px-2 py-2 text-right font-semibold">TOTAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detalle.lineas.map((l, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-1 whitespace-nowrap font-medium">{l.sku || '—'}</td>
                      <td className="px-2 py-1">{l.nombre || '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{l.cantidad}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCOP(l.precio)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCOP(l.total)}</td>
                    </tr>
                  ))}
                  {detalle.lineas.length === 0 && (
                    <tr><td colSpan={5} className="px-2 py-4 text-center text-gray-400">Sin líneas.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Totales */}
            <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
              <Total k="Subtotal" v={detalle.subtotal} />
              <Total k="IVA (19%)" v={detalle.iva} />
              <Total k="Total" v={detalle.total} fuerte />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-100 py-0.5">
      <span className="text-gray-500">{k}</span>
      <span className="text-right font-medium text-gray-900">{v || '—'}</span>
    </div>
  );
}

function Total({ k, v, fuerte }: { k: string; v: number; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between ${fuerte ? 'border-t border-gray-200 pt-1 text-base font-bold text-gray-900' : 'text-gray-600'}`}>
      <span>{k}</span>
      <span className="tabular-nums">{formatCOP(v)}</span>
    </div>
  );
}
