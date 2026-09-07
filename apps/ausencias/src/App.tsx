import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Loader2 } from 'lucide-react';
import {
  fetchContexto,
  fetchMisSaldos,
  fetchMisSolicitudes,
  fetchModificacionesPendientes,
  fetchPendientes,
  fetchSaldos,
  retirarModificacion,
  retirarSolicitud,
  type ClaseModificacion,
  type Contexto,
  type DecisionModificacion,
  type Modificacion,
  type SaldoDeEmpleado,
  type Solicitud,
  type SolicitudConPropuesta,
  type SolicitudPendiente,
  type TipoSolicitud,
} from './api';
import {
  contarPorAtender,
  enTramite,
  esOtorgamiento,
  esTurnoDe,
  ETIQUETA_TIPO,
  hoyEnColombia,
  mensajeDeModificacion,
  puedePedirAnulacion,
  puedePedirModificacion,
  puedeRetirarla,
  resumenPropuesta,
  TIPOS,
} from './dominio';
import FormularioSolicitud from './FormularioSolicitud';
import PedirModificacion from './PedirModificacion';
import TablaSolicitudes from './TablaSolicitudes';
import BandejaAprobacion from './BandejaAprobacion';
import PanelAdjuntos from './PanelAdjuntos';
import PanelKpis from './PanelKpis';
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
  'adjuntos',
  'empleados',
  'organigrama',
  'saldos',
  'historico',
  'calendario',
  'kpis',
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
  // Las propuestas de cambio que esperan la decisión de este usuario. Van
  // aparte de `pendientes` y no dentro: son otra decisión, sobre otra tabla, y
  // la bandeja las pinta en su propia sección.
  const [cambios, setCambios] = useState<SolicitudConPropuesta[]>([]);
  const [saldos, setSaldos] = useState<SaldoDeEmpleado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Pestana>(pestanaInicial);
  // El filtro por tipo de «Mis solicitudes». `''` es «todos», igual que en los
  // cuatro del registro general, para no estrenar aquí un convenio distinto.
  //
  // Se tipa `TipoSolicitud | ''` y no `string`: así una comparación contra un
  // tipo mal escrito no compila. Importa porque el filtro se compara contra
  // `s.tipo`, y un literal desviado no vaciaría la tabla con un error, sino en
  // silencio.
  const [filtroMias, setFiltroMias] = useState<TipoSolicitud | ''>('');
  // Se incrementa al importar, y también al decidir algo —aprobar, rechazar o
  // cerrar un cambio—, para que el registro general se recargue sin
  // desmontarlo (y sin perder los filtros que tuviera puestos). Antes esto
  // último lo cubría un token aparte para el historial del aprobador; al
  // fusionarse esa pestaña dentro de esta, el token se fusiona con ella.
  const [recargarRegistro, setRecargarRegistro] = useState(0);
  // Qué solicitud tiene abierto el modal de «pedir un cambio», y con qué opción
  // marcada de entrada: los dos botones de la fila abren el mismo formulario.
  const [modificando, setModificando] = useState<{ solicitud: Solicitud; clase: ClaseModificacion } | null>(null);
  // Qué propuesta se está retirando ahora mismo, por id, para apagar su enlace.
  const [retirando, setRetirando] = useState<string | null>(null);
  // Que solicitud tiene el boton de retirar esperando confirmacion. Aparte de
  // `retirando`, que es de las PROPUESTAS: son dos acciones distintas sobre dos
  // objetos distintos, y compartir la variable haria que confirmar una apagara
  // el boton de la otra.
  const [retirandoSolicitud, setRetirandoSolicitud] = useState<string | null>(null);

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
        const [propias, aAprobar, cambiosPedidos, saldosVisibles] = await Promise.all([
          ctx.empleado ? fetchMisSolicitudes() : Promise.resolve([]),
          ctx.esAprobador ? fetchPendientes() : Promise.resolve([]),
          // El `.catch` NO es cosmético: hub-api y el portal son dos servicios
          // de EasyPanel que se despliegan por separado, así que hay una ventana
          // en que este bundle habla con un hub-api que todavía no tiene la
          // ruta y contesta 404. Sin el catch, ese 404 se lleva por delante el
          // Promise.all entero y con él la app: se perdería también la bandeja,
          // el saldo y «Mis solicitudes». Con él se pierde solo la sección de
          // cambios, que es lo que efectivamente no existe todavía.
          ctx.esAprobador ? fetchModificacionesPendientes().catch(() => []) : Promise.resolve([]),
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
        setCambios(cambiosPedidos);
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

  // Ve el calendario y el registro de toda la compañía. El servidor ya pliega
  // admin dentro de este booleano, así que aquí NO se vuelve a sumar
  // `esAdmin`: hacerlo dejaría la regla escrita en dos sitios, y el día que
  // cambiara en hub-api este seguiría contestando lo de antes.
  //
  // `!!` y no el valor tal cual: hub-api y el portal se despliegan por
  // separado, y en la ventana en que el portal va por delante el campo llega
  // `undefined`. Degrada a «no lo tiene», que es el lado seguro — la pestaña
  // tarda un despliegue en aparecer, en vez de aparecer sin datos detrás.
  const veTodaLaEmpresa = !!contexto?.esVisorDeTodaLaEmpresa;

  // La llave del panel de KPIs. `!!` por lo mismo que la de arriba.
  //
  // No lleva `|| contexto?.esAdmin` porque no le hace falta: hub-api ya pliega
  // el rol dentro de `esVisorDeKpis`, igual que en los otros cuatro booleanos.
  // Añadirlo aquí duplicaría la regla en el navegador, que es justo lo que ese
  // plegado del servidor viene a evitar.
  const veKpis = !!contexto?.esVisorDeKpis;

  // Los tipos que ofrecer en el filtro de «Mis solicitudes»: los que ESTA
  // persona tiene, no los cinco.
  //
  // Derivarlos de los datos —como el registro general hace con las personas y
  // los años, aunque no con su propio filtro de tipo— es lo que evita la opción
  // muerta: quien no ha pedido nunca un compensatorio no debe poder elegir
  // «Compensatorio» y quedarse mirando una tabla vacía preguntándose si se ha
  // roto algo.
  //
  // El orden sale de `TIPOS` y no del orden de llegada de las solicitudes: es
  // el orden canónico de la app —el mismo del formulario— y así el desplegable
  // no se reordena solo cuando alguien pide un tipo nuevo.
  const tiposEnMias = useMemo(
    () => TIPOS.map((t) => t.id).filter((id) => mias.some((s) => s.tipo === id)),
    [mias],
  );

  // Derivado, y no un `setMias` que recorte el estado: filtrar es una decisión
  // de la vista y tiene que poder deshacerse. Recortando el estado, «Todos los
  // tipos» ya no tendría de dónde recuperar lo escondido, y `onCreada` y
  // `onRetirada` —que escriben sobre `mias` por id— acabarían operando sobre una
  // lista a la que le faltan filas.
  const miasFiltradas = useMemo(
    () => (filtroMias ? mias.filter((s) => s.tipo === filtroMias) : mias),
    [mias, filtroMias],
  );

  const pestanas = useMemo(() => {
    const p: [Pestana, string][] = [];
    // El calendario va aquí y no en el bloque de esAdmin más abajo: la pestaña
    // la abre cualquiera con ficha, pero lo que ENSEÑA va acotado por rol —un
    // admin (o quien tenga la vista de toda la empresa) ve a la plantilla
    // entera, el resto su propia fila— y ese recorte lo hace hub-api en el SQL,
    // no esta lista.
    if (contexto?.empleado) p.push(['nueva', 'Nueva solicitud'], ['mias', 'Mis solicitudes'], ['calendario', 'Calendario']);
    if (contexto?.esAprobador) {
      // Las dos cosas que hay que atender —firmar solicitudes y decidir los
      // cambios que piden sobre ellas— viven en esta misma pestaña, así que el
      // número las suma: es lo que un aprobador entiende por «lo que me falta».
      //
      // La cuenta la hace `contarPorAtender`, que es la MISMA que usa el widget
      // del Dashboard (`resumirPendientes` filtra con esas dos funciones). No se
      // cuentan aquí las filas a pelo: lo que la bandeja ENSEÑA es más de lo que
      // a uno le toca DECIDIR —un admin ve también lo de los demás, y quien es
      // su propio jefe ve su propio cambio sin poder decidirlo—, así que
      // `pendientes.length + cambios.length` daría un número que el widget
      // nunca puede alcanzar.
      const { total } = contarPorAtender(pendientes, cambios);
      p.push(['bandeja', `Pendientes de aprobar${total ? ` (${total})` : ''}`]);
    }
    // El registro va FUERA del bloque de la bandeja, y no es cosmética: la
    // vista de toda la empresa la tiene gente que no aprueba a nada ni a nadie
    // —administración, la nómina—, y meterla en aquel `if` le habría dado
    // además una pestaña «Pendientes de aprobar» permanentemente vacía. Son dos
    // permisos distintos que hasta ahora coincidían en la misma persona.
    //
    // Mismo reparto de responsabilidad que el calendario de arriba: la abre
    // cualquier aprobador y no solo un admin, pero lo que ENSEÑA lo recorta
    // hub-api por rama del organigrama —dos niveles hacia abajo— para quien no
    // lo es. Antes hacía falta una pestaña de admin aparte, «Historial de
    // aprobaciones», porque no había otro sitio donde un aprobador viera lo que
    // él mismo ya había cerrado; con ese recorte por rama ya sobra, así que
    // desaparece y esta pantalla hace su trabajo además del suyo.
    if (contexto?.esAprobador || veTodaLaEmpresa) p.push(['historico', 'Registro general']);
    // Va antes del bloque de admin porque no es una pestaña de admin: la abre
    // también quien tenga la llave maestra de adjuntos sin ser administrador,
    // y esa pestaña no puede editar ni borrar nada. Quién la tiene se decide
    // ficha a ficha desde el Organigrama (casilla «Soportes»), no aquí: el
    // servidor ya resuelve la regla en un solo booleano (`esVisorAdjuntos`)
    // para que esta app no tenga que replicarla.
    if (contexto?.esVisorAdjuntos) p.push(['adjuntos', 'Soportes adjuntos']);
    // Va antes del bloque de admin y fuera de él, igual que «Soportes
    // adjuntos» y por lo mismo: la abre también quien tenga la llave sin ser
    // administrador. Meterla dentro del `if (esAdmin)` se la escondería a esa
    // persona, que es justo para quien la llave existe.
    if (veKpis) p.push(['kpis', 'KPIs']);
    if (contexto?.esAdmin) {
      // El organigrama va aparte de «Empleados» y no debajo: son dos trabajos
      // distintos. Empleados es el alta —se hace una vez—, y el organigrama se
      // revisa cada vez que alguien cambia de jefe. Juntos, el segundo quedaba
      // enterrado bajo el primero.
      p.push(['empleados', 'Empleados'], ['organigrama', 'Organigrama'], ['saldos', 'Saldos']);
    }
    return p;
  }, [contexto, veTodaLaEmpresa, veKpis, pendientes.length, cambios.length]);

  // Si la pestaña activa no está disponible para este usuario (p. ej. un admin
  // sin ficha de empleado, que no puede crear solicitudes), caemos a la primera.
  useEffect(() => {
    if (pestanas.length && !pestanas.some(([id]) => id === tab)) setTab(pestanas[0][0]);
  }, [pestanas, tab]);

  // Relee solo los saldos, no el contexto entero: es lo que existe
  // `GET /ausencias/mi-saldo` para evitar. No se espera ni se propaga el error —
  // la acción que lo dispara ya se completó, y esto solo mejora la frescura. Si
  // falla, se quedan los números anteriores, que es mejor que vaciar la cabecera.
  //
  // Las dos bolsas se refrescan juntas porque vienen en la misma respuesta y
  // cualquiera de las dos puede haber cambiado: crear o decidir un compensatorio
  // mueve una, unas vacaciones mueven la otra, y quien dispara esto no siempre
  // sabe de qué tipo era.
  function refrescarSaldosPropios() {
    fetchMisSaldos()
      .then(({ saldo, compensatorios }) =>
        setContexto((actual) => (actual ? { ...actual, saldo, compensatorios } : actual)),
      )
      .catch(() => {});
  }

  function onCreada(s: Solicitud) {
    setMias((ms) => [s, ...ms]);
    // contexto.saldo se cargó una sola vez al arrancar la app: si no se
    // refresca aquí, la cabecera seguiría enseñando el disponible de antes de
    // esta solicitud y no avisaría de una segunda petición sobre los mismos
    // días (el bug que se reportó: pedir 10, luego otros 10, y que siga
    // diciendo que hay 12).
    refrescarSaldosPropios();
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
    // La misma solicitud puede estar además en «Cambios pedidos»: se admite pedir
    // un cambio sobre una que todavía espera firma. Si esa fila se queda con la
    // foto vieja, la sección no se entera de que el estado se movió y no avisa de
    // que aprobar el cambio ya solo puede dar 409 (el testigo de tres campos del
    // servidor mira también el estado). La propuesta se conserva tal cual: `s`
    // trae la suya, pero con el tipo ancho —`Modificacion | null`— y aquí no
    // puede ser nula.
    setCambios((cs) =>
      cs.map((c) => (c.id === s.id ? { ...c, ...s, modificacionPendiente: c.modificacionPendiente } : c)),
    );
    // Si con esta firma la solicitud queda cerrada, pasa a estar en el registro general.
    if (!enTramite(s.estado)) setRecargarRegistro((n) => n + 1);
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
    refrescarSaldosPropios();
  }

  /**
   * El jefe acaba de decidir un cambio. Refresco in-place, como `onDecidida`.
   *
   * La decisión toca DOS filas y el servidor devuelve las dos, así que no hace
   * falta ninguna recarga: la propuesta sale de la sección y la solicitud se
   * repinta con lo que quedó guardado. Esa solicitud viene releída DESPUÉS de
   * aplicarla, así que ya trae las fechas nuevas (o la anulación) y
   * `modificacionPendiente` en `null` — que es lo que quita el chip ámbar
   * «Cambio pendiente» de todas las tablas donde estuviera pintada.
   */
  function onCambioDecidido({ modificacion, solicitud }: DecisionModificacion) {
    // Fuera de la sección, decida lo que decida. Aquí no hay «sigue siendo mi
    // turno» que valga, al revés que en `onDecidida`: la modificación no tiene
    // segunda firma, con una decisión queda cerrada.
    setCambios((cs) => cs.filter((c) => c.modificacionPendiente.id !== modificacion.id));
    // Mismo criterio que `onDecidida` para la bandeja: si la solicitud queda
    // cerrada, se va. Pasa al aprobar una anulación, que la deja `rechazada`.
    // Un cambio de fechas NO mueve el estado —aprobar un cambio no re-decide la
    // solicitud—, así que esa fila se queda donde está, con su turno intacto.
    setPendientes((ps) =>
      enTramite(solicitud.estado)
        ? ps.map((p) => (p.id === solicitud.id ? { ...p, ...solicitud } : p))
        : ps.filter((p) => p.id !== solicitud.id),
    );
    // También en «Mis solicitudes»: un admin puede decidir un cambio suyo.
    setMias((ms) => ms.map((m) => (m.id === solicitud.id ? solicitud : m)));
    // Cerrada = está en el registro general, y con las fechas de ahora. Se
    // llega aquí con `false` solo desde una solicitud todavía en trámite; el
    // caso principal —una `aprobada` a la que le cambian las fechas— entra, y
    // debe entrar: la fila que el registro tiene pintada acaba de envejecer.
    if (!enTramite(solicitud.estado)) setRecargarRegistro((n) => n + 1);
    // Al revés que al PEDIRLO (`fijarPropuesta` no toca el saldo a propósito:
    // una propuesta pendiente no mueve ni un día), aprobar SÍ lo mueve: anular
    // unas vacaciones devuelve todos sus días y acortarlas devuelve parte.
    //
    // La condición va al revés —«salvo que sepamos que fue un rechazo»— para
    // que un valor inesperado caiga en refrescar: eso gasta una llamada de más,
    // mientras que lo contrario deja un saldo viejo en pantalla sin avisar.
    if (modificacion.estado !== 'rechazada') {
      fetchSaldos()
        .then((s2) => setSaldos(s2))
        .catch(() => {});
      // Y el propio, por lo mismo que en `onDecidida`: quien decide puede ser
      // administrador y estar decidiendo sobre sus propios días.
      refrescarSaldosPropios();
    }
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
   * El dueño retira su propia solicitud.
   *
   * La fila NO se quita de la tabla: se sustituye por la que devuelve el
   * servidor, que viene ya en `rechazada` con su `anuladaAt`. Es lo que hace que
   * la persona vea qué pasó en vez de que su solicitud desaparezca sin más — y
   * es además la verdad: la fila sigue existiendo en el registro.
   */
  async function retirarLaSolicitud(s: Solicitud) {
    try {
      const retirada = await retirarSolicitud(s.id);
      setMias((ms) => ms.map((m) => (m.id === retirada.id ? retirada : m)));
      setError(null);
    } catch (e) {
      // Un 409 aquí significa que el jefe firmó mientras tanto y su firma gana.
      // La fila se queda como está y el mensaje lo explica.
      setError(mensajeDeModificacion((e as Error).message));
    } finally {
      setRetirandoSolicitud(null);
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
    // Retirar gana sobre los otros dos y no convive con ellos: mientras nadie
    // haya firmado, «pídele a tu jefe que la anule» sería un rodeo absurdo para
    // algo que el dueño puede deshacer solo. En cuanto hay una firma —o ya está
    // aprobada— este botón desaparece y quedan los de siempre.
    if (puedeRetirarla(s)) {
      const confirmando = retirandoSolicitud === s.id;
      return (
        <div className="flex items-center gap-2">
          {confirmando ? (
            <>
              <span className="text-xs text-gray-600">¿Retirarla?</span>
              <button
                type="button"
                onClick={() => void retirarLaSolicitud(s)}
                className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                Sí, retirar
              </button>
              <button
                type="button"
                onClick={() => setRetirandoSolicitud(null)}
                className="rounded-xl border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                No
              </button>
            </>
          ) : (
            // Dos pasos, como el borrado del registro: es irreversible —la
            // solicitud queda anulada y hay que volver a pedirla— y un clic
            // suelto en una tabla de filas parecidas es fácil de dar por error.
            <button
              type="button"
              onClick={() => setRetirandoSolicitud(s.id)}
              className="rounded-xl border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              title="Quitarla tú, sin que tenga que aprobarlo nadie"
            >
              Retirar
            </button>
          )}
        </div>
      );
    }
    if (!puedePedirModificacion(s, hoy)) return null;
    return (
      <div className="flex gap-2">
        {/* Un otorgamiento no tiene fechas que cambiar: es un día trabajado y una
            cantidad concedida. Aquí el botón SÍ desaparece, al revés que la
            opción dentro del modal —que se queda deshabilitada con su porqué—,
            porque una fila con dos botones de los que uno abre un formulario ya
            resuelto es peor que una fila con un solo botón. */}
        {!esOtorgamiento(s.tipo) && (
          <button
            type="button"
            onClick={() => setModificando({ solicitud: s, clase: 'fechas' })}
            className="rounded-xl border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Cambiar fechas
          </button>
        )}
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
        {/* Sin ninguna bolsa configurada no se enseña NADA aquí, ni un cartel de
            aviso: sería permanente y en todas las pestañas, y hoy todavía le
            falta el saldo inicial a una decena de personas —y la bolsa de
            compensatorios, a la plantilla entera—. Ese aviso ya lo dan las
            tarjetas en «Nueva solicitud», que es donde importa. `null` (sin
            ficha, o el cálculo falló) cae en la misma rama: ninguna de las dos
            cosas se arregla poniendo un número en la cabecera.

            Basta con UNA configurada para pintar el marco; cuántas cifras van
            dentro lo decide IndicadorSaldo, que es donde vive esa regla. */}
        {(contexto?.saldo?.configurado || contexto?.compensatorios?.configurado) && (
          <div className="rounded-xl border border-gray-200 px-3 py-1.5">
            <IndicadorSaldo saldo={contexto.saldo} compensatorios={contexto.compensatorios} variante="cabecera" />
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
                  compensatorios={contexto.compensatorios}
                  esAdmin={contexto.esAdmin}
                  onCreada={onCreada}
                />
              </div>

              <div className={tab === 'mias' ? '' : 'hidden'}>
                {/* Sin tarjeta de saldo: el número vive en la cabecera, visible desde aquí. */}

                {/* Se pinta en cuanto hay UNA solicitud, no a partir de dos
                    tipos.

                    Nació con la condición `tiposEnMias.length > 1` —un
                    desplegable de una sola opción no filtra nada— y se reportó
                    como si fuera un fallo de permisos: «el admin y los jefes no
                    tienen el filtro». No lo era; era esto. Un admin o un jefe
                    usa la app sobre todo para aprobar lo de otros, así que desde
                    su propia cuenta suele haber pedido de un solo tipo, y la
                    condición escondía el filtro justo a quien más se fija en que
                    a los demás sí les sale.

                    Un control que aparece y desaparece según los datos de cada
                    uno no se lee como «aquí no hace falta», se lee como «a mí me
                    falta algo». Con la tabla vacía sí se calla: ahí no hay nada
                    que filtrar y lo dice el mensaje de la propia tabla. */}
                {mias.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <select
                      className="rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none"
                      value={filtroMias}
                      // El `as` es sano por construcción: los únicos valores que
                      // este `select` puede producir son los `value` de sus
                      // `option`, y salen todos de `TipoSolicitud`.
                      onChange={(e) => setFiltroMias(e.target.value as TipoSolicitud | '')}
                      aria-label="Filtrar por tipo"
                    >
                      <option value="">Todos los tipos</option>
                      {tiposEnMias.map((id) => (
                        // `ETIQUETA_TIPO` y NO `TIPOS[].label`: el desplegable
                        // tiene que nombrar los tipos igual que la columna que
                        // filtra. `TIPOS[].label` es lo que se elige HACER en el
                        // formulario —«Legalizar compensatorios», «Solicitar
                        // compensatorio»— y `ETIQUETA_TIPO` es cómo se LLAMA la
                        // cosa; elegir el del formulario haría que el filtro y
                        // la tabla llamaran de dos formas distintas a lo mismo.
                        //
                        // Desde el 2026-08-25 discrepan en dos tipos, no en uno,
                        // y este criterio se aplica ya en los cuatro filtros de
                        // la app y en el selector de tipo de la corrección.
                        <option key={id} value={id}>
                          {ETIQUETA_TIPO[id]}
                        </option>
                      ))}
                    </select>
                    {/* Solo con filtro puesto, y con el total al lado: sin el
                        «de N» la tabla recortada se lee como si fuera todo lo que
                        hay. */}
                    {filtroMias && (
                      <span className="text-sm text-gray-500">
                        {miasFiltradas.length} de {mias.length} solicitudes
                      </span>
                    )}
                  </div>
                )}

                <TablaSolicitudes
                  solicitudes={miasFiltradas}
                  // Con filtro puesto el mensaje de siempre sería mentira: sí ha
                  // enviado solicitudes, solo que ninguna de ese tipo. Hoy no se
                  // llega aquí —las opciones salen de los datos, así que la que
                  // se elija tiene al menos una fila—, pero esa garantía vive en
                  // `tiposEnMias`, arriba, y este componente no la ve.
                  vacio={
                    filtroMias
                      ? `No tienes solicitudes de tipo ${ETIQUETA_TIPO[filtroMias].toLowerCase()}.`
                      : 'Todavía no has enviado ninguna solicitud.'
                  }
                  acciones={accionesMias}
                />
              </div>

              <div className={tab === 'calendario' ? '' : 'hidden'}>
                {/* Sin prop de alcance: la decide entera hub-api en el SQL —la
                    plantilla para un admin o un visor de empresa, la rama de dos
                    niveles para un jefe, la fila propia para el resto— y el
                    calendario se limita a pintar lo que le llega. Aquí hubo una
                    `veTodaLaPlantilla` y antes una `esAdmin`; las dos obligaban
                    a repetir en el navegador una regla que ya vive en el
                    servidor, y con tres escalones ninguna acertaba. */}
                <Calendario miEmpleadoId={contexto.empleado.id} activo={tab === 'calendario'} />
              </div>
            </>
          )}

          {contexto.esAprobador && (
            <div className={tab === 'bandeja' ? '' : 'hidden'}>
              <BandejaAprobacion
                solicitudes={pendientes}
                cambios={cambios}
                saldos={saldos}
                email={contexto.email}
                onDecidida={onDecidida}
                onCambioDecidido={onCambioDecidido}
                onError={setError}
              />
            </div>
          )}

          {/* Separado de la bandeja por lo mismo que su pestaña: quien tiene la
              vista de toda la empresa puede no aprobar a nadie. Anidarlo dentro
              del `esAprobador` de arriba dejaría la pestaña en la lista y su
              contenido sin renderizar — una pestaña que se puede pulsar y no
              enseña nada, que es peor que no tenerla. */}
          {(contexto.esAprobador || veTodaLaEmpresa) && (
            <div className={tab === 'historico' ? '' : 'hidden'}>
              {/* La importación del histórico legado sigue siendo cosa de
                  admin: `/ausencias/historico/import` sigue detrás de
                  `requireAdmin` en hub-api, así que un aprobador que no lo
                  sea nunca podría usarla — dejar el botón visible solo le
                  daría un 403. El registro de abajo sí es de cualquier
                  aprobador: son dos permisos distintos que comparten
                  pestaña. */}
              {contexto.esAdmin && (
                <ImportarHistorico onImportado={() => setRecargarRegistro((n) => n + 1)} />
              )}
              {/* ⚠️ `esAdmin` a secas, y NO `esAdmin || veTodaLaEmpresa`: esta
                  prop no decide cuánto se ve —de eso se encarga el servidor—
                  sino si salen los botones de EDITAR y BORRAR, que siguen
                  siendo solo de admin (`PATCH` y `DELETE` van detrás de
                  `requireAdmin`). Sumarle aquí el permiso nuevo le pintaría a
                  administración unos botones que solo le devolverían un 403, y
                  convertiría un permiso de lectura en uno de escritura a los
                  ojos de quien lo usa. */}
              <RegistroGeneral
                recargarToken={recargarRegistro}
                festivos={festivos}
                esAdmin={contexto.esAdmin}
                puedeExportar={contexto.esExportadorRegistro}
              />
            </div>
          )}

          {contexto.esVisorAdjuntos && (
            <div className={tab === 'adjuntos' ? '' : 'hidden'}>
              <PanelAdjuntos activo={tab === 'adjuntos'} />
            </div>
          )}

          {veKpis && (
            <div className={tab === 'kpis' ? '' : 'hidden'}>
              <PanelKpis activo={tab === 'kpis'} />
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
                <PanelSaldos activo={tab === 'saldos'} onSaldoFijado={refrescarSaldosPropios} />
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
