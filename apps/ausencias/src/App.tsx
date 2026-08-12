import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Loader2 } from 'lucide-react';
import {
  fetchContexto,
  fetchMisSolicitudes,
  fetchPendientes,
  type Contexto,
  type Solicitud,
} from './api';
import FormularioSolicitud from './FormularioSolicitud';
import TablaSolicitudes from './TablaSolicitudes';
import BandejaAprobacion from './BandejaAprobacion';
import ImportarEmpleados from './ImportarEmpleados';
import ImportarHistorico from './ImportarHistorico';
import RegistroGeneral from './RegistroGeneral';

type Pestana = 'nueva' | 'mias' | 'bandeja' | 'empleados' | 'historico';

export default function App() {
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [mias, setMias] = useState<Solicitud[]>([]);
  const [pendientes, setPendientes] = useState<Solicitud[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Pestana>('nueva');
  // Se incrementa al importar para que el registro general se recargue sin
  // desmontarlo (y sin perder los filtros que tuviera puestos).
  const [recargarRegistro, setRecargarRegistro] = useState(0);

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
        const [propias, aAprobar] = await Promise.all([
          ctx.empleado ? fetchMisSolicitudes() : Promise.resolve([]),
          ctx.esAprobador ? fetchPendientes() : Promise.resolve([]),
        ]);
        if (!vivo) return;
        setMias(propias);
        setPendientes(aAprobar);
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
    if (contexto?.empleado) p.push(['nueva', 'Nueva solicitud'], ['mias', 'Mis solicitudes']);
    if (contexto?.esAprobador) p.push(['bandeja', `Pendientes de aprobar${pendientes.length ? ` (${pendientes.length})` : ''}`]);
    if (contexto?.esAdmin) p.push(['empleados', 'Empleados'], ['historico', 'Registro general']);
    return p;
  }, [contexto, pendientes.length]);

  // Si la pestaña activa no está disponible para este usuario (p. ej. un admin
  // sin ficha de empleado, que no puede crear solicitudes), caemos a la primera.
  useEffect(() => {
    if (pestanas.length && !pestanas.some(([id]) => id === tab)) setTab(pestanas[0][0]);
  }, [pestanas, tab]);

  function onDecidida(s: Solicitud) {
    setPendientes((ps) => ps.filter((p) => p.id !== s.id));
    setMias((ms) => ms.map((m) => (m.id === s.id ? s : m)));
  }

  return (
    <main className="flex-grow bg-transparent p-6 overflow-y-auto">
      <header className="mb-6 flex items-center gap-3">
        <CalendarDays className="h-6 w-6 text-blue-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Vacaciones y Permisos</h1>
          <p className="text-sm text-gray-500">
            Solicita vacaciones, compensatorios y permisos, o informa una incapacidad. Los días hábiles descuentan
            fines de semana y festivos de Colombia.
          </p>
        </div>
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
                  aprobadorCorreo={contexto.empleado.aprobadorCorreo}
                  onCreada={(s) => setMias((ms) => [s, ...ms])}
                />
              </div>

              <div className={tab === 'mias' ? '' : 'hidden'}>
                <TablaSolicitudes solicitudes={mias} vacio="Todavía no has enviado ninguna solicitud." />
              </div>
            </>
          )}

          {contexto.esAprobador && (
            <div className={tab === 'bandeja' ? '' : 'hidden'}>
              <BandejaAprobacion solicitudes={pendientes} onDecidida={onDecidida} onError={setError} />
            </div>
          )}

          {contexto.esAdmin && (
            <>
              <div className={tab === 'empleados' ? '' : 'hidden'}>
                <ImportarEmpleados />
              </div>
              <div className={tab === 'historico' ? '' : 'hidden'}>
                <ImportarHistorico onImportado={() => setRecargarRegistro((n) => n + 1)} />
                <RegistroGeneral recargarToken={recargarRegistro} />
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
