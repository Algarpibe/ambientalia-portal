import { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { decidirSolicitud, type Solicitud } from './api';
import TablaSolicitudes from './TablaSolicitudes';

interface Props {
  solicitudes: Solicitud[];
  onDecidida: (s: Solicitud) => void;
  onError: (mensaje: string) => void;
}

export default function BandejaAprobacion({ solicitudes, onDecidida, onError }: Props) {
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');

  async function decidir(id: string, aprueba: boolean, texto?: string) {
    setOcupada(id);
    try {
      onDecidida(await decidirSolicitud(id, aprueba, texto));
      setRechazando(null);
      setMotivo('');
    } catch (e) {
      // No se toca el estado local: la fila se queda como estaba y el usuario ve
      // el porqué. Un 409 aquí significa que ya la decidió alguien.
      onError((e as Error).message);
    } finally {
      setOcupada(null);
    }
  }

  return (
    <TablaSolicitudes
      solicitudes={solicitudes}
      mostrarSolicitante
      vacio="No tienes solicitudes pendientes de aprobar."
      acciones={(s) =>
        rechazando === s.id ? (
          <div className="flex w-56 flex-col gap-2">
            <input
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo del rechazo"
              aria-label="Motivo del rechazo"
              maxLength={1000}
              className="rounded-xl border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={ocupada === s.id}
                onClick={() => void decidir(s.id, false, motivo)}
                className="flex-1 rounded-xl bg-red-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:bg-gray-300"
              >
                {ocupada === s.id ? 'Rechazando…' : 'Confirmar'}
              </button>
              <button
                type="button"
                onClick={() => { setRechazando(null); setMotivo(''); }}
                className="rounded-xl border border-gray-300 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={ocupada === s.id}
              onClick={() => void decidir(s.id, true)}
              className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:bg-gray-300"
            >
              {ocupada === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Aprobar
            </button>
            <button
              type="button"
              disabled={ocupada === s.id}
              onClick={() => { setRechazando(s.id); setMotivo(''); }}
              className="flex items-center gap-1 rounded-xl border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              Rechazar
            </button>
          </div>
        )
      }
    />
  );
}
