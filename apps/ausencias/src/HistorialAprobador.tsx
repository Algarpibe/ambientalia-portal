import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { fetchDecididas, type Solicitud } from './api';
import { TIPOS } from './dominio';
import TablaSolicitudes from './TablaSolicitudes';

// Lo que este aprobador ya cerró. Hasta ahora no existía: al decidir, la
// solicitud salía de la bandeja y no volvía a aparecer en ningún sitio, así que
// no había forma de responder a «¿qué le aprobé a esta persona en marzo?».
//
// Va acotado al propio correo también para un admin: quien quiera verlo todo
// tiene «Registro general», y duplicarlo aquí solo lo haría peor y confuso.

interface Props {
  /** Carga diferida: las pestañas quedan montadas y ocultas con `hidden`. */
  activo: boolean;
  /** Token que cambia cuando se decide algo, para volver a pedir la lista. */
  recargarToken: number;
}

export default function HistorialAprobador({ activo, recargarToken }: Props) {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState('');
  const [persona, setPersona] = useState('');
  const [anio, setAnio] = useState('');

  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    setCargando(true);
    fetchDecididas()
      .then((s) => {
        if (!vivo) return;
        setSolicitudes(s);
        setError(null);
      })
      .catch((e: Error) => {
        if (!vivo) return;
        // Se vacía a propósito: dejar la lista anterior bajo un banner de error
        // sería afirmar unos datos que ya no se sostienen.
        setSolicitudes([]);
        setError(e.message);
      })
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [activo, recargarToken]);

  const personas = useMemo(
    () => [...new Set(solicitudes.map((s) => s.empleadoNombre))].sort((a, b) => a.localeCompare(b, 'es')),
    [solicitudes],
  );
  const anios = useMemo(
    () => [...new Set(solicitudes.map((s) => s.fechaInicio.slice(0, 4)))].sort().reverse(),
    [solicitudes],
  );

  const filtradas = useMemo(
    () =>
      solicitudes.filter(
        (s) =>
          (!tipo || s.tipo === tipo) &&
          (!persona || s.empleadoNombre === persona) &&
          (!anio || s.fechaInicio.startsWith(anio)),
      ),
    [solicitudes, tipo, persona, anio],
  );

  const selCls = 'rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none';

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Historial de aprobaciones</h3>
      <p className="mb-3 text-sm text-gray-600">
        Las solicitudes que te tocaba firmar y ya están cerradas, aprobadas o rechazadas. Las que siguen
        esperando tu decisión están en <b>Pendientes de aprobar</b>.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {solicitudes.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className={selCls} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
            <option value="">Todos los tipos</option>
            {TIPOS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>

          {personas.length > 1 && (
            <select className={selCls} value={persona} onChange={(e) => setPersona(e.target.value)} aria-label="Persona">
              <option value="">Todas las personas</option>
              {personas.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}

          {anios.length > 1 && (
            <select className={selCls} value={anio} onChange={(e) => setAnio(e.target.value)} aria-label="Año">
              <option value="">Todos los años</option>
              {anios.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}

          <span className="text-sm text-gray-500">
            {filtradas.length} {filtradas.length === 1 ? 'solicitud' : 'solicitudes'}
          </span>
        </div>
      )}

      {cargando ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      ) : error ? null : (
        <TablaSolicitudes
          solicitudes={filtradas}
          mostrarSolicitante
          mostrarDecidida
          vacio="Todavía no has decidido ninguna solicitud."
        />
      )}
    </div>
  );
}
