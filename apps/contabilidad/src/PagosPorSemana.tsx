import { Fragment, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { fetchPagosPorSemana, type SemanaDePagos } from './api';
import { formatMoneda } from './format';

const claveDe = (s: SemanaDePagos) => `${s.anio}-${s.mes}-${s.semana}`;

/**
 * Pagos recibidos agrupados por semana del mes, de la más reciente a la más antigua. Cada
 * semana se despliega para ver sus pagos y a qué facturas (y OV) se aplicó cada uno. Todas
 * llegan plegadas: son siete años de historia.
 */
export default function PagosPorSemana() {
  const [semanas, setSemanas] = useState<SemanaDePagos[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Un Set y no un booleano: a diferencia del aviso de anticipos, aquí puede haber varias
  // semanas abiertas a la vez.
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let vivo = true;
    fetchPagosPorSemana()
      .then((s) => { if (vivo) setSemanas(s); })
      .catch((e: Error) => { if (vivo) setError(e.message); });
    return () => { vivo = false; };
  }, []);

  const alternar = (clave: string) =>
    setAbiertas((prev) => {
      const sig = new Set(prev);
      if (sig.has(clave)) sig.delete(clave);
      else sig.add(clave);
      return sig;
    });

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
      </div>
    );
  }
  if (!semanas) {
    return <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Cargando pagos…</div>;
  }
  if (semanas.length === 0) return <p className="text-sm text-gray-500">No hay pagos registrados.</p>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-soft">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-2 py-2 text-left font-semibold">PERIODO</th>
            <th className="px-2 py-2 text-right font-semibold">PAGOS</th>
            <th className="px-2 py-2 text-right font-semibold">TOTAL COBRADO</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {semanas.map((s) => {
            const clave = claveDe(s);
            const abierta = abiertas.has(clave);
            return (
              <Fragment key={clave}>
                <tr className="hover:bg-gray-50">
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => alternar(clave)}
                      aria-expanded={abierta}
                      className="flex items-center gap-1.5 font-medium text-gray-800"
                    >
                      {abierta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      Semana {s.semana} · {s.etiqueta}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.cantidadPagos}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {/* Un total por moneda: nunca se suman pesos con dólares o euros. */}
                    {s.totales.map((t) => <div key={t.moneda}>{formatMoneda(t.total, t.moneda)}</div>)}
                  </td>
                </tr>
                {abierta && (
                  <tr>
                    <td colSpan={3} className="bg-gray-50/60 px-3 py-2">
                      <table className="min-w-full text-xs">
                        <thead className="text-gray-500">
                          <tr>
                            <th className="px-2 py-1 text-left font-medium">PAGO</th>
                            <th className="px-2 py-1 text-left font-medium">CLIENTE</th>
                            <th className="px-2 py-1 text-left font-medium">FECHA</th>
                            <th className="px-2 py-1 text-left font-medium">MODO</th>
                            <th className="px-2 py-1 text-right font-medium">IMPORTE</th>
                            <th className="px-2 py-1 text-left font-medium">APLICADO A</th>
                            <th className="px-2 py-1 text-right font-medium">SIN APLICAR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.pagos.map((p) => (
                            <tr key={p.numero} className="align-top">
                              <td className="whitespace-nowrap px-2 py-1 font-medium">{p.numero}</td>
                              <td className="px-2 py-1">{p.cliente || '—'}</td>
                              <td className="whitespace-nowrap px-2 py-1">{p.fecha}</td>
                              <td className="px-2 py-1">{p.modo ?? '—'}</td>
                              <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatMoneda(p.importe, p.moneda)}</td>
                              <td className="px-2 py-1">
                                {p.aplicaciones.length === 0
                                  ? '—'
                                  : p.aplicaciones.map((a) => (
                                      <div key={a.factura}>
                                        {a.factura}{a.ov ? ` (${a.ov})` : ''}: {formatMoneda(a.importe, p.moneda)}
                                      </div>
                                    ))}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                                {p.sinAplicar > 0 ? formatMoneda(p.sinAplicar, p.moneda) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
