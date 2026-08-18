import { useState, type ReactNode } from 'react';
import { Check, Loader2, PencilLine, ShieldAlert, X } from 'lucide-react';
import {
  decidirModificacion,
  decidirSolicitud,
  type DecisionModificacion,
  type SaldoDeEmpleado,
  type Solicitud,
  type SolicitudConPropuesta,
  type SolicitudPendiente,
} from './api';
import {
  correoDelTurno,
  mensajeDeModificacion,
  motivoNoDecidible,
  propuestaDesfasada,
  vistaDePropuesta,
} from './dominio';
import TablaSolicitudes from './TablaSolicitudes';
import TarjetaSaldo from './TarjetaSaldo';

/**
 * Los dos códigos que el endpoint de decisión sabe devolver, dichos a quien
 * DECIDE y no a quien pidió.
 *
 * El mapa de `mensajeDeModificacion` está escrito en segunda persona hacia el
 * solicitante —«Tu jefe ya decidió esa petición», «mientras rellenabas esto»— y
 * aquí esa segunda persona es otra: quien lee acaba de pulsar un botón, no está
 * rellenando nada y es él mismo el jefe. Es la misma trampa que `efectoEnDias` y
 * `efectoParaElDecisor` resuelven con dos redacciones en vez de una.
 *
 * Los textos de la Fase 4 no se tocan: son correctos para su audiencia.
 */
const MENSAJE_DECISION: Record<string, string> = {
  ya_decidida: 'Esa petición ya estaba decidida. Recarga la página para ver el resultado.',
  solicitud_cambio_de_estado:
    'La solicitud cambió después de pedirse este cambio, así que no se puede aplicar. Pídele que lo retire.',
};

interface Props {
  solicitudes: SolicitudPendiente[];
  /**
   * Las propuestas de cambio que esperan decisión. Llega vacío si hub-api
   * todavía no las sirve (App.tsx traga ese 404), y entonces la sección de
   * abajo no se pinta: la bandeja queda como antes de esta feature.
   */
  cambios: SolicitudConPropuesta[];
  /** Los saldos de la gente que este usuario aprueba, para decidir con contexto. */
  saldos: SaldoDeEmpleado[];
  /** El correo de la sesión. Solo para EXPLICAR una fila que no se puede decidir. */
  email: string;
  onDecidida: (s: Solicitud) => void;
  onCambioDecidido: (r: DecisionModificacion) => void;
  onError: (mensaje: string) => void;
}

