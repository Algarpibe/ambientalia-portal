import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Loader2, Paperclip, X } from 'lucide-react';
import { leerComoBase64, registrarIncapacidadAjena, type Empleado, type Solicitud } from './api';
import { hoyEnColombia } from './dominio';
import { useFocoDeModal } from './focoDeModal';

// El administrador registra una incapacidad a nombre de otro, desde el Registro
// general (spec 2026-11-23-incapacidad-por-admin). Es un componente propio y no
// `FormularioSolicitud`: aquel es el del empleado —elige el tipo, enseña su
// saldo, le habla en segunda persona y acota la incapacidad a dos días atrás—,
// y aquí hay un solo tipo, una persona que elegir y ninguna ventana hacia atrás.
//
// Las reglas de verdad las pone el servidor (`validarIncapacidadAjena`). Lo de
// aquí es ayuda para no mandar algo que va a rebotar: el `max` de un input se
// salta tecleando, y por eso Guardar mira también las fechas.

/** El tope del PDF: el mismo que el formulario del empleado y que `MAX_ADJUNTO_BYTES` en hub-api. */
const MAX_PDF_BYTES = 8 * 1024 * 1024;

const CAMPO =
  'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none';
const ROTULO = 'mb-1 block text-sm font-medium text-gray-700';

interface Props {
  /** Las fichas que carga el Registro. Trae también las inactivas: aquí se filtran. */
  empleados: Empleado[];
  onRegistrada: (s: Solicitud) => void;
  onCerrar: () => void;
}

