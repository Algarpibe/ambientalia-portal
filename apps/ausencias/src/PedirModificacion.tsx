import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Send, X } from 'lucide-react';
import { pedirModificacion, type ClaseModificacion, type Modificacion, type Solicitud } from './api';
import {
  decisorDeModificacion,
  esDeUnSoloDia,
  ETIQUETA_TIPO,
  excedeRangoMaximo,
  esOtorgamiento,
  hoyEnColombia,
  mensajeDeModificacion,
  minimoInicioPropuesto,
  puedePedirAnulacion,
  rangoFechas,
  resumenCambio,
  retrocedeAlPasado,
  sinCambiosDeFechas,
} from './dominio';
import { useFocoDeModal } from './focoDeModal';

// El trabajador pide que le cambien las fechas de una solicitud ya enviada, o
// que se la anulen. NO cambia nada por su cuenta: guarda una propuesta que su
// jefe aprueba o rechaza, y hasta entonces la solicitud sigue exactamente igual.
//
// Molde: EditarSolicitud.tsx (overlay con cierre al clic fuera, role="dialog",
// banner de error, contador de días, pie de botones), recortado a lo que un
// trabajador puede pedir: ni el tipo ni la persona, que siguen siendo del admin.

interface Props {
  solicitud: Solicitud;
  /** Qué opción viene marcada: la fila tiene un botón para cada una. */
  claseInicial: ClaseModificacion;
  festivos: Set<string>;
  onPedida: (m: Modificacion) => void;
  onCerrar: () => void;
}

const CAMPO =
  'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none';

/**
 * La frase que no puede faltar, y por eso es una constante y no un literal
 * suelto en el JSX.
 *
 * Es el malentendido más probable de toda la feature: quien rellena esto está
 * mirando un formulario con sus fechas nuevas y sale creyendo que ya están
 * cambiadas. Si alguna vez hay que recortar este modal, esta frase es lo último
 * que se quita.
 */
const ES_UNA_PETICION = 'Esto es una petición. Las fechas no cambian hasta que tu jefe la apruebe.';

