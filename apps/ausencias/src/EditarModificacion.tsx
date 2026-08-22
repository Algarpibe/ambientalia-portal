import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Save, X } from 'lucide-react';
import { corregirModificacion, type EstadoModificacion, type Movimiento } from './api';
import { contarDiasHabiles } from './dominio';
import { useFocoDeModal } from './focoDeModal';

// Corrección de una fila de MOVIMIENTO del registro: una anulación o un cambio
// de fechas que ya se decidió.
//
// ⚠️ Corrige el asiento, NO la solicitud. Cambiar aquí el estado de una anulación
// de «Aprobada» a «Rechazada» no desanula nada: la solicitud tiene su propia
// fila en este mismo registro, con su propio botón de editar, y es la que dice
// en qué estado quedó. El modal lo avisa por escrito, porque es lo único que
// separa una corrección de un malentendido caro.
//
// Guardar NO manda correos, igual que el de las solicitudes: esto es corregir el
// registro, no decidir. Decidir se hace en la bandeja.

const ESTADOS: { id: EstadoModificacion; label: string }[] = [
  { id: 'pendiente', label: 'Pendiente' },
  { id: 'aprobada', label: 'Aprobada' },
  { id: 'rechazada', label: 'Rechazada' },
  // La retira el propio solicitante, no un jefe. Está en la lista porque el
  // registro la enseña y un admin tiene que poder corregir una fila que quedó
  // con el estado equivocado.
  { id: 'retirada', label: 'Retirada' },
];

/**
 * La fila del registro tal cual, no una `Modificacion` traída aparte.
 *
 * Se puede porque el movimiento YA trae todo lo que este formulario edita: su
 * `id` es el de la modificación (lo pone `SELECT m.id` en el servidor), y
 * `estado`, `motivo`, `fechaInicio`, `fechaFin` y `diasHabiles` son sus valores
 * efectivos. Es la diferencia con el modal de las solicitudes, que sí necesita
 * un GET previo: aquel edita `empleadoId` y `observaciones`, que el movimiento
 * no lleva, y su PATCH sobreescribe la fila entera.
 *
 * `Exclude<…>` y no `Movimiento` a secas: la rama de solicitud tiene su propio
 * modal, y pasarla aquí mandaría un PATCH de modificación contra el id de una
 * solicitud. El compilador es lo único que lo impide — esta app no tiene tests.
 */
type MovimientoDeModificacion = Exclude<Movimiento, { clase: 'solicitud' }>;

interface Props {
  movimiento: MovimientoDeModificacion;
  festivos: Set<string>;
  onGuardada: () => void;
  onCerrar: () => void;
}

const CAMPO =
  'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none';

