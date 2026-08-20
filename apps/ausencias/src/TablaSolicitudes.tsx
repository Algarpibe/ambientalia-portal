import { Paperclip } from 'lucide-react';
import { descargarAdjunto, type Solicitud } from './api';
import {
  diasDeLaFila,
  fechasDeLaFila,
  CHIP_CAMBIO_PENDIENTE,
  chipDeSolicitud,
  ETIQUETA_TIPO,
  etiquetaMotivo,
  formatInstante,
  resumenPropuesta,
} from './dominio';

interface Props {
  solicitudes: Solicitud[];
  /** Muestra la columna de quién solicita (la bandeja del aprobador la necesita). */
  mostrarSolicitante?: boolean;
  /** Muestra cuándo se cerró la solicitud (el historial del aprobador la necesita). */
  mostrarDecidida?: boolean;
  /** Contenido de la última columna: los botones de decisión, si los hay. */
  acciones?: (s: Solicitud) => React.ReactNode;
  vacio: string;
}

export default function TablaSolicitudes({
  solicitudes,
  mostrarSolicitante,
  mostrarDecidida,
  acciones,
  vacio,
}: Props) {
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
            {mostrarDecidida && <th className="px-4 py-3 font-medium">Decidida</th>}
            {acciones && <th className="px-4 py-3 font-medium" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {solicitudes.map((s) => {
            // `chipDeSolicitud` y NO `chipDe(s.estado)`: una anulación deja la
            // solicitud en `rechazada` y hay que rotularla «Anulada». Ver el
            // porqué entero —y por qué el motivo de debajo cambia de dueño— en
            // `dominio.ts`.
            const chip = chipDeSolicitud(s);
            // Se lee por veracidad: si hub-api todavía no manda el campo, un
            // `undefined` significa «no hay propuesta» y esta tabla se pinta
            // como antes de la feature, en vez de reventar.
            const propuesta = s.modificacionPendiente;
            return (
              <tr key={s.id} className="align-top hover:bg-gray-50">
                {mostrarSolicitante && (
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{s.empleadoNombre}</div>
                    {s.empleadoCargo && <div className="text-xs text-gray-500">{s.empleadoCargo}</div>}
                  </td>
                )}
                <td className="px-4 py-3 text-gray-700">{ETIQUETA_TIPO[s.tipo]}</td>
                {/* Un otorgamiento no tiene rango ni días fuera: su fecha es el
                    día que se trabajó y sus días SUMAN a la bolsa. Las dos
                    reglas viven en `dominio.ts` porque esta tabla y la del
                    registro general las necesitan iguales. */}
                <td className="whitespace-nowrap px-4 py-3 text-gray-700">{fechasDeLaFila(s).desde}</td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                  {fechasDeLaFila(s).hasta || <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-900">{diasDeLaFila(s)}</td>
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
                  {/* El chip del cambio va aquí, debajo del de estado, y no en la
                      columna de acciones: la celda de Estado la pintan las cuatro
                      pantallas que usan esta tabla, y la de acciones solo dos. */}
                  {propuesta && (
                    <div className="mt-1">
                      <span
                        title={resumenPropuesta(propuesta)}
                        className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${CHIP_CAMBIO_PENDIENTE}`}
                      >
                        Cambio pendiente
                      </span>
                    </div>
                  )}
                  {/* La frase se arma entera en una plantilla en vez de pegar la
                      etiqueta y el motivo con etiquetas JSX: un salto de línea
                      entre dos nodos de texto se come el espacio, y aquí eso
                      produciría «Motivo del rechazo:no vienes». */}
                  {s.motivoRechazo && (
                    <div className="mt-1 max-w-xs text-xs text-gray-500">
                      {`${etiquetaMotivo(s)} ${s.motivoRechazo}`}
                    </div>
                  )}
                </td>
                {mostrarDecidida && (
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {formatInstante(s.decididaAt) || <span className="text-gray-300">—</span>}
                  </td>
                )}
                {acciones && <td className="px-4 py-3">{acciones(s)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