export default function RegistrarIncapacidad({ empleados, onRegistrada, onCerrar }: Props) {
  const [empleadoId, setEmpleadoId] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [comentarios, setComentarios] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);
  const id = useId();

  // Mientras se guarda no se cierra por ninguna salida (aspa, Cancelar, Escape
  // o clic fuera): cerrar a mitad dejaría al administrador sin saber si la
  // incapacidad —y el correo que la acompaña— salió o no.
  const cerrar = () => {
    if (!guardando) onCerrar();
  };
  const dialogo = useFocoDeModal<HTMLFormElement>(cerrar);

  // Arrastrar desde un campo (seleccionar texto, por ejemplo) y soltar sobre el
  // fondo dispara un `click` en el overlay. Solo cierra si el botón se pulsó
  // también sobre el fondo: lo contrario perdería el PDF y los comentarios.
  const pulsoEnFondo = useRef(false);

  const hoy = hoyEnColombia();

  // Solo fichas activas —el servidor contesta 404 a una inactiva— y por orden
  // alfabético en español, como en FormularioNota: «Álvaro» va con la A y no
  // detrás de la Z, que es donde lo dejaría un `sort()` a secas.
  const opciones = useMemo(
    () => empleados.filter((e) => e.activo).sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es')),
    [empleados],
  );

  const inicioFuturo = fechaInicio !== '' && fechaInicio > hoy;
  const finAntes = fechaInicio !== '' && fechaFin !== '' && fechaFin < fechaInicio;
  const puedeGuardar =
    empleadoId !== '' &&
    fechaInicio !== '' &&
    fechaFin !== '' &&
    !inicioFuturo &&
    !finAntes &&
    archivo !== null &&
    !guardando;

  function limpiarArchivo() {
    setArchivo(null);
    if (inputArchivo.current) inputArchivo.current.value = '';
  }

  // Las mismas dos comprobaciones que el formulario del empleado, con las mismas
  // frases: el `accept` del input no impide elegir otra cosa.
  function elegirArchivo(f: File | null) {
    setError(null);
    if (!f) return void limpiarArchivo();
    if (f.type !== 'application/pdf') {
      setError('El soporte debe ser un archivo PDF.');
      return void limpiarArchivo();
    }
    if (f.size > MAX_PDF_BYTES) {
      setError(`El archivo pesa ${(f.size / 1024 / 1024).toFixed(1)} MB y el máximo son 8 MB.`);
      return void limpiarArchivo();
    }
    setArchivo(f);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!puedeGuardar || !archivo) return;
    setGuardando(true);
    setError(null);
    try {
      onRegistrada(
        await registrarIncapacidadAjena({
          empleadoId,
          fechaInicio,
          fechaFin,
          comentarios: comentarios.trim() || undefined,
          adjunto: { nombreArchivo: archivo.name, mime: archivo.type, contenidoBase64: await leerComoBase64(archivo) },
        }),
      );
    } catch (err) {
      // El formulario se queda abierto y con todo lo rellenado: el mensaje dice
      // qué corregir, y volver a elegirlo todo sería castigarlo por ello.
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onMouseDown={(e) => {
        pulsoEnFondo.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pulsoEnFondo.current && e.target === e.currentTarget) cerrar();
        pulsoEnFondo.current = false;
      }}
      role="presentation"
    >
      <form
        ref={dialogo}
        onSubmit={guardar}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Registrar incapacidad"
        // `-1`: enfocable a mano al abrir, pero fuera del ciclo de tabulación.
        tabIndex={-1}
        className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Registrar incapacidad</h3>
            <p className="text-sm text-gray-500">
              A nombre de la persona que elijas, con los mismos efectos que si la informara ella: el calendario, la
              hoja de nómina y el acuse por correo, con copia a administración.
            </p>
          </div>
          <button
            type="button"
            onClick={cerrar}
            disabled={guardando}
            aria-label="Cerrar"
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mientras se guarda los campos no se tocan: lo que se editara ya no
            viajaría. `contents` para que el fieldset no cambie el aspecto. */}
        <fieldset disabled={guardando} className="contents min-w-0">
        <div className="mb-4">
          <label htmlFor={`${id}-persona`} className={ROTULO}>
            Persona
          </label>
          <select
            id={`${id}-persona`}
            className={CAMPO}
            value={empleadoId}
            aria-required="true"
            onChange={(e) => setEmpleadoId(e.target.value)}
          >
            <option value="">— Elige una persona —</option>
            {opciones.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombreCompleto}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-inicio`} className={ROTULO}>
              Primer día de la incapacidad
            </label>
            {/* `max` y sin `min`: hacia atrás no hay ventana —para eso existe
                esta puerta— y hacia adelante sí, porque nadie sabe que va a
                enfermar. */}
            <input
              id={`${id}-inicio`}
              type="date"
              className={CAMPO}
              value={fechaInicio}
              max={hoy}
              aria-required="true"
              aria-invalid={inicioFuturo || undefined}
              aria-describedby={inicioFuturo ? `${id}-inicio-error` : undefined}
              onChange={(e) => setFechaInicio(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`${id}-fin`} className={ROTULO}>
              Último día de la incapacidad
            </label>
            {/* Sin `max`: el médico firma hoy una baja que cubre los próximos
                días, igual que para el empleado. */}
            <input
              id={`${id}-fin`}
              type="date"
              className={CAMPO}
              value={fechaFin}
              min={fechaInicio || undefined}
              aria-required="true"
              aria-invalid={finAntes || undefined}
              aria-describedby={finAntes ? `${id}-fin-error` : undefined}
              onChange={(e) => setFechaFin(e.target.value)}
            />
          </div>
        </div>
        {inicioFuturo && (
          <p id={`${id}-inicio-error`} className="mb-2 text-sm text-red-600">
            La fecha de inicio no puede ser futura.
          </p>
        )}
        {finAntes && (
          <p id={`${id}-fin-error`} className="mb-2 text-sm text-red-600">
            El último día no puede ser anterior al primero.
          </p>
        )}

        <div className="mb-4 mt-2">
          <label htmlFor={`${id}-pdf`} className={ROTULO}>
            Soporte médico en PDF<span className="text-red-500" aria-hidden="true"> *</span>
          </label>
          <input
            id={`${id}-pdf`}
            ref={inputArchivo}
            type="file"
            accept="application/pdf,.pdf"
            aria-required="true"
            onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-xl file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
          />
          {archivo && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
              <Paperclip className="h-3.5 w-3.5" />
              {archivo.name} ({(archivo.size / 1024).toFixed(0)} KB)
            </p>
          )}
        </div>

        <div className="mb-5">
          <label htmlFor={`${id}-com`} className={ROTULO}>
            Comentarios (opcional)
          </label>
          <textarea
            id={`${id}-com`}
            rows={2}
            maxLength={2000}
            className={CAMPO}
            value={comentarios}
            aria-describedby={`${id}-com-ayuda`}
            onChange={(e) => setComentarios(e.target.value)}
          />
          {/* El texto viaja tal cual en el acuse (empleado y copias) y un correo
              no se puede retirar: conviene que quien escribe lo sepa. */}
          <p id={`${id}-com-ayuda`} className="mt-1 text-xs text-gray-500">
            Se copian tal cual en el correo que le llega a la persona y a quien va en copia.
          </p>
        </div>
        </fieldset>

        {/* `role="alert"` por lo mismo que en EditarSolicitud: el aviso sale
            DESPUÉS de pulsar y sin mover el foco, y el modal sigue abierto. */}
        {error && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cerrar}
            disabled={guardando}
            className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!puedeGuardar}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