export default function EditarModificacion({ movimiento, festivos, onGuardada, onCerrar }: Props) {
  // Una anulación no tiene fechas nuevas —los tres campos van a NULL, lo exige un
  // CHECK en la base—, así que su formulario es solo estado y motivo. Y sus
  // `fechaInicio`/`fechaFin` del movimiento son las PREVIAS, no unas nuevas: si
  // se pintaran en unos campos editables, guardar parecería cambiarlas.
  const esAnulacion = movimiento.clase === 'anulacion';

  const [fechaInicio, setFechaInicio] = useState(esAnulacion ? '' : movimiento.fechaInicio);
  const [fechaFin, setFechaFin] = useState(esAnulacion ? '' : movimiento.fechaFin);
  const [dias, setDias] = useState(esAnulacion ? '' : String(movimiento.diasHabiles));
  const [estado, setEstado] = useState<EstadoModificacion>(movimiento.estado);
  const [motivo, setMotivo] = useState(movimiento.motivo ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogo = useFocoDeModal<HTMLFormElement>(onCerrar);

  const calculados = useMemo(
    () => contarDiasHabiles(fechaInicio, fechaFin, festivos),
    [fechaInicio, fechaFin, festivos],
  );

  const rangoInvertido = Boolean(fechaInicio && fechaFin && fechaInicio > fechaFin);
  const diasNum = Number(dias.replace(',', '.'));
  const diasValidos = Number.isFinite(diasNum) && diasNum >= 0;
  // En una anulación las tres validaciones de fecha no aplican: el servidor
  // fuerza esos campos a null sin mirarlos, así que exigirlas aquí bloquearía el
  // botón por unos campos que ni se pintan.
  const puedeGuardar = esAnulacion
    ? !guardando
    : Boolean(fechaInicio) && Boolean(fechaFin) && !rangoInvertido && diasValidos && !guardando;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await corregirModificacion(movimiento.id, {
        estado,
        motivo: motivo.trim() || null,
        // Se mandan solo cuando la clase los admite. El servidor los ignora en
        // una anulación de todos modos —lee la clase de la base, no de aquí—,
        // pero mandar unas fechas que la base va a tirar invita a creer que se
        // guardaron.
        ...(esAnulacion
          ? {}
          : { fechaInicioNueva: fechaInicio, fechaFinNueva: fechaFin, diasHabilesNuevos: diasNum }),
      });
      // Sin argumento: quien llama recarga el registro entero por el MISMO camino
      // que la carga inicial, igual que hace tras corregir una solicitud. Un
      // movimiento tiene campos que la respuesta del PATCH no trae —`decididaPor`,
      // sobre todo—, así que parchear la fila aquí sería otro mapeo capaz de
      // desviarse en silencio.
      onGuardada();
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
        aria-label={esAnulacion ? 'Editar anulación' : 'Editar cambio de fechas'}
        tabIndex={-1}
        className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {esAnulacion ? 'Editar anulación' : 'Editar cambio de fechas'}
            </h3>
            <p className="text-sm text-gray-500">
              Corrige este movimiento del registro. No se envía ningún correo.
            </p>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* El aviso va arriba y no al pie: es lo que evita que alguien cambie el
            estado aquí creyendo que deshace la anulación, guarde, y se vaya
            convencido de que la solicitud volvió a estar vigente. */}
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Esto corrige el <b>movimiento</b>, no la solicitud. Cambiar el estado aquí no deshace lo que
            este movimiento ya hizo — la solicitud tiene su propia fila en el registro, con su propio
            botón de editar.
          </span>
        </div>

        {/* Solo lectura: la persona y el tipo son de la SOLICITUD, y ahí se
            corrigen. Se enseñan para saber sobre qué se está editando —el modal
            se abre desde una tabla larga y sin esto es fácil perder de vista qué
            fila se pulsó—. En una anulación las fechas son las PREVIAS, y por eso
            se enseñan aquí en vez de en unos campos que insinuarían editarlas. */}
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-gray-50 p-3 text-sm">
          <dt className="text-gray-500">Persona</dt>
          <dd className="text-gray-900">{movimiento.empleadoNombre}</dd>
          {esAnulacion && (
            <>
              <dt className="text-gray-500">Días anulados</dt>
              <dd className="text-gray-900">
                {movimiento.fechaInicio} → {movimiento.fechaFin} ({movimiento.diasHabiles} d)
              </dd>
            </>
          )}
        </dl>

        <div className="mb-4">
          <label htmlFor="em-estado" className="mb-1 block text-sm font-medium text-gray-700">
            Estado
          </label>
          <select
            id="em-estado"
            className={CAMPO}
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoModificacion)}
          >
            {ESTADOS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </div>

        {!esAnulacion && (
          <>
            <div className="mb-2 grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="em-desde" className="mb-1 block text-sm font-medium text-gray-700">
                  Nueva desde
                </label>
                <input id="em-desde" type="date" className={CAMPO} value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
              </div>
              <div>
                <label htmlFor="em-hasta" className="mb-1 block text-sm font-medium text-gray-700">
                  Nueva hasta
                </label>
                <input id="em-hasta" type="date" className={CAMPO} value={fechaFin} min={fechaInicio || undefined} onChange={(e) => setFechaFin(e.target.value)} />
              </div>
            </div>
            {rangoInvertido && <p className="mb-2 text-sm text-red-600">La fecha final no puede ser anterior a la inicial.</p>}

            <div className="mb-4">
              <label htmlFor="em-dias" className="mb-1 block text-sm font-medium text-gray-700">
                Días
              </label>
              <input id="em-dias" type="text" inputMode="decimal" className={CAMPO} value={dias} onChange={(e) => setDias(e.target.value)} />
              {/* Se ofrece el conteo, no se impone: mismo criterio que en el
                  modal de las solicitudes, donde el histórico está lleno de
                  medios días que no cuadran con ningún cálculo. */}
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
          </>
        )}

        <div className="mb-5">
          <label htmlFor="em-motivo" className="mb-1 block text-sm font-medium text-gray-700">
            Motivo
          </label>
          <textarea id="em-motivo" rows={2} className={CAMPO} value={motivo} maxLength={2000} onChange={(e) => setMotivo(e.target.value)} />
        </div>

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
