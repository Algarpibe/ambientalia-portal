import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { fetchAnticiposAtencion, type AnticipoAtencion } from './api';
import { formatCOP } from './format';
import { motivoLegible } from './ovTabla';

/**
 * Aviso de anticipos que requieren atención: los que no se pudieron enlazar con una OV y los
 * que tienen saldo sin aplicar en una OV ya cerrada. Solo se monta en Contabilidad.
 *
 * Nunca estorba: con la lista vacía no pinta nada, y si su petición falla tampoco. La tabla de
 * OV que tiene debajo tiene que seguir funcionando pase lo que pase aquí.
 */
export default function AnticiposAtencion() {
  const [lista, setLista] = useState<AnticipoAtencion[]>([]);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchAnticiposAtencion()
      .then((l) => { if (vivo) setLista(l); })
      .catch((e: Error) => console.error('anticipos-atencion:', e.message));
    return () => { vivo = false; };
  }, []);

  if (lista.length === 0) return null;

  const titulo = lista.length === 1 ? '1 anticipo requiere atención' : `${lista.length} anticipos requieren atención`;

  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 text-sm">
      <button
        type="button"
        onClick={() => setAbierto((x) => !x)}
        aria-expanded={abierto}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-amber-800"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {titulo}
        {abierto ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
      </button>
      {abierto && (
        <div className="overflow-x-auto border-t border-amber-200 bg-white">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">ANTICIPO</th>
                <th className="px-2 py-1.5 text-left font-semibold">CLIENTE</th>
                <th className="px-2 py-1.5 text-left font-semibold">FECHA</th>
                <th className="px-2 py-1.5 text-right font-semibold">COBRADO</th>
                <th className="px-2 py-1.5 text-right font-semibold">SIN APLICAR</th>
                <th className="px-2 py-1.5 text-left font-semibold">MOTIVO</th>
                <th className="px-2 py-1.5 text-left font-semibold">DESCRIPCIÓN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.map((a) => (
                <tr key={a.numero}>
                  <td className="whitespace-nowrap px-2 py-1 font-medium">{a.numero}</td>
                  <td className="px-2 py-1">{a.cliente ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1">{a.fecha ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatCOP(a.cobrado)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatCOP(a.sinAplicar)}</td>
                  <td className="px-2 py-1">{motivoLegible(a)}{a.ov ? ` (${a.ov})` : ''}</td>
                  {/* El texto tal cual se escribió: así el error se ve sin entrar a Zoho. */}
                  <td className="px-2 py-1 text-gray-500" title={a.texto}>{a.texto || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
