import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Loader2 } from 'lucide-react';
import {
  fetchContexto,
  fetchMiSaldo,
  fetchMisSolicitudes,
  fetchPendientes,
  fetchSaldos,
  retirarModificacion,
  type ClaseModificacion,
  type Contexto,
  type Modificacion,
  type SaldoDeEmpleado,
  type Solicitud,
  type SolicitudPendiente,
} from './api';
import {
  enTramite,
  esTurnoDe,
  hoyEnColombia,
  mensajeDeModificacion,
  puedePedirAnulacion,
  puedePedirModificacion,
  resumenPropuesta,
} from './dominio';
import FormularioSolicitud from './FormularioSolicitud';
import PedirModificacion from './PedirModificacion';
import TablaSolicitudes from './TablaSolicitudes';
import BandejaAprobacion from './BandejaAprobacion';
import HistorialAprobador from './HistorialAprobador';
import PanelAdjuntos from './PanelAdjuntos';
import ImportarEmpleados from './ImportarEmpleados';
import ImportarHistorico from './ImportarHistorico';
import RegistroGeneral from './RegistroGeneral';
import IndicadorSaldo from './IndicadorSaldo';
import PanelSaldos from './PanelSaldos';
import PanelOrganigrama from './PanelOrganigrama';
import Calendario from './Calendario';

const PESTANAS_VALIDAS = [
  'nueva',
  'mias',
  'bandeja',
  'historial',
  'adjuntos',
  'empleados',
  'organigrama',
  'saldos',
  'historico',
  'calendario',
] as const;

type Pestana = (typeof PESTANAS_VALIDAS)[number];

/**
 * La pestaña con la que arranca la app. El widget «Solicitudes por aprobar»
 * del Dashboard enlaza a `/ausencias#bandeja` para aterrizar directo en la
 * bandeja en vez del formulario; si el hash no trae una pestaña reconocida
 * (o no viene ninguno) se arranca en `nueva`, como siempre. Si la pestaña
 * pedida no está disponible para este usuario, el efecto de más abajo ya cae
 * a la primera que sí lo esté.
 */
function pestanaInicial(): Pestana {
  const hash = window.location.hash.slice(1);
  return PESTANAS_VALIDAS.find((p) => p === hash) ?? 'nueva';
}