export default function BandejaAprobacion({
  solicitudes,
  cambios,
  saldos,
  email,
  onDecidida,
  onCambioDecidido,
  onError,
}: Props) {
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  // Qué fila ajena ha destapado sus botones. Firmar en lugar de otro exige dos
  // gestos a propósito: es una excepción, no el trabajo de cada día.
  const [destrabando, setDestrabando] = useState<string | null>(null);
  // Estado PROPIO para la sección de cambios, y no las tres variables de arriba.
  // Los ids no chocarían —son UUID de tablas distintas—, pero compartirlos ataría
  // el formulario de motivo de un cambio al del rechazo de una solicitud: abrir
  // uno cerraría el otro, y el texto tecleado en uno aparecería en el otro.
  const [ocupadoCambio, setOcupadoCambio] = useState<string | null>(null);
  const [rechazandoCambio, setRechazandoCambio] = useState<string | null>(null);
  const [motivoCambio, setMotivoCambio] = useState('');

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
   * Decide una PROPUESTA, no la solicitud. Mismo cuerpo y mismo patrón que
   * `decidir` —el servidor lo hizo idéntico a propósito—, con dos diferencias:
   * el estado que toca es el suyo, y el error se traduce.
   */
  async function decidirCambio(id: string, aprueba: boolean, texto?: string) {
    setOcupadoCambio(id);
    try {
      onCambioDecidido(await decidirModificacion(id, aprueba, texto));
      setRechazandoCambio(null);
      setMotivoCambio('');
    } catch (e) {
      // Traducido, al revés que en `decidir`: los 409 de aquí llegan como código
      // crudo (`ya_decidida`, `solicitud_cambio_de_estado`) y esta línea es lo
      // único que va a leer quien pulsó. Primero la redacción para el decisor y,
      // si el código no es de los suyos —un 400 de forma, o uno que este bundle
      // todavía no conoce—, la general, que como mucho será impersonal.
      const codigo = (e as Error).message;
      onError(MENSAJE_DECISION[codigo] ?? mensajeDeModificacion(codigo));
    } finally {
      setOcupadoCambio(null);
    }
  }

  /**
   * La celda de una propuesta: el antes, el después, el delta y los dos botones.
   *
   * Va en su propia sección y no mezclada con la tabla de arriba porque son dos
   * decisiones distintas: los botones de allí deciden LA SOLICITUD y estos EL
   * CAMBIO. Dos parejas de botones en la misma fila es cómo alguien aprueba lo
   * que no era.
   */
  function accionesCambio(s: SolicitudConPropuesta): ReactNode {
    const m = s.modificacionPendiente;
    const vista = vistaDePropuesta(s, m);
    // `!== false` y no `=== true`: un hub-api sin el campo degrada a «ofrécele
    // los botones» (y, como mucho, un 403 explicado) y no a una fila muerta.
    const puedo = s.puedoDecidirla !== false;
    const saldoSolicitante =
      s.tipo === 'vacaciones' ? saldos.find((sd) => sd.empleadoId === s.empleadoId) : undefined;
    const ocupado = ocupadoCambio === m.id;
    // El id del párrafo que explica el bloqueo, para poder apuntarle desde los
    // botones. Lleva el id de la propuesta porque hay una celda de estas por
    // fila y un id repetido no describiría a nadie.
    const idMotivo = `cambio-bloqueado-${m.id}`;
    /**
     * El par de botones, en una sola definición: la fila bloqueada los enseña
     * apagados y no ausentes —unos botones que desaparecen se leen como un fallo
     * de la app—, así que la única diferencia entre los dos casos es `bloqueado`.
     *
     * `aria-disabled` y NO `disabled`: `disabled` saca el botón del orden de
     * tabulación, de modo que quien navega con teclado nunca aterriza en él y
     * nunca llega a oír el porqué que tiene al lado — vería una fila con dos
     * botones que no existen para él. Con `aria-disabled` sigue siendo
     * enfocable, se anuncia como no disponible y `aria-describedby` le lee la
     * explicación. Lo que `aria-disabled` NO hace por sí solo es impedir el
     * clic: de eso se encarga el guard de cada `onClick`.
     */
    const botones = (bloqueado: boolean) => {
      const inactivo = bloqueado || ocupado;
      // Gris 200/600 y no el `disabled:bg-gray-300` con texto blanco del resto
      // de la app (1,6:1). WCAG exime a los deshabilitados, pero ahí ese estado
      // dura lo que tarda una petición y aquí es PERMANENTE: se lee o no se lee.
      const apagado = 'bg-gray-200 text-gray-600';
      return (
        <div className="flex gap-2">
          <button
            type="button"
            aria-disabled={inactivo}
            aria-describedby={bloqueado ? idMotivo : undefined}
            onClick={() => { if (inactivo) return; void decidirCambio(m.id, true); }}
            // El texto visible («Aprobar») va entero y al principio del
            // aria-label, que es lo que pide WCAG 2.5.3; lo que se añade es de
            // quién, porque en esta tabla hay un «Aprobar» por fila.
            aria-label={`Aprobar el cambio que pide ${s.empleadoNombre}`}
            className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-medium ${
              inactivo ? apagado : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Aprobar
          </button>
          <button
            type="button"
            aria-disabled={inactivo}
            aria-describedby={bloqueado ? idMotivo : undefined}
            onClick={() => { if (inactivo) return; setRechazandoCambio(m.id); setMotivoCambio(''); }}
            aria-label={`Rechazar el cambio que pide ${s.empleadoNombre}`}
            className={`flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-medium ${
              inactivo ? `border-gray-200 ${apagado}` : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <X className="h-3.5 w-3.5" />
            Rechazar
          </button>
        </div>
      );
    };
    return (
      // w-72, el mismo que la celda de arriba y por el mismo motivo: es lo que
      // necesita TarjetaSaldo para no partir el titular en tres líneas.
      <div className="flex w-72 flex-col gap-2">
        <div className="rounded-xl bg-gray-50 px-3 py-2 text-xs">
          {/* Que se lea de un vistazo si lo que se pide es anular: aprobar una
              anulación deja la solicitud sin efecto, que no es «mover unas
              fechas». */}
          <p className="font-semibold text-gray-900">
            {vista.anula ? 'Pide anular la solicitud' : 'Pide cambiar las fechas'}
          </p>
          {/* Cada línea se arma entera en una plantilla en vez de pegar trozos
              con etiquetas JSX: un salto de línea entre dos nodos de texto se
              come el espacio y aquí saldría «Ahora:6 jul 2026». */}
          <p className="mt-1 text-gray-600">{`Ahora: ${vista.ahora}`}</p>
          <p className="text-gray-600">{`Quedaría: ${vista.quedaria}`}</p>
          <p className="mt-1 font-medium text-gray-900">{vista.efecto}</p>
        </div>
        {/* El motivo que escribió quien lo pide. Es la mitad de lo que hay que
            leer para decidir, y no está en ninguna otra columna: la de
            Comentarios lleva los de la solicitud original. */}
        {m.motivo && <p className="text-xs text-gray-600">{`Motivo: ${m.motivo}`}</p>}
        {propuestaDesfasada(s, m) && (
          // Sin «y que lo vuelva a mandar»: si lo que cambió fue el estado —la
          // solicitud se cerró, o se anuló— volver a pedirlo es imposible, y
          // `estadoAdmiteModificacion` lo rechazaría. Retirarlo sí se puede
          // siempre, y es lo único que hay que decirle.
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            La solicitud cambió después de pedirse esto, así que el «ahora» de arriba ya no es el de la fila.
            Aprobarlo va a fallar: pídele que lo retire.
          </p>
        )}
        {saldoSolicitante && (
          <TarjetaSaldo
            saldo={saldoSolicitante.saldo}
            diasPedidos={vista.diasDeMas}
            titulo={`Saldo de ${s.empleadoNombre}`}
          />
        )}
        {/* Apagados CON el porqué debajo, nunca ausentes: unos botones que
            desaparecen sin explicación se leen como un fallo de la app. Es el
            caso de quien es su propio jefe —la raíz del organigrama— viendo su
            propia petición, y el del admin que las ve todas. */}
        {!puedo ? (
          <div className="flex flex-col gap-1">
            {botones(true)}
            {/* El `id` lo apuntan los dos botones con `aria-describedby`: quien
                navega con teclado se planta en un botón que se anuncia «no
                disponible» y necesita oír por qué sin tener que ir a buscarlo. */}
            <p id={idMotivo} className="text-xs text-gray-500">
              {motivoNoDecidible(s, m, email)}
            </p>
          </div>
        ) : rechazandoCambio === m.id ? (
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              value={motivoCambio}
              onChange={(e) => setMotivoCambio(e.target.value)}
              placeholder="Motivo del rechazo"
              // Contiene literalmente el texto visible (el placeholder) y añade
              // de quién es: en una tabla con varias filas, cuatro campos que se
              // anuncian igual no se distinguen (WCAG 2.5.3).
              aria-label={`Motivo del rechazo del cambio de ${s.empleadoNombre}`}
              maxLength={1000}
              className="rounded-xl border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void decidirCambio(m.id, false, motivoCambio)}
                className="flex-1 rounded-xl bg-red-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:bg-gray-300"
              >
                {ocupado ? 'Rechazando…' : 'Confirmar'}
              </button>
              <button
                type="button"
                onClick={() => { setRechazandoCambio(null); setMotivoCambio(''); }}
                className="rounded-xl border border-gray-300 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          botones(false)
        )}
      </div>
    );
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
  //
  // Se compara contra `false` y no por veracidad, y eso NO es cosmético: hub-api
  // y el portal son dos servicios de EasyPanel que se despliegan por separado,
  // así que hay una ventana de minutos en la que este bundle habla con un
  // hub-api que todavía no manda el campo. Con `filter(s => s.esMiTurno)`, ese
  // `undefined` mandaría TODAS las solicitudes al cajón del rescate y el
  // aprobador se encontraría «Esperando la firma de sí mismo» y sin botones.
  // Comparando contra `false`, un campo ausente degrada al comportamiento de
  // antes de esta pantalla: todo en la lista de siempre, con sus botones.
  const mias = solicitudes.filter((s) => s.esMiTurno !== false);
  const ajenas = solicitudes.filter((s) => s.esMiTurno === false);

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

      {/* La tercera sección: lo que se pide CAMBIAR de una solicitud ya enviada.
          Separada de la tabla de arriba a propósito —ver `accionesCambio`—, y
          debajo de todo porque es lo excepcional: casi todos los días esta
          sección no existe. */}
      {cambios.length > 0 && (
        <div>
          {/* El recuento va también aquí, aunque la pestaña ya sume los cambios:
              sin él, «Pendientes de aprobar (5)» sobre una tabla de tres filas
              parece un número mal contado.
              ⚠️ Este cuenta FILAS DE TABLA y el de la pestaña cuenta DECISIONES
              (`contarPorAtender`, que descarta las que uno no puede decidir), así
              que pueden no coincidir a propósito: quien es su propio jefe ve aquí
              «(1)» y en la pestaña ningún número, porque esa fila no la decide
              él. No unificarlos: responden a preguntas distintas. */}
          <h3 className="mb-1 text-sm font-semibold text-gray-900">{`Cambios pedidos (${cambios.length})`}</h3>
          <p className="mb-4 flex max-w-3xl items-start gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <PencilLine className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              Estas solicitudes ya te las mandaron y ahora piden <b>cambiarlas</b>. Aprobar un cambio de
              fechas las <b>reescribe</b> sin volver a decidirlas: una que estuviera aprobada sigue
              aprobada. Aprobar una anulación la deja <b>sin efecto</b> y le devuelve los días.
            </span>
          </p>
          <TablaSolicitudes
            solicitudes={cambios}
            mostrarSolicitante
            vacio=""
            // Se busca la fila en `cambios` en vez de castear la que llega: es la
            // misma fila, pero así el tipo lo garantiza el compilador y no un
            // `as` que dejaría de ser cierto si algún día esta tabla se compartiera.
            acciones={(s) => {
              const c = cambios.find((x) => x.id === s.id);
              return c ? accionesCambio(c) : null;
            }}
          />
        </div>
      )}
    </div>
  );
}
