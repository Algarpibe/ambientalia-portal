import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Loader2 } from 'lucide-react';
import {
  fetchContexto,
  fetchMiSaldo,
  fetchMisSolicitudes,
  fetchPendientes,
  fetchSaldos,
  type Contexto,
  type SaldoDeEmpleado,
  type Solicitud,
} from './api';
import { enTramite } from './dominio';
import FormularioSolicitud from './FormularioSolicitud';
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

type Pestana =
  | 'nueva'
  | 'mias'
  | 'bandeja'
  | 'historial'
  | 'adjuntos'
  | 'empleados'
  | 'organigrama'
  | 'saldos'
  | 'historico'
  | 'calendario';

export default function App() {
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [mias, setMias] = useState<Solicitud[]>([]);
  const [pendientes, setPendientes] = useState<Solicitud[]>([]);
  const [saldos, setSaldos] = useState<SaldoDeEmpleado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Pestana>('nueva');
  // Se incrementa al importar para que el registro general se recargue sin
  // desmontarlo (y sin perder los filtros que tuviera puestos).
  const [recargarRegistro, setRecargarRegistro] = useState(0);
  // Lo mismo para el historial del aprobador: acabar de decidir algo tiene que
  // hacer que aparezca ahí, no en la siguiente recarga de la app.
  const [recargarHistorial, setRecargarHistorial] = useState(0);

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
    // también la lista de administración de `VISORES_ADJUNTOS`, que no puede
    // editar ni borrar nada. El servidor decide con un solo booleano.
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
    // bandeja entera— la perdería de vista aunque siga estando ahí. Se replica la
    // misma regla de turno que el WHERE de `solicitudesPendientes`.
    const meSigueTocando =
      contexto?.esAdmin ||
      (s.estado === 'pendiente' && s.aprobadorCorreo?.toLowerCase() === contexto?.email.toLowerCase()) ||
      (s.estado === 'pendiente_2' && s.segundoAprobadorCorreo?.toLowerCase() === contexto?.email.toLowerCase());

    setPendientes((ps) =>
      enTramite(s.estado) && meSigueTocando ? ps.map((p) => (p.id === s.id ? s : p)) : ps.filter((p) => p.id !== s.id),
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
                <TablaSolicitudes solicitudes={mias} vacio="Todavía no has enviado ninguna solicitud." />
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
        </>
      )}
    </main>
  );
}
