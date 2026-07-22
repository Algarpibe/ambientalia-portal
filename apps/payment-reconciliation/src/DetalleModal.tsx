import { useEffect, useRef, useState } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { fetchFacturaDetalle, fetchOVDetalle, type DetalleFactura, type DetalleOV } from './detalleApi';

type Detalle = (DetalleFactura & { _t: 'factura' }) | (DetalleOV & { _t: 'ov' });
interface Props { tipo: 'factura' | 'ov'; numero: string; onClose: () => void; }

const money = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);

export default function DetalleModal({ tipo, numero, onClose }: Props) {
  const [d, setD] = useState<Detalle | null>(null);
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
    const p = tipo === 'factura'
      ? fetchFacturaDetalle(numero).then((x) => ({ ...x, _t: 'factura' as const }))
      : fetchOVDetalle(numero).then((x) => ({ ...x, _t: 'ov' as const }));
    p.then((x) => vivo && (setD(x), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setLoading(false));
    return () => { vivo = false; };
  }, [tipo, numero]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={onClose}>
      <div ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="detalle-modal-title" className="mt-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl focus:outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h2 id="detalle-modal-title" className="text-lg font-bold text-slate-800">
            {tipo === 'factura' ? 'Factura' : 'Orden de venta'} {numero}
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={20} /></button>
        </div>

        {loading && <div className="flex items-center gap-2 text-slate-500"><Loader2 className="animate-spin" size={18} /> Cargando…</div>}
        {error && <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}</div>}

        {d && !loading && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <Dato k="Cliente" v={d.cliente} />
              <Dato k="NIT" v={d.nit} />
              {d.direccion && <Dato k="Dirección" v={d.direccion} />}
              <Dato k="Fecha" v={d.fecha} />
              {d._t === 'factura' && <Dato k="Vencimiento" v={d.vencimiento} />}
              {d._t === 'ov' && <Dato k="Entrega" v={d.entrega} />}
              <Dato k="Términos" v={d.terminos} />
              {d._t === 'factura' && <Dato k="Orden de venta" v={d.ov} />}
              {d._t === 'factura' && <Dato k="Saldo" v={money(d.saldo)} />}
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-2 text-left font-bold">SKU</th>
                    <th className="px-2 py-2 text-left font-bold">DESCRIPCIÓN</th>
                    <th className="px-2 py-2 text-right font-bold">UDS.</th>
                    <th className="px-2 py-2 text-right font-bold">PRECIO</th>
                    <th className="px-2 py-2 text-right font-bold">TOTAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.lineas.map((l, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1 whitespace-nowrap font-medium text-slate-700">{l.sku || '—'}</td>
                      <td className="px-2 py-1 text-slate-600">{l.nombre || '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{l.cantidad}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{money(l.precio)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{money(l.total)}</td>
                    </tr>
                  ))}
                  {d.lineas.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-center text-slate-400">Sin líneas.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
              <Total k="Subtotal" v={money(d.subtotal)} />
              <Total k="IVA (19%)" v={money(d.iva)} />
              <Total k="Total" v={money(d.total)} fuerte />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-0.5">
      <span className="text-slate-500">{k}</span>
      <span className="text-right font-medium text-slate-800">{v || '—'}</span>
    </div>
  );
}
function Total({ k, v, fuerte }: { k: string; v: string; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between ${fuerte ? 'border-t border-slate-200 pt-1 text-base font-bold text-slate-900' : 'text-slate-600'}`}>
      <span>{k}</span><span className="tabular-nums">{v}</span>
    </div>
  );
}
