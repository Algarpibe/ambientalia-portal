import { Paperclip } from 'lucide-react';
import { descargarAdjunto, type Solicitud } from './api';
import { CHIP_ESTADO, ETIQUETA_TIPO, formatFecha } from './dominio';

interface Props {
  solicitudes: Solicitud[];
  /** Muestra la columna de quién solicita (la bandeja del aprobador la necesita). */
  mostrarSolicitante?: boolean;
  /** Contenido de la última columna: los botones de decisión, si los hay. */
  acciones?: (s: Solicitud) => React.ReactNode;
  vacio: string;
}

export default function TablaSolicitudes({ solicitudes, mostrarSolicitante, acciones, vacio }: Props) {
  if (solicitudes.length === 0) {
    return <p className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">{vacio}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            {mostrarSolicitante && <th className="px-4 py-3 font-medium">Solicitante</th>}
            <th className="px-4 py-3 font-medium">Tipo</th>
            <th className="px-4 py-3 font-medium">Desde</th>
            <th className="px-4 py-3 font-medium">Hasta</th>
            <th className="px-4 py-3 text-right font-medium">Días</th>
            <th className="px-4 py-3 font-medium">Comentarios</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            {acciones && <th className="px-4 py-3 font-medium" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {solicitudes.map((s) => {
            const chip = CHIP_ESTADO[s.estado];
            return (
              <tr key={s.id} className="align-top hover:bg-gray-50">
                {mostrarSolicitante && (
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{s.empleadoNombre}</div>
                    {s.empleadoCargo && <div className="text-xs text-gray-500">{s.empleadoCargo}</div>}
                  </td>
                )}
                <td className="px-4 py-3 text-gray-700">{ETIQUETA_TIPO[s.tipo]}</td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatFecha(s.fechaInicio)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatFecha(s.fechaFin)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-900">{s.diasHabiles}</td>
                <td className="max-w-xs px-4 py-3 text-gray-600">
                  {s.comentarios || <span className="text-gray-300">—</span>}
                  {s.adjunto && (
                    <button
                      type="button"
                      onClick={() => void descargarAdjunto(s.adjunto!)}
                      className="mt-1 flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      {s.adjunto.nombreArchivo}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${chip.clase}`}>
                    {chip.label}
                  </span>
                  {s.motivoRechazo && <div className="mt-1 max-w-xs text-xs text-gray-500">{s.motivoRechazo}</div>}
                </td>
                {acciones && <td className="px-4 py-3">{acciones(s)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
