import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Save, X } from 'lucide-react';
import { editarSolicitud, type Empleado, type EstadoSolicitud, type Solicitud, type TipoSolicitud } from './api';
import { contarDiasHabiles, ETIQUETA_TIPO, TIPOS } from './dominio';
import { useFocoDeModal } from './focoDeModal';

// Corrección de una fila del registro, para el admin. Sirve sobre todo para dos
// cosas: arreglar un dato que ya venía mal en la hoja, y reasignar una solicitud
// a la persona correcta.
//
// Guardar NO manda correos. Es una corrección del registro, no una decisión;
// aprobar o rechazar se hace en la bandeja, que es donde sí se avisa.

const ESTADOS: { id: EstadoSolicitud; label: string }[] = [
  { id: 'pendiente', label: 'Pendiente' },
  // Tiene que estar: sin él, un admin no podría sacar a mano una solicitud
  // atascada esperando una segunda firma que ya no va a llegar.
  { id: 'pendiente_2', label: 'Pendiente 2ª firma' },
  { id: 'aprobada', label: 'Aprobada' },
  { id: 'rechazada', label: 'Rechazada' },
  { id: 'registrada', label: 'Registrada' },
];

interface Props {
  solicitud: Solicitud;
  empleados: Empleado[];
  festivos: Set<string>;
  onGuardada: (s: Solicitud) => void;
  onCerrar: () => void;
}

const CAMPO =
  'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none';

export default function EditarSolicitud({ solicitud, empleados, festivos, onGuardada, onCerrar }: Props) {
  const [empleadoId, setEmpleadoId] = useState(solicitud.empleadoId);
  const [tipo, setTipo] = useState<TipoSolicitud>(solicitud.tipo);
  const [fechaInicio, setFechaInicio] = useState(solicitud.fechaInicio);
  const [fechaFin, setFechaFin] = useState(solicitud.fechaFin);
  const [dias, setDias] = useState(String(solicitud.diasHabiles));
  const [estado, setEstado] = useState<EstadoSolicitud>(solicitud.estado);
  const [comentarios, setComentarios] = useState(solicitud.comentarios ?? '');
  const [observaciones, setObservaciones] = useState(solicitud.observaciones ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El foco entra aqui al abrir, no sale tabulando y vuelve a su sitio al
  // cerrar; Escape cierra por el mismo camino que el aspa y el clic fuera. El
  // porque de cada decision esta en `focoDeModal.ts`.
  const dialogo = useFocoDeModal<HTMLFormElement>(onCerrar);

  const calculados = useMemo(
    () => contarDiasHabiles(fechaInicio, fechaFin, festivos),
    [fechaInicio, fechaFin, festivos],
  );

  const rangoInvertido = Boolean(fechaInicio && fechaFin && fechaInicio > fechaFin);
  const diasNum = Number(dias.replace(',', '.'));
  const diasValidos = Number.isFinite(diasNum) && diasNum >= 0;
  const puedeGuardar = !rangoInvertido && diasValidos && !guardando;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      onGuardada(
        await editarSolicitud(solicitud.id, {
          empleadoId,
          tipo,
          fechaInicio,
          fechaFin,
          dias: diasNum,
          estado,
          comentarios: comentarios.trim() || null,
          observaciones: observaciones.trim() || null,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={onCerrar}
      role="presentation"
    >
      <form
        ref={dialogo}
        onSubmit={guardar}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Editar solicitud"
        // `-1`: enfocable a mano al abrir, pero fuera del ciclo de tabulacion,
        // para que Tab no gaste una parada en el contenedor.
        tabIndex={-1}
        className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Editar solicitud</h3>
            <p className="text-sm text-gray-500">
              Corrige el registro. No se envía ningún correo: para aprobar o rechazar, usa la bandeja.
            </p>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4">
          <label htmlFor="ed-empleado" className="mb-1 block text-sm font-medium text-gray-700">
            Persona
          </label>
          <select id="ed-empleado" className={CAMPO} value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)}>
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombreCompleto}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="ed-tipo" className="mb-1 block text-sm font-medium text-gray-700">
              Tipo
            </label>
            <select id="ed-tipo" className={CAMPO} value={tipo} onChange={(e) => setTipo(e.target.value as TipoSolicitud)}>
              {/* `ETIQUETA_TIPO` y no `t.label`: aquí el tipo no se elige para
                  HACER algo, se ASIGNA como valor del registro. `t.label` dice
                  «Solicitar compensatorio», que es un verbo, y ofrecer un verbo
                  como valor de una categoría no significa nada en una pantalla
                  de corrección. */}
              {TIPOS.map((t) => (
                <option key={t.id} value={t.id}>
                  {ETIQUETA_TIPO[t.id]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ed-estado" className="mb-1 block text-sm font-medium text-gray-700">
              Estado
            </label>
            <select id="ed-estado" className={CAMPO} value={estado} onChange={(e) => setEstado(e.target.value as EstadoSolicitud)}>
              {ESTADOS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-2 grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="ed-desde" className="mb-1 block text-sm font-medium text-gray-700">
              Desde
            </label>
            <input id="ed-desde" type="date" className={CAMPO} value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ed-hasta" className="mb-1 block text-sm font-medium text-gray-700">
              Hasta
            </label>
            <input id="ed-hasta" type="date" className={CAMPO} value={fechaFin} min={fechaInicio || undefined} onChange={(e) => setFechaFin(e.target.value)} />
          </div>
        </div>
        {rangoInvertido && <p className="mb-2 text-sm text-red-600">La fecha final no puede ser anterior a la inicial.</p>}

        <div className="mb-4">
          <label htmlFor="ed-dias" className="mb-1 block text-sm font-medium text-gray-700">
            Días
          </label>
          <input id="ed-dias" type="text" inputMode="decimal" className={CAMPO} value={dias} onChange={(e) => setDias(e.target.value)} />
          {/* Los días NO se recalculan solos: el histórico está lleno de valores
              que no cuadran con el conteo (medios días, rangos anotados a mano).
              Se ofrece el cálculo, se aplica si quien edita quiere. */}
          {!rangoInvertido && calculados > 0 && Math.abs(diasNum - calculados) > 0.001 && (
            <p className="mt-1 text-xs text-gray-500">
              El conteo de días hábiles de ese rango da {calculados}.{' '}
              <button type="button" onClick={() => setDias(String(calculados))} className="text-blue-600 hover:underline">
                Usar {calculados}
              </button>
            </p>
          )}
          {!diasValidos && <p className="mt-1 text-sm text-red-600">Escribe un número de días válido.</p>}
        </div>

        <div className="mb-4">
          <label htmlFor="ed-com" className="mb-1 block text-sm font-medium text-gray-700">
            Comentarios
          </label>
          <textarea id="ed-com" rows={2} className={CAMPO} value={comentarios} maxLength={2000} onChange={(e) => setComentarios(e.target.value)} />
        </div>

        <div className="mb-5">
          <label htmlFor="ed-obs" className="mb-1 block text-sm font-medium text-gray-700">
            Observaciones <span className="font-normal text-gray-400">(nota interna)</span>
          </label>
          <textarea id="ed-obs" rows={2} className={CAMPO} value={observaciones} maxLength={2000} onChange={(e) => setObservaciones(e.target.value)} />
        </div>

        {/* `role="alert"` por lo mismo que en PedirModificacion, que ya lo
            lleva: el banner sale DESPUES de pulsar y sin mover el foco. Aqui
            ademas el modal se queda abierto y con todo lo escrito intacto, que
            es exactamente lo que parece un guardado que salio bien. */}
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!puedeGuardar}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
