import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { fetchConAdjunto, type Solicitud } from './api';
import { ETIQUETA_TIPO, TIPOS } from './dominio';
import TablaSolicitudes from './TablaSolicitudes';

// Los soportes de toda la plantilla, para administración.
//
// Hace falta una pantalla propia porque las incapacidades —que son justo las que
// siempre traen soporte médico— nacen `registrada` y sin aprobador, así que la
// bandeja nunca las alcanza. Y aunque el «Registro general» sí las enseña, un
// jefe cualquiera solo ve su propia rama del organigrama: quien tiene la llave
// de adjuntos no siempre es aprobador de esa persona, y a veces ni de nadie.
// Hasta ahora el PDF de una incapacidad ajena solo se podía abrir desde Google
// Drive.
//
// El PDF vive en `portal.solicitud_adjuntos.contenido` desde el alta; esto no lo
// copia a ningún sitio, solo lo sirve con permisos de verdad.

interface Props {
  /** Carga diferida: las pestañas quedan montadas y ocultas con `hidden`. */
  activo: boolean;
}

export default function PanelAdjuntos({ activo }: Props) {
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
    fetchConAdjunto()
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
  }, [activo]);

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
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Soportes adjuntos</h3>
      <p className="mb-3 max-w-3xl text-sm text-gray-600">
        Las solicitudes que llevan un PDF: incapacidades y los permisos con soporte. Pulsa el nombre
        del fichero para descargarlo. Los archivos están guardados en la base de datos del portal, no
        en una carpeta externa.
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
            {/* La categoría, no la acción: un filtro nombra qué se busca, y
                `t.label` es lo que se elige hacer en el formulario. Mismo
                criterio que los filtros del calendario y del registro. */}
            {TIPOS.map((t) => (
              <option key={t.id} value={t.id}>
                {ETIQUETA_TIPO[t.id]}
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
            {filtradas.length} {filtradas.length === 1 ? 'soporte' : 'soportes'}
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
          vacio="Todavía no hay ninguna solicitud con soporte adjunto."
        />
      )}
    </div>
  );
}