export default function PedirModificacion({ solicitud, claseInicial, festivos, onPedida, onCerrar }: Props) {
  // Un solo `hoy` para todas las reglas de fecha del modal: leerlo dos veces
  // dejaría la rendija de que una caiga a un lado de la medianoche de Bogotá y
  // otra al otro, igual que en el servidor.
  const hoy = hoyEnColombia();
  const anulable = puedePedirAnulacion(solicitud, hoy);
  const decisor = decisorDeModificacion(solicitud);

  // Se cae a «fechas» si llega marcada la anulación sobre algo que no la admite.
  // Hoy no puede pasar —quien abre el modal ya comprueba lo mismo—, pero un
  // formulario que arranca en una opción deshabilitada no tendría salida.
  // Un otorgamiento no tiene rango que mover: es un día trabajado y una cantidad
  // concedida. Solo se puede anular, y el servidor lo rechaza con
  // `otorgamiento_solo_anulable` si llega otra cosa.
  const soloAnulable = esOtorgamiento(solicitud.tipo);
  const [clase, setClase] = useState<ClaseModificacion>(
    soloAnulable ? 'anulacion' : anulable ? claseInicial : 'fechas',
  );
  // Se arranca con las fechas que la solicitud tiene AHORA, no en blanco: casi
  // siempre se mueve un extremo, y así el antes/después se puede leer desde el
  // primer momento.
  const [fechaInicio, setFechaInicio] = useState(solicitud.fechaInicio);
  const [fechaFin, setFechaFin] = useState(solicitud.fechaFin);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La misma trampa de foco que EditarSolicitud, del que este modal es copia:
  // el mismo hook y no una copia del codigo, porque dos trampas de foco se
  // separan con los meses y la que se quede vieja no lo dice.
  const dialogo = useFocoDeModal<HTMLFormElement>(onCerrar);

  const anula = clase === 'anulacion';

  /**
   * Un permiso es de UN día, así que aquí tampoco tiene segunda casilla: se
   * puede MOVER a otro día, no alargar. Es la misma regla que impone el
   * formulario de alta, y esta es la otra puerta — sin ella se pedía de un día y
   * se estiraba a cinco por aquí, con la firma del jefe pero contra la regla.
   *
   * Derivada y no un `setFechaFin` en el `onChange`, igual que en el alta: así
   * no hay estado que se desincronice, y el `fechaFin` con el que arrancó el
   * modal se queda quieto sin viajar.
   *
   * El servidor lo repite con `permiso_de_un_solo_dia`, que es el cerrojo que de
   * verdad manda: esta pantalla se puede saltar, aquella no.
   */
  const unSoloDia = esDeUnSoloDia(solicitud.tipo);
  const fechaFinEfectiva = unSoloDia ? fechaInicio : fechaFin;

  /**
   * Un permiso ANTERIOR a la regla de «un solo día», que todavía ocupa un rango.
   *
   * ⚠️ Es el único caso del modal que abre **ya armado**: con una sola casilla,
   * la propuesta efectiva es el primer día suelto, así que `sinCambios` sale
   * `false` sin que nadie haya tocado nada y el botón nace encendido. Un clic
   * distraído encoge un permiso de cinco días a uno, y los otros cuatro se
   * pierden.
   *
   * El resto del modal cumple la invariante contraria —abrir sin tocar deja el
   * botón apagado, porque «pedir exactamente lo que ya tiene no es un cambio»—,
   * y aquí no se puede cumplir: sin segunda casilla no hay forma de proponer
   * «déjalo como está». Así que en vez de apagar el botón se AVISA, con el
   * número de días que se van y la alternativa al lado.
   */
  const permisoViejoDeVariosDias = unSoloDia && solicitud.fechaInicio !== solicitud.fechaFin;

  const faltaFecha = !fechaInicio || !fechaFinEfectiva;
  const rangoInvertido = Boolean(fechaInicio && fechaFinEfectiva && fechaInicio > fechaFinEfectiva);
  const rangoLargo = excedeRangoMaximo(fechaInicio, fechaFinEfectiva);
  const sinCambios = sinCambiosDeFechas(solicitud, fechaInicio, fechaFinEfectiva);
  // Las dos salen de `dominio.ts` y no de aquí: son el espejo de la regla
  // `fecha_en_pasado` del servidor, y una regla enterrada en el JSX es la única
  // de las seis que no se podría cubrir el día que esta app tenga runner.
  const minInicio = minimoInicioPropuesto(solicitud, hoy);
  const haciaAtras = retrocedeAlPasado(solicitud, fechaInicio, hoy);

  const resumen = useMemo(
    () => resumenCambio(solicitud, { clase, fechaInicio, fechaFin: fechaFinEfectiva }, festivos),
    [solicitud, clase, fechaInicio, fechaFinEfectiva, festivos],
  );
  // Con una fecha a medio teclear —o con un rango imposible— el conteo da 0 y el
  // resumen diría que se devuelven todos los días. Mejor no enseñar nada que
  // enseñar eso. Y sin cambios tampoco hay nada que resumir: eso ya lo dice el
  // aviso de debajo de las fechas.
  const resumenVisible = anula || (!faltaFecha && !rangoInvertido && !rangoLargo && !sinCambios);
  const puedeEnviar =
    !enviando && (anula || (!faltaFecha && !rangoInvertido && !rangoLargo && !sinCambios && !haciaAtras));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeEnviar) return;
    setEnviando(true);
    setError(null);
    try {
      onPedida(
        await pedirModificacion(solicitud.id, {
          clase,
          // En una anulación las fechas se OMITEN, no se mandan vacías: el
          // servidor contesta 400 (`anulacion_con_fechas`) si llegan con valor,
          // a propósito, para que un cliente con un bug no crea haber pedido un
          // cambio de fechas habiendo pedido que le anulen las vacaciones.
          // La EFECTIVA: en un permiso no hay segunda casilla, así que mandar el
          // `fechaFin` crudo enviaría el rango con el que se abrió el modal y el
          // servidor lo rechazaría con `permiso_de_un_solo_dia`.
          ...(anula ? {} : { fechaInicio, fechaFin: fechaFinEfectiva }),
          motivo: motivo.trim() || undefined,
        }),
      );
    } catch (err) {
      // El código del servidor se traduce aquí: `mensajeDeError` devuelve para
      // los 400/409 el campo `error` crudo, y `anulacion_ya_empezada` no le dice
      // nada a nadie. La excepción es `rango_solapado`, que llega ya redactado
      // desde `api.ts` —necesita el `detalle`, que este mapa no recibe—; lo pinta
      // igual porque `mensajeDeModificacion` deja pasar lo que no reconoce.
      setError(mensajeDeModificacion((err as Error).message));
    } finally {
      setEnviando(false);
    }
  }

  const opcion = (activa: boolean, deshabilitada: boolean) =>
    `flex flex-col gap-1 rounded-xl border p-3 transition-colors ${
      deshabilitada
        ? 'cursor-not-allowed border-gray-200 bg-gray-50'
        : `cursor-pointer ${activa ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={onCerrar}
      role="presentation"
    >
      <form
        ref={dialogo}
        onSubmit={enviar}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Pedir un cambio en la solicitud"
        // Igual que en el molde: enfocable al abrir, pero sin parada de Tab.
        tabIndex={-1}
        className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Pedir un cambio</h3>
            {/* Toda la línea en una plantilla: pegar los trozos con etiquetas
                JSX separadas por saltos de línea se come los espacios. */}
            <p className="text-sm text-gray-500">
              {`${ETIQUETA_TIPO[solicitud.tipo]} · ${rangoFechas(
                solicitud.fechaInicio,
                solicitud.fechaFin,
                solicitud.horaInicio,
                solicitud.horaFin,
              )}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-medium text-gray-700">Qué quieres pedir</legend>
          <div className="flex flex-col gap-2">
            {/* Deshabilitada y con el porqué al lado, no ausente: es el mismo
                criterio que la opción de anular más abajo. Quien abre este modal
                sobre un compensatorio concedido tiene que entender que la única
                salida es anularlo y volver a pedirlo, no quedarse mirando una
                lista de una sola opción sin saber si falta algo. */}
            <label className={opcion(!anula, soloAnulable)}>
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <input
                  type="radio"
                  name="clase"
                  value="fechas"
                  checked={!anula}
                  disabled={soloAnulable}
                  onChange={() => setClase('fechas')}
                  className="accent-blue-600"
                />
                {unSoloDia && !soloAnulable ? 'Cambiar la fecha' : 'Cambiar las fechas'}
              </span>
              <span className="pl-6 text-xs text-gray-500">
                {soloAnulable
                  ? 'Un compensatorio concedido no tiene fechas que mover: si te equivocaste, anúlalo y pídelo otra vez.'
                  : unSoloDia
                    ? 'Un permiso es de un solo día: puedes moverlo a otro, no alargarlo.'
                    : 'Propón otras fechas. Sirve también para acortar una ausencia que ya empezó.'}
              </span>
            </label>

            {/* Deshabilitada CON el porqué al lado, nunca ausente: una opción que
                desaparece sin explicación se lee como un fallo de la app, y quien
                venía a cancelar sus vacaciones se queda sin saber que lo que
                puede hacer es acortarlas. */}
            <label className={opcion(anula, !anulable)}>
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <input
                  type="radio"
                  name="clase"
                  value="anulacion"
                  checked={anula}
                  disabled={!anulable}
                  onChange={() => setClase('anulacion')}
                  className="accent-blue-600"
                />
                Anular la solicitud
              </span>
              <span className="pl-6 text-xs text-gray-500">
                {soloAnulable
                  ? 'Los días concedidos saldrían de tu bolsa de compensatorios. Si ya los gastaste, la bolsa quedará en negativo.'
                  : anulable
                    ? 'Esos días dejarían de estar reservados.'
                    : 'Esta ausencia ya empezó: no se puede anular, pero puedes acortar las fechas.'}
              </span>
            </label>
          </div>
        </fieldset>

        {/* Los dos inputs desaparecen al anular en vez de quedarse en gris: no
            hay ninguna fecha que elegir, y el cuerpo que se manda tampoco las
            lleva. */}
        {!anula && (
          <>
            {/* Va ARRIBA de los campos y del botón, no dentro del panel del
                resumen: el resumen ya lo cuenta bien («Son 4 días menos»), pero
                es un panel que hay que leer mientras el botón ya está encendido.
                Ver el porqué entero en `permisoViejoDeVariosDias`. */}
            {permisoViejoDeVariosDias && (
              <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Este permiso ocupa {rangoFechas(solicitud.fechaInicio, solicitud.fechaFin)}, pero los permisos ahora son
                de un solo día. <b>Si pides el cambio, se quedará solo en el día que elijas</b> y el resto se pierde. Si
                lo que quieres es quitarlo entero, pide la anulación.
              </p>
            )}
            <div className="mb-2 grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="pm-desde" className="mb-1 block text-sm font-medium text-gray-700">
                  {unSoloDia ? 'Nueva fecha' : 'Nuevo primer día'}
                </label>
                <input
                  id="pm-desde"
                  type="date"
                  className={CAMPO}
                  value={fechaInicio}
                  min={minInicio}
                  onChange={(e) => setFechaInicio(e.target.value)}
                />
              </div>
              {/* En un permiso no se pinta: es de un solo día y se puede mover,
                  no alargar. Se saca del DOM y no se esconde con CSS — aquí el
                  input no lleva `required`, así que no habría callejón de
                  validación nativa, pero un campo invisible que sigue mandando
                  su valor es peor todavía: enviaría el rango con el que se abrió
                  el modal sin que nadie lo viera. */}
              {!unSoloDia && (
                <div>
                  <label htmlFor="pm-hasta" className="mb-1 block text-sm font-medium text-gray-700">
                    Nuevo último día
                  </label>
                  <input
                    id="pm-hasta"
                    type="date"
                    className={CAMPO}
                    value={fechaFin}
                    min={fechaInicio || minInicio}
                    onChange={(e) => setFechaFin(e.target.value)}
                  />
                </div>
              )}
            </div>
            {rangoInvertido && (
              <p className="mb-2 text-sm text-red-600">La fecha final no puede ser anterior a la inicial.</p>
            )}
            {rangoLargo && (
              <p className="mb-2 text-sm text-red-600">El rango no puede pasar de un año. Revisa las fechas.</p>
            )}
            {/* El `min` del input es solo la barrera cómoda: se puede teclear por
                encima. Se comprueba aquí y, sobre todo, en el servidor. */}
            {haciaAtras && (
              <p className="mb-2 text-sm text-red-600">
                No puedes mover la ausencia hacia atrás: reservaría días que ya pasaron y movería saldo de un año a
                otro. Puedes acortarla o retrasarla, no adelantarla al pasado.
              </p>
            )}
            {!rangoInvertido && !rangoLargo && !haciaAtras && sinCambios && (
              <p className="mb-2 text-sm text-gray-500">
                Esas son las fechas que la solicitud ya tiene. Cambia alguna para poder pedirlo.
              </p>
            )}
          </>
        )}

        {/* El antes/después, explícito. Sin él, quien acorta unas vacaciones no
            ve cuántos días recupera y quien las alarga no ve que está pidiendo
            más de los que tiene. */}
        {resumenVisible && (
          <div className="mb-4 rounded-xl bg-gray-50 px-3 py-2 text-sm">
            <p className="text-gray-700">{`Ahora: ${resumen.ahora}`}</p>
            <p className="text-gray-700">
              {resumen.quedaria
                ? `Quedaría: ${resumen.quedaria}`
                : soloAnulable
                  ? 'Quedaría: esos días salen de tu bolsa de compensatorios.'
                  : 'Quedaría: nada reservado, la ausencia desaparece del calendario.'}
            </p>
            <p className="mt-1 font-medium text-gray-900">{resumen.efecto}</p>
          </div>
        )}

        <div className="mb-4">
          <label htmlFor="pm-motivo" className="mb-1 block text-sm font-medium text-gray-700">
            Motivo <span className="font-normal text-gray-500">(opcional)</span>
          </label>
          <textarea
            id="pm-motivo"
            rows={3}
            className={CAMPO}
            value={motivo}
            maxLength={2000}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500">
            {anula
              ? 'Es lo que leerá tu jefe para decidir, y lo que quedará escrito en el registro de la solicitud.'
              : 'Es lo que leerá tu jefe para decidir.'}
          </p>
        </div>

        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{ES_UNA_PETICION}</p>
          {anula && <p className="mt-1">Hasta entonces la solicitud sigue en pie y esos días siguen reservados.</p>}
          {decisor && <p className="mt-1">{`La decidirá ${decisor}.`}</p>}
        </div>

        {/* `role="alert"` porque este banner aparece DESPUÉS de pulsar y sin
            mover el foco: sin él, quien use lector de pantalla se queda esperando
            una confirmación que no llega y sin saber que hay un error. Es el
            único sitio del modal donde el contenido cambia solo. */}
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!puedeEnviar}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {anula ? 'Pedir la anulación' : 'Pedir el cambio'}
          </button>
        </div>
      </form>
    </div>
  );
}
