import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { fetchCalendario, type CalendarioDelMes, type MarcaCalendario, type TipoSolicitud } from './api';
import { enTramite, ETIQUETA_TIPO, TIPOS_DE_AUSENCIA } from './dominio';

// La rejilla de persona × día. Los datos llegan YA expandidos por día desde
// hub-api: aquí no se calcula ninguna fecha de ausencia, solo se pinta lo que
// viene. Es deliberado — la aritmética de fechas vive donde hay tests.

interface Props {
  /** Id del empleado de la sesión, para el filtro «solo yo». Null si no tiene ficha. */
  miEmpleadoId: string | null;
  /** Si esta sesión recibe la plantilla entera o solo su propia fila. La tienen
   *  los admin y quien lleve marcada la vista de toda la empresa (migración
   *  032). El recorte real lo hace hub-api en el SQL — esto solo decide si
   *  tiene sentido ofrecer los filtros de persona y qué dice el subtítulo.
   *
   *  Se llamaba `esAdmin`, y el renombre no es cosmético: el permiso dejó de
   *  ser el rol, y una prop que sigue diciendo «admin» invita a colgar de ella
   *  lo que sí es de admin —editar, borrar— el día que alguien añada un botón
   *  a esta pantalla. */
  veTodaLaPlantilla: boolean;
  /** Si la pestaña «Calendario» es la que se ve ahora mismo. Mismo motivo que
   *  `activo` en PanelSaldos: las pestañas quedan montadas y ocultas con
   *  `hidden`, así que sin este freno TODA la plantilla pagaría esta llamada
   *  en cada carga de la app aunque nadie abriera la pestaña — aquí pesa más
   *  que en PanelSaldos porque el público no es solo admin, es cualquiera con
   *  ficha de empleado. A diferencia de PanelSaldos no basta con pedirlo una
   *  sola vez: navegar de mes cambia `mes` y hace falta una petición nueva
   *  por cada mes, así que aquí `activo` entra en las dependencias del efecto
   *  en vez de usarse con una ref de «ya cargado» — eso además refresca el
   *  mes visible cada vez que se vuelve a la pestaña, que es justo lo
   *  deseable si mientras tanto alguien aprobó o pidió algo. */
  activo: boolean;
}

