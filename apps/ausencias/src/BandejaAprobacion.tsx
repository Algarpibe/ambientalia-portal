import { useState, type ReactNode } from 'react';
import { Check, Loader2, ShieldAlert, X } from 'lucide-react';
import { decidirSolicitud, type SaldoDeEmpleado, type Solicitud, type SolicitudPendiente } from './api';
import { correoDelTurno } from './dominio';
import TablaSolicitudes from './TablaSolicitudes';
import TarjetaSaldo from './TarjetaSaldo';

interface Props {
  solicitudes: SolicitudPendiente[];
  /** Los saldos de la gente que este usuario aprueba, para decidir con contexto. */
  saldos: SaldoDeEmpleado[];
  onDecidida: (s: Solicitud) => void;
  onError: (mensaje: string) => void;
}

export default function BandejaAprobacion({ solicitudes, saldos, onDecidida, onError }: Props) {
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  // Qué fila ajena ha destapado sus botones. Firmar en lugar de otro exige dos
  // gestos a propósito: es una excepción, no el trabajo de cada día.
  const [destrabando, setDestrabando] = useState<string | null>(null);

  async function decidir(id: string, aprueba: boolean, texto?: string) {
    setOcupada(id);
    try {
      onDecidida(await decidirSolicitud(id, aprueba, texto));
      setRechazando(null);
      setMotivo('');
      setDestrabando(null);
    } catch (e) {
      // No se toca el estado local: la fila se queda como estaba y el usuario ve
      // el porqué. Un 409 aquí significa que ya la decidió alguien.
      onError((e as Error).message);
    } finally {
      setOcupada(null);
    }
  }

  /**
   * Los botones de decidir, iguales le toque a quien le toque.
   *
   * Recibe `Solicitud` y no `SolicitudPendiente` a propósito: no mira el turno
   * —de eso se encarga quien la llama—, así que pedir el campo de más solo
   * ataría esta función a la bandeja sin ganar nada.
   */
  function acciones(s: Solicitud): ReactNode {
    // Solo vacaciones consume saldo; y solo se pinta si el aprobador tiene
    // acceso al saldo de ese empleado (podría faltar y no pasa nada, se omite).
    const saldoSolicitante =
      s.tipo === 'vacaciones' ? saldos.find((sd) => sd.empleadoId === s.empleadoId) : undefined;
    // Qué firma es esta. Sin segundo aprobador no se dice nada: es el caso de
    // siempre y no hay ningún matiz que explicar.
    const primeraDeDos = s.estado === 'pendiente' && !!s.segundoAprobadorCorreo;
    const segundaFirma = s.estado === 'pendiente_2';
    return (
      // w-56 se quedaba corto en cuanto la tarjeta de saldo entró en esta
      // celda: el titular «Saldo de {nombre}: N días» no tiene dónde
      // encoger y con un nombre largo se partía en tres líneas ilegibles.
      // w-72 le da a TarjetaSaldo margen para que, si el nombre no cabe en
      // una línea, envuelva por su cuenta con flex-wrap sin descuadrar el
      // número; con nombres cortos sigue yendo todo en una sola línea. El
      // formulario de rechazo (lo único que llevaba w-56 originalmente)
      // sigue sobrando ancho de sobra a w-72.
      <div className="flex w-72 flex-col gap-2">
        {primeraDeDos && (
          <p className="text-xs text-gray-500">
            1ª de 2 firmas · después pasa a <span className="font-medium">{s.segundoAprobadorCorreo}</span>
          </p>
        )}
        {segundaFirma && <p className="text-xs text-gray-500">2ª firma · con esta queda aprobada</p>}
        {saldoSolicitante && (
          <TarjetaSaldo
            saldo={saldoSolicitante.saldo}
            diasPedidos={s.diasHabiles}
            titulo={`Saldo de ${s.empleadoNombre}`}
          />
        )}
        {rechazando === s.id ? (
          <div className="flex flex-col gap-2">
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
              {/* «Dar visto bueno» y no «Aprobar» cuando solo se sube un
                  escalón: el correo que recibe el empleado al final dice
                  «aprobada», y creer que ya la has aprobado cuando falta otra
                  firma es el malentendido más probable de la cascada. */}
              {primeraDeDos ? 'Dar visto bueno' : 'Aprobar'}
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
        )}
      </div>
    );
  }

  // El servidor manda `esMiTurno` ya resuelto; aquí solo se reparte. Para quien
  // no es admin, `ajenas` está SIEMPRE vacío —la consulta ya filtra por turno—,
  // así que la segunda tabla no existe para casi nadie.
  const mias = solicitudes.filter((s) => s.esMiTurno);
  const ajenas = solicitudes.filter((s) => !s.esMiTurno);

  return (
    <div className="flex flex-col gap-8">
      <TablaSolicitudes
        solicitudes={mias}
        mostrarSolicitante
        vacio="No tienes solicitudes pendientes de aprobar."
        acciones={acciones}
      />

      {ajenas.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-900">Esperando a otra persona</h3>
          <p className="mb-4 flex max-w-3xl items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              Estas <b>no te toca firmarlas</b>: las ves porque administras el portal. Están aquí para
              que puedas destrabarlas si quien tiene que firmar no está disponible. Si firmas en su
              lugar, la solicitud quedará registrada <b>a nombre de esa persona</b>.
            </span>
          </p>
          <TablaSolicitudes
            solicitudes={ajenas}
            mostrarSolicitante
            vacio=""
            acciones={(s) =>
              destrabando === s.id ? (
                <div className="flex w-72 flex-col gap-2">
                  {acciones(s)}
                  <button
                    type="button"
                    onClick={() => { setDestrabando(null); setRechazando(null); }}
                    className="self-start text-xs text-gray-500 underline hover:text-gray-700"
                  >
                    Dejarlo estar
                  </button>
                </div>
              ) : (
                <div className="flex w-72 flex-col gap-1">
                  <p className="text-xs text-gray-600">
                    Esperando la firma de{' '}
                    <span className="font-medium">{correoDelTurno(s) ?? '—'}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setDestrabando(s.id)}
                    className="self-start text-xs text-gray-500 underline hover:text-gray-700"
                  >
                    Firmar en su lugar
                  </button>
                </div>
              )
            }
          />
        </div>
      )}
    </div>
  );
}