export default function App() {
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [mias, setMias] = useState<Solicitud[]>([]);
  const [pendientes, setPendientes] = useState<SolicitudPendiente[]>([]);
  const [saldos, setSaldos] = useState<SaldoDeEmpleado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Pestana>(pestanaInicial);
  // Se incrementa al importar para que el registro general se recargue sin
  // desmontarlo (y sin perder los filtros que tuviera puestos).
  const [recargarRegistro, setRecargarRegistro] = useState(0);
  // Lo mismo para el historial del aprobador: acabar de decidir algo tiene que
  // hacer que aparezca ahí, no en la siguiente recarga de la app.
  const [recargarHistorial, setRecargarHistorial] = useState(0);
  // Qué solicitud tiene abierto el modal de «pedir un cambio», y con qué opción
  // marcada de entrada: los dos botones de la fila abren el mismo formulario.
  const [modificando, setModificando] = useState<{ solicitud: Solicitud; clase: ClaseModificacion } | null>(null);
  // Qué propuesta se está retirando ahora mismo, por id, para apagar su enlace.
  const [retirando, setRetirando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    fetchContexto()
      .then(async (ctx) => {
        if (!vivo) return;
        setContexto(ctx);
        setError(null);
        // Las solicitudes propias solo existen si el usuario está dado de alta
        // como empleado; la bandeja, solo si aprueba algo.
        const [propias, aAprobar, saldosVisibles] = await Promise.all([
          ctx.empleado ? fetchMisSolicitudes() : Promise.resolve([]),
          ctx.esAprobador ? fetchPendientes() : Promise.resolve([]),
          // Solo tiene sentido para quien aprueba o administra; para el resto
          // no se pide. El guard `ctx.esAprobador` ya deja fuera el 403: el
          // predicado SQL de empleadosConSaldo es el mismo que el de
          // esAprobadorDeAlguien, así que esAprobador:true garantiza al menos
          // una fila. El catch de aquí solo atrapa fallos reales — red caída,
          // 401, o el 500 que el backend documenta para una fila con fecha
          // corrupta — y se traga porque, si esto revienta, el Promise.all se
          // lleva por delante también `mias` y `pendientes`, que no tienen
          // nada que ver con el saldo.
          ctx.esAprobador ? fetchSaldos().catch(() => []) : Promise.resolve([]),
        ]);
        if (!vivo) return;
        setMias(propias);
        setPendientes(aAprobar);
        setSaldos(saldosVisibles);
      })
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, []);

  const festivos = useMemo(() => new Set(contexto?.festivos ?? []), [contexto]);
  // La misma fecha para todas las filas de un render: si cada botón la leyera
  // por su cuenta, una tabla pintada justo en la medianoche de Bogotá podría
  // decidir con dos «hoy» distintos.
  const hoy = hoyEnColombia();

  const pestanas = useMemo(() => {
    const p: [Pestana, string][] = [];
    // El calendario va aquí y no en el bloque de esAdmin más abajo: la pestaña
    // la abre cualquiera con ficha, pero lo que ENSEÑA va acotado por rol —solo
    // un admin ve a la plantilla entera, el resto su propia fila— y ese recorte
    // lo hace hub-api en el SQL, no esta lista.
    if (contexto?.empleado) p.push(['nueva', 'Nueva solicitud'], ['mias', 'Mis solicitudes'], ['calendario', 'Calendario']);
    if (contexto?.esAprobador) {
      p.push(['bandeja', `Pendientes de aprobar${pendientes.length ? ` (${pendientes.length})` : ''}`]);
      p.push(['historial', 'Historial de aprobaciones']);
    }
    // Va antes del bloque de admin porque no es una pestaña de admin: la abre
    // también quien tenga la llave maestra de adjuntos sin ser administrador,
    // y esa pestaña no puede editar ni borrar nada. Quién la tiene se decide
    // ficha a ficha desde el Organigrama (casilla «Soportes»), no aquí: el
    // servidor ya resuelve la regla en un solo booleano (`esVisorAdjuntos`)
    // para que esta app no tenga que replicarla.
    if (contexto?.esVisorAdjuntos) p.push(['adjuntos', 'Soportes adjuntos']);
    if (contexto?.esAdmin) {
      // El organigrama va aparte de «Empleados» y no debajo: son dos trabajos
      // distintos. Empleados es el alta —se hace una vez—, y el organigrama se
      // revisa cada vez que alguien cambia de jefe. Juntos, el segundo quedaba
      // enterrado bajo el primero.
      p.push(['empleados', 'Empleados'], ['organigrama', 'Organigrama'], ['saldos', 'Saldos']);
      p.push(['historico', 'Registro general']);
    }
    return p;
  }, [contexto, pendientes.length]);

  // Si la pestaña activa no está disponible para este usuario (p. ej. un admin
  // sin ficha de empleado, que no puede crear solicitudes), caemos a la primera.
  useEffect(() => {
    if (pestanas.length && !pestanas.some(([id]) => id === tab)) setTab(pestanas[0][0]);
  }, [pestanas, tab]);

  // Relee solo el saldo, no el contexto entero: es lo que existe
  // `GET /ausencias/mi-saldo` para evitar. No se espera ni se propaga el error —
  // la acción que lo dispara ya se completó, y esto solo mejora la frescura. Si
  // falla, se queda el número anterior, que es mejor que vaciar la cabecera.
  function refrescarSaldoPropio() {
    fetchMiSaldo()
      .then((saldo) => setContexto((actual) => (actual ? { ...actual, saldo } : actual)))
      .catch(() => {});
  }

  function onCreada(s: Solicitud) {
    setMias((ms) => [s, ...ms]);
    // contexto.saldo se cargó una sola vez al arrancar la app: si no se
    // refresca aquí, la cabecera seguiría enseñando el disponible de antes de
    // esta solicitud y no avisaría de una segunda petición sobre los mismos
    // días (el bug que se reportó: pedir 10, luego otros 10, y que siga
    // diciendo que hay 12).
    refrescarSaldoPropio();
  }

  function onDecidida(s: Solicitud) {
    // Firmar no siempre saca la fila de la bandeja: si era la primera de dos, la
    // solicitud sigue pendiente, solo que de otra persona. Un admin —que ve la
    // bandeja entera— la perdería de vista aunque siga estando ahí.
    //
    // «Sigue en mi bandeja» y «es mi turno» NO son lo mismo, y por eso se
    // calculan aparte: un admin conserva la fila aunque haya pasado a otro, pero
    // deja de tocarle, y la bandeja tiene que poder decirlo.
    const esMiTurno = esTurnoDe(s, contexto?.email ?? '');
    const meSigueTocando = contexto?.esAdmin || esMiTurno;

    setPendientes((ps) =>
      enTramite(s.estado) && meSigueTocando
        ? ps.map((p) => (p.id === s.id ? { ...s, esMiTurno } : p))
        : ps.filter((p) => p.id !== s.id),
    );
    setMias((ms) => ms.map((m) => (m.id === s.id ? s : m)));
    // Si con esta firma la solicitud queda cerrada, pasa a estar en el historial.
    if (!enTramite(s.estado)) setRecargarHistorial((n) => n + 1);
    // Misma razón que en onCreada: aprobar o rechazar vacaciones cambia el
    // disponible de esa persona, y otra fila suya en la bandeja seguiría
    // mostrando el número de antes de esta decisión. Se llega aquí solo desde
    // la bandeja (ya implica esAprobador), y si el refresco falla se deja el
    // saldo anterior sin tocar el resultado de la decisión ya tomada.
    fetchSaldos()
      .then((s2) => setSaldos(s2))
      .catch(() => {});
    // Y el propio, no solo los de la bandeja: un admin puede aprobar sus propias
    // vacaciones, y sin esto su indicador de cabecera seguiría enseñando el
    // número de antes de la decisión hasta recargar la página.
    refrescarSaldoPropio();
  }

  /**
   * Cuelga —o descuelga— la propuesta de cambio de su solicitud, en el sitio.
   *
   * Mismo patrón que `onDecidida`: reemplazo in-place por id sobre `mias`, para
   * que la fila enseñe el chip «Cambio pendiente» (o lo pierda al retirarla) sin
   * recargar la app.
   *
   * Aquí NO se refresca el saldo, al revés que en `onCreada` y `onDecidida`: una
   * propuesta pendiente no mueve ni un día. El servidor la ignora a propósito al
   * calcular el saldo —si una anulación pendiente liberara los días, se podrían
   * pedir esos mismos días otra vez y el saldo lo bendeciría—, así que pedirlo
   * aquí solo gastaría una llamada para volver con el mismo número.
   */
  function fijarPropuesta(solicitudId: string, propuesta: Modificacion | null) {
    setMias((ms) => ms.map((m) => (m.id === solicitudId ? { ...m, modificacionPendiente: propuesta } : m)));
  }

  async function retirar(m: Modificacion) {
    setRetirando(m.id);
    try {
      // El id de la solicitud sale de la respuesta y no de la fila que se tenía
      // pintada: es el dato que el servidor acaba de confirmar.
      fijarPropuesta((await retirarModificacion(m.id)).solicitudId, null);
      setError(null);
    } catch (e) {
      // No se toca el estado local: la fila se queda como estaba y se dice por
      // qué. Un 409 aquí es un doble clic, o que el jefe se adelantó a decidir.
      setError(mensajeDeModificacion((e as Error).message));
    } finally {
      setRetirando(null);
    }
  }

  /**
   * La última columna de «Mis solicitudes», que hasta ahora iba vacía.
   *
   * Tres casos y ninguno más: si hay una propuesta viva, lo que se puede hacer
   * es retirarla —no pedir otra encima, que el servidor corta con un 409 y un
   * índice único—; si no la hay y la solicitud lo admite, los dos botones; y si
   * no, nada.
   *
   * `s.modificacionPendiente` se lee por veracidad: un hub-api que todavía no
   * mande el campo cae en «no hay propuesta» y ofrece los botones igual, que es
   * el comportamiento de antes de esta feature. En el peor caso el servidor
   * contesta 409 y el modal lo explica.
   */
  function accionesMias(s: Solicitud): React.ReactNode {
    const propuesta = s.modificacionPendiente;
    if (propuesta) {
      return (
        <div className="flex w-56 flex-col gap-1">
          <p className="text-xs text-gray-600">{resumenPropuesta(propuesta)}</p>
          <button
            type="button"
            disabled={retirando === propuesta.id}
            onClick={() => void retirar(propuesta)}
            className="self-start text-xs text-gray-500 underline hover:text-gray-700 disabled:no-underline"
          >
            {retirando === propuesta.id ? 'Retirando…' : 'Retirar'}
          </button>
        </div>
      );
    }
    if (!puedePedirModificacion(s, hoy)) return null;
    return (
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setModificando({ solicitud: s, clase: 'fechas' })}
          className="rounded-xl border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Cambiar fechas
        </button>
        {/* Sin botón cuando la ausencia ya empezó: anularla devolvería también
            los días ya disfrutados. El porqué —y la salida, que es acortar las
            fechas— se lo cuenta el modal al entrar por «Cambiar fechas». */}
        {puedePedirAnulacion(s, hoy) && (
          <button
            type="button"
            onClick={() => setModificando({ solicitud: s, clase: 'anulacion' })}
            className="rounded-xl border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Anular
          </button>
        )}
      </div>
    );
  }

  return (
    <main className="flex-grow bg-transparent p-6">
      {/* Sticky contra el scroll del documento, NO del `main`: por eso este `main`
          no lleva `overflow-y-auto`. Si lo llevara, `main` nunca desborda (su
          altura es siempre la de su contenido, vía min-h-screen + flex-grow más
          arriba en el árbol) y sería el scrollport más cercano al `<header>` —el
          `sticky` se ancla al scrollport más cercano, exista o no desbordamiento,
          así que quedaría pegado a un contenedor que jamás se mueve y jamás se
          activaría. Sin esa clase, el scrollport es el viewport, que sí se
          desplaza, y la cabecera —con el saldo— sigue a la vista al bajar por una
          tabla larga como «Mis solicitudes». Fondo opaco con blur porque `main` es
          `bg-transparent`: si no, el contenido se transparentaría por debajo al
          pasar. */}
      <header className="sticky top-0 z-20 mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 bg-white/80 py-3 backdrop-blur-xl shadow-sm">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-blue-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Vacaciones y Permisos</h1>
            <p className="max-w-2xl text-sm text-gray-500">
              Solicita vacaciones, compensatorios y permisos, o informa una incapacidad. Los días hábiles descuentan
              fines de semana y festivos de Colombia.
            </p>
          </div>
        </div>
        {/* Sin saldo configurado no se enseña NADA aquí, ni un cartel de aviso:
            sería permanente y en todas las pestañas, y hoy todavía le falta el
            saldo inicial a una decena de personas. Ese aviso ya lo da
            TarjetaSaldo en «Nueva solicitud», que es donde importa. `null` (sin
            ficha, o el cálculo falló) cae en la misma rama: ninguna de las dos
            cosas se arregla poniendo un número en la cabecera. */}
        {contexto?.saldo?.configurado && (
          <div className="rounded-xl border border-gray-200 px-3 py-1.5">
            <IndicadorSaldo saldo={contexto.saldo} variante="cabecera" />
          </div>
        )}
      </header>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {cargando && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Cargando…
        </div>
      )}

      {/* Con el alta automática esto casi no se ve: solo cuando no hay de dónde
          sacar la ficha (una cuenta antigua sin fila en la BD de usuarios) o
          cuando un administrador desactivó la ficha a propósito. Se muestra
          también a los administradores — ocultárselo les dejaba ante una
          pantalla sin formulario y sin ninguna pista de por qué. */}
      {!cargando && contexto && !contexto.empleado && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <p className="mb-1 font-medium">Tu usuario no tiene ficha de empleado.</p>
          <p>
            No hemos podido crearla a partir de tu cuenta (<b>{contexto.email}</b>). Suele pasar cuando la cuenta es
            anterior al sistema de usuarios, o cuando un administrador desactivó la ficha. Pide que te den de alta desde{' '}
            <b>Empleados</b>.
          </p>
        </div>
      )}

      {!cargando && contexto && pestanas.length > 0 && (
        <>
          {/* Las pestañas se mantienen montadas (se ocultan con `hidden`) para no
              perder lo que se lleve escrito en el formulario al ir y volver. */}
          <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
            {pestanas.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={tab === id ? 'page' : undefined}
                className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
                  tab === id
                    ? 'border-blue-500 font-semibold text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {contexto.empleado && (
            <>
              <div className={tab === 'nueva' ? '' : 'hidden'}>
                <FormularioSolicitud
                  festivos={festivos}
                  // El nombre si su jefe tiene ficha; si no, el correo. Quien
                  // manda una solicitud no tiene por qué reconocer un buzón.
                  aprobador={contexto.aprobadorNombre ?? contexto.empleado.aprobadorCorreo}
                  saldo={contexto.saldo}
                  onCreada={onCreada}
                />
              </div>

              <div className={tab === 'mias' ? '' : 'hidden'}>
                {/* Sin tarjeta de saldo: el número vive en la cabecera, visible desde aquí. */}
                <TablaSolicitudes
                  solicitudes={mias}
                  vacio="Todavía no has enviado ninguna solicitud."
                  acciones={accionesMias}
                />
              </div>

              <div className={tab === 'calendario' ? '' : 'hidden'}>
                <Calendario
                  miEmpleadoId={contexto.empleado.id}
                  esAdmin={contexto.esAdmin}
                  activo={tab === 'calendario'}
                />
              </div>
            </>
          )}

          {contexto.esAprobador && (
            <>
              <div className={tab === 'bandeja' ? '' : 'hidden'}>
                <BandejaAprobacion solicitudes={pendientes} saldos={saldos} onDecidida={onDecidida} onError={setError} />
              </div>
              <div className={tab === 'historial' ? '' : 'hidden'}>
                <HistorialAprobador activo={tab === 'historial'} recargarToken={recargarHistorial} />
              </div>
            </>
          )}

          {contexto.esVisorAdjuntos && (
            <div className={tab === 'adjuntos' ? '' : 'hidden'}>
              <PanelAdjuntos activo={tab === 'adjuntos'} />
            </div>
          )}

          {contexto.esAdmin && (
            <>
              <div className={tab === 'empleados' ? '' : 'hidden'}>
                <ImportarEmpleados />
              </div>
              <div className={tab === 'organigrama' ? '' : 'hidden'}>
                <PanelOrganigrama activo={tab === 'organigrama'} />
              </div>
              <div className={tab === 'saldos' ? '' : 'hidden'}>
                <PanelSaldos activo={tab === 'saldos'} onSaldoFijado={refrescarSaldoPropio} />
              </div>
              <div className={tab === 'historico' ? '' : 'hidden'}>
                <ImportarHistorico onImportado={() => setRecargarRegistro((n) => n + 1)} />
                <RegistroGeneral recargarToken={recargarRegistro} festivos={festivos} />
              </div>
            </>
          )}

          {/* Fuera de los `div` de pestaña a propósito: son los que se ocultan
              con `hidden`, y `display:none` lo heredarían también los hijos
              `fixed`. Aquí el modal se pinta pase lo que pase con la pestaña. */}
          {modificando && (
            <PedirModificacion
              solicitud={modificando.solicitud}
              claseInicial={modificando.clase}
              festivos={festivos}
              onPedida={(m) => {
                fijarPropuesta(m.solicitudId, m);
                setModificando(null);
              }}
              onCerrar={() => setModificando(null)}
            />
          )}
        </>
      )}
    </main>
  );
}