// Tipado por `TipoSolicitud` y no `Record<string, string>`: si el día de
// mañana se añade un quinto tipo de solicitud, con `string` el objeto
// compilaría igual y faltaría su color en silencio — la marca se pintaría con
// `undefined` (invisible), o sea un día ausente que parece libre. Con
// `TipoSolicitud` ese olvido es un error de compilación, no un bug en producción.
/** Color de fondo por tipo. */
const COLOR: Record<TipoSolicitud, string> = {
  vacaciones: 'bg-blue-500',
  compensatorio: 'bg-emerald-500',
  permiso: 'bg-amber-500',
  incapacidad: 'bg-rose-500',
  // Un otorgamiento NUNCA llega aquí: `ausenciasEntre` lo excluye en el SQL,
  // porque no es una ausencia —su fecha es el día que se trabajó, y pintarlo
  // diría que esa persona no estuvo justo el día que sí estuvo—. La entrada
  // existe porque el Record es exhaustivo, y es una red: sin ella el objeto
  // compilaría con `string` y una marca sin color se pintaría invisible.
  otorgamiento: 'bg-slate-400',
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

export default function Calendario({ miEmpleadoId, veTodaLaPlantilla, activo }: Props) {
  const [mes, setMes] = useState(mesActual);
  const [datos, setDatos] = useState<CalendarioDelMes | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState('');
  const [persona, setPersona] = useState('');
  const [soloYo, setSoloYo] = useState(false);

  useEffect(() => {
    // Mientras la pestaña está oculta no se pide nada (ver el comentario de
    // `activo` en Props): no hay forma de cambiar `mes` estando oculta, así
    // que este freno solo retrasa la primera carga, no pierde ninguna.
    if (!activo) return;
    let vivo = true;
    setCargando(true);
    fetchCalendario(mes)
      .then((d) => vivo && (setDatos(d), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [mes, activo]);

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
        {veTodaLaPlantilla
          ? 'Quién está fuera y cuándo. Las solicitudes pendientes de aprobar salen atenuadas y con borde.'
          : 'Tus ausencias del mes. Las solicitudes pendientes de aprobar salen atenuadas y con borde.'}
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
          {TIPOS_DE_AUSENCIA.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        {/* Los dos filtros de persona solo tienen sentido cuando hay más de una:
            quien no ve la plantilla entera recibe únicamente su propia fila, así
            que aquí serían un desplegable de un elemento y una casilla que no
            cambia nada. */}
        {veTodaLaPlantilla && (
          <>
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
          </>
        )}
      </div>

      {cargando ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      ) : error ? null : (
        // La rejilla solo se pinta si la carga fue bien. Si falló, no se afirman
        // los datos del mes anterior bajo la cabecera del mes nuevo: navegar de
        // agosto a septiembre y que septiembre falle no debe dejar la rejilla de
        // agosto puesta debajo del banner de error, como si fuera de septiembre.
        // Mismo criterio que en PanelSaldos.tsx («la lista está vacía porque no
        // sabemos nada, no porque no haya nadie»): aquí no se ve nada porque no
        // se sabe qué hay, no porque el mes esté vacío — eso ya lo dice el banner
        // de arriba. De paso evita la caja vacía (solo cabecera «Nombre» y
        // leyenda) que se pintaba si la primera carga fallaba.
        <>
          <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr>
                  {/* La columna del nombre va pegada: con 31 columnas hay scroll
                      horizontal, y sin esto se pierde de vista de quién es la fila. */}
                  <th scope="col" className="sticky left-0 z-10 border-b border-gray-200 bg-gray-50 px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Nombre
                  </th>
                  {(datos?.dias ?? []).map((d) => (
                    <th
                      key={d.fecha}
                      scope="col"
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
                    {/* `<th scope="row">` y no `<td>`: el nombre encabeza la fila
                        tanto como el día encabeza la columna, y sin `scope="row"`
                        un lector de pantalla no anuncia de quién es cada celda al
                        recorrer la fila. `text-left font-normal` neutraliza el
                        centrado y la negrita que el navegador aplica a los `<th>`
                        por defecto, para que no cambie el aspecto de la columna. */}
                    <th
                      scope="row"
                      className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-1.5 text-left font-normal text-gray-900"
                    >
                      {e.nombreCompleto}
                    </th>
                    {(datos?.dias ?? []).map((d) => {
                      const marca = porCelda.get(`${e.id}|${d.fecha}`);
                      // Mismo contenido que el `title`: sin un nombre accesible la
                      // marca es un `<div>` de color sin más, y un lector de
                      // pantalla no saca nada de la rejilla salvo celdas vacías.
                      // `enTramite` y no `=== 'pendiente'`: con la aprobación en
                      // cascada hay dos estados sin firmar, y comparando solo el
                      // primero la media firma se pintaría sólida — es decir,
                      // idéntica a una aprobada, que es justo lo que no es.
                      const descripcion = marca
                        ? `${ETIQUETA_TIPO[marca.tipo]} · ${d.fecha}${
                            enTramite(marca.estado) ? ' · pendiente de aprobar' : ''
                          }`
                        : '';
                      return (
                        <td key={d.fecha} className={`p-0.5 ${d.laborable ? '' : 'bg-gray-50'}`}>
                          {marca && (
                            <div
                              role="img"
                              title={descripcion}
                              aria-label={descripcion}
                              className={`h-5 w-full rounded-sm ${COLOR[marca.tipo]} ${
                                enTramite(marca.estado) ? 'opacity-40 ring-1 ring-inset ring-gray-500' : ''
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
            {TIPOS_DE_AUSENCIA.map((t) => (
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
