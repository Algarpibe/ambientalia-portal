import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { fetchCalendario, type CalendarioDelMes, type MarcaCalendario } from './api';
import { ETIQUETA_TIPO, TIPOS } from './dominio';

// La rejilla de persona × día. Los datos llegan YA expandidos por día desde
// hub-api: aquí no se calcula ninguna fecha de ausencia, solo se pinta lo que
// viene. Es deliberado — la aritmética de fechas vive donde hay tests.

interface Props {
  /** Id del empleado de la sesión, para el filtro «solo yo». Null si no tiene ficha. */
  miEmpleadoId: string | null;
}

/** Color de fondo por tipo. */
const COLOR: Record<string, string> = {
  vacaciones: 'bg-blue-500',
  compensatorio: 'bg-emerald-500',
  permiso: 'bg-amber-500',
  incapacidad: 'bg-rose-500',
};

/** El mes en curso como `YYYY-MM`, en hora de Colombia (UTC−5, sin horario de verano). */
function mesActual(): string {
  return new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 7);
}

/** Suma meses a un `YYYY-MM` sin pasar por la zona horaria local. */
function sumarMeses(mes: string, n: number): string {
  const anio = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return new Date(Date.UTC(anio, m - 1 + n, 1)).toISOString().slice(0, 7);
}

const nombreMes = (mes: string) =>
  new Date(`${mes}-01T00:00:00Z`).toLocaleDateString('es-CO', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export default function Calendario({ miEmpleadoId }: Props) {
  const [mes, setMes] = useState(mesActual);
  const [datos, setDatos] = useState<CalendarioDelMes | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState('');
  const [persona, setPersona] = useState('');
  const [soloYo, setSoloYo] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    fetchCalendario(mes)
      .then((d) => vivo && (setDatos(d), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [mes]);

  // Clave `empleadoId|fecha`: cada celda hace una consulta directa en vez de
  // recorrer la lista entera 15 × 31 veces.
  const porCelda = useMemo(() => {
    const m = new Map<string, MarcaCalendario>();
    for (const marca of datos?.marcas ?? []) {
      if (tipo && marca.tipo !== tipo) continue;
      m.set(`${marca.empleadoId}|${marca.fecha}`, marca);
    }
    return m;
  }, [datos, tipo]);

  // «Solo yo» gana sobre el desplegable: es el atajo del uso personal y no tiene
  // sentido que convivan dos filtros de persona contradiciéndose.
  const filas = useMemo(
    () =>
      (datos?.empleados ?? []).filter((e) =>
        soloYo ? e.id === miEmpleadoId : !persona || e.id === persona,
      ),
    [datos, soloYo, persona, miEmpleadoId],
  );

  const selCls = 'rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none';
  const navCls = 'rounded-lg border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-50';

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Calendario de ausencias</h3>
      <p className="mb-3 text-sm text-gray-600">
        Quién está fuera y cuándo. Las solicitudes pendientes de aprobar salen atenuadas y con borde.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setMes((m) => sumarMeses(m, -1))} aria-label="Mes anterior" className={navCls}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-44 text-center text-sm font-medium capitalize text-gray-900">{nombreMes(mes)}</span>
        <button type="button" onClick={() => setMes((m) => sumarMeses(m, 1))} aria-label="Mes siguiente" className={navCls}>
          <ChevronRight className="h-4 w-4" />
        </button>

        <select className={selCls} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        <select
          className={selCls}
          value={persona}
          disabled={soloYo}
          onChange={(e) => setPersona(e.target.value)}
          aria-label="Persona"
        >
          <option value="">Todas las personas</option>
          {(datos?.empleados ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombreCompleto}
            </option>
          ))}
        </select>

        {miEmpleadoId && (
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={soloYo} onChange={(e) => setSoloYo(e.target.checked)} />
            Solo yo
          </label>
        )}
      </div>

      {cargando ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr>
                  {/* La columna del nombre va pegada: con 31 columnas hay scroll
                      horizontal, y sin esto se pierde de vista de quién es la fila. */}
                  <th className="sticky left-0 z-10 border-b border-gray-200 bg-gray-50 px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Nombre
                  </th>
                  {(datos?.dias ?? []).map((d) => (
                    <th
                      key={d.fecha}
                      className={`w-8 border-b border-gray-200 py-2 text-center text-xs font-medium ${
                        d.laborable ? 'bg-gray-50 text-gray-500' : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {Number(d.fecha.slice(8, 10))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filas.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-1.5 text-gray-900">
                      {e.nombreCompleto}
                    </td>
                    {(datos?.dias ?? []).map((d) => {
                      const marca = porCelda.get(`${e.id}|${d.fecha}`);
                      return (
                        <td key={d.fecha} className={`p-0.5 ${d.laborable ? '' : 'bg-gray-50'}`}>
                          {marca && (
                            <div
                              title={`${ETIQUETA_TIPO[marca.tipo]} · ${d.fecha}${
                                marca.estado === 'pendiente' ? ' · pendiente de aprobar' : ''
                              }`}
                              className={`h-5 w-full rounded-sm ${COLOR[marca.tipo]} ${
                                marca.estado === 'pendiente' ? 'opacity-40 ring-1 ring-inset ring-gray-500' : ''
                              }`}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-600">
            {TIPOS.map((t) => (
              <span key={t.id} className="flex items-center gap-1.5">
                <span className={`inline-block h-3 w-3 rounded-sm ${COLOR[t.id]}`} /> {t.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-blue-500 opacity-40 ring-1 ring-inset ring-gray-500" />{' '}
              Pendiente de aprobar
            </span>
          </div>
        </>
      )}
    </div>
  );
}
