import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  fetchCalendario,
  fetchCalendarioAnual,
  type CalendarioDelAnio,
  type CalendarioDelMes,
  type FranjaCalendario,
  type MarcaCalendario,
  type TipoSolicitud,
} from './api';
import { enTramite, ETIQUETA_TIPO, TIPOS_DE_AUSENCIA } from './dominio';

// La rejilla de persona × día. Los datos llegan YA expandidos por día desde
// hub-api: aquí no se calcula ninguna fecha de ausencia, solo se pinta lo que
// viene. Es deliberado — la aritmética de fechas vive donde hay tests.

interface Props {
  /** Id del empleado de la sesión, para el filtro «solo yo». Null si no tiene ficha. */
  miEmpleadoId: string | null;
  // Aquí había una prop `veTodaLaPlantilla` (y antes `esAdmin`) que decidía si
  // se ofrecían los filtros de persona y qué decía el subtítulo. Se retiró: el
  // alcance dejó de tener dos escalones y pasó a tener tres —la plantilla, la
  // rama de un jefe, y la fila propia—, así que ningún booleano de permiso
  // volvía a responder la única pregunta que esta pantalla necesita, que es
  // «¿hay más de una persona en la rejilla?». Eso lo dice la respuesta del
  // servidor y no hace falta deducirlo: se mira `datos.empleados.length`.
  //
  // Además cierra un sitio donde el navegador podía discrepar del SQL. Con la
  // prop, un jefe habría recibido varias filas y un desplegable escondido.
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

/** «ene», «feb»… para las etiquetas de la franja anual, donde no cabe más. */
const mesCorto = (mes: string) =>
  new Date(`${mes}-01T00:00:00Z`).toLocaleDateString('es-CO', { month: 'short', timeZone: 'UTC' });

/** El mes, día a día; o el año entero de un vistazo. */
type Vista = 'mes' | 'anio';

/**
 * Un porcentaje del ancho del año, con tres decimales.
 *
 * Tres y no dos: un día es 1/365 = 0,274 %, así que redondear a dos centésimas
 * mueve cada barra hasta un cuarto de día, y el error se ACUMULA a lo largo del
 * año — en diciembre serían varios días de desfase contra las etiquetas de los
 * meses, que se calculan con los mismos ordinales.
 */
const pct = (dias: number, total: number) => `${((dias / total) * 100).toFixed(3)}%`;

export default function Calendario({ miEmpleadoId, activo }: Props) {
  const [vista, setVista] = useState<Vista>('mes');
  const [mes, setMes] = useState(mesActual);
  // El año arranca en el del mes visible, para que cambiar de vista no salte a
  // otro sitio. A partir de ahí cada uno navega por su cuenta.
  const [anio, setAnio] = useState(() => mesActual().slice(0, 4));
  const [datos, setDatos] = useState<CalendarioDelMes | null>(null);
  const [anual, setAnual] = useState<CalendarioDelAnio | null>(null);
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
    // Dos peticiones distintas porque son dos formas distintas de respuesta, no
    // dos filtros sobre la misma: el mes trae una marca por día y el año una
    // franja por ausencia. Ver `fetchCalendarioAnual`.
    const peticion =
      vista === 'mes'
        ? fetchCalendario(mes).then((d) => vivo && (setDatos(d), setError(null)))
        : fetchCalendarioAnual(anio).then((d) => vivo && (setAnual(d), setError(null)));
    peticion.catch((e: Error) => vivo && setError(e.message)).finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [vista, mes, anio, activo]);

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

  // Las franjas agrupadas por persona, ya filtradas por tipo. Agrupar aquí y no
  // al pintar evita recorrer la lista entera una vez por fila, que con la
  // plantilla completa son ~40 recorridos de ~300 elementos en cada render.
  const franjasPorEmpleado = useMemo(() => {
    const m = new Map<string, FranjaCalendario[]>();
    for (const f of anual?.franjas ?? []) {
      if (tipo && f.tipo !== tipo) continue;
      const suyas = m.get(f.empleadoId);
      if (suyas) suyas.push(f);
      else m.set(f.empleadoId, [f]);
    }
    return m;
  }, [anual, tipo]);

  // La lista de personas de la vista que esté puesta. Las dos respuestas traen
  // el MISMO `empleados` —mismo alcance, misma consulta— así que los filtros de
  // persona valen para las dos sin traducir nada.
  const empleados = vista === 'mes' ? datos?.empleados : anual?.empleados;

  // «Solo yo» gana sobre el desplegable: es el atajo del uso personal y no tiene
  // sentido que convivan dos filtros de persona contradiciéndose.
  const filas = useMemo(
    () => (empleados ?? []).filter((e) => (soloYo ? e.id === miEmpleadoId : !persona || e.id === persona)),
    [empleados, soloYo, persona, miEmpleadoId],
  );

  // Si la rejilla trae a más de una persona. Sale del DATO y no de un permiso:
  // el alcance lo decide el servidor —la plantilla entera, la rama de dos
  // niveles de un jefe, o la fila propia— y esta pantalla solo necesita saber si
  // hay a quién filtrar. Sin datos todavía es `false`, y los filtros aparecen
  // con la rejilla; no antes que ella, que es lo natural.
  const hayVariasPersonas = (empleados?.length ?? 0) > 1;

  /** Abre un mes concreto desde la franja anual. */
  function irAlMes(m: string) {
    setMes(m);
    setVista('mes');
  }

  const selCls = 'rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none';
  const navCls = 'rounded-lg border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-50';

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Calendario de ausencias</h3>
      <p className="mb-3 text-sm text-gray-600">
        {hayVariasPersonas
          ? 'Quién está fuera y cuándo. Las solicitudes pendientes de aprobar salen atenuadas y con borde.'
          : `Tus ausencias ${vista === 'mes' ? 'del mes' : 'del año'}. Las solicitudes pendientes de aprobar salen atenuadas y con borde.`}
        {vista === 'anio' && ' Pulsa el nombre de un mes para abrirlo día a día.'}
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* El selector va PRIMERO, antes que las flechas: es lo que decide qué
            mueven esas flechas, y leerlo después obliga a releerlas. */}
        <div role="group" aria-label="Vista del calendario" className="flex rounded-xl border border-gray-300 p-0.5">
          {(['mes', 'anio'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              // `aria-pressed` y no solo el color: sin él, para un lector de
              // pantalla los dos botones son idénticos y no hay forma de saber
              // cuál está puesto.
              aria-pressed={vista === v}
              className={`rounded-lg px-3 py-1 text-sm ${
                vista === v ? 'bg-blue-600 font-medium text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {v === 'mes' ? 'Mes' : 'Año'}
            </button>
          ))}
        </div>

        {vista === 'mes' ? (
          <>
            <button type="button" onClick={() => setMes((m) => sumarMeses(m, -1))} aria-label="Mes anterior" className={navCls}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-44 text-center text-sm font-medium capitalize text-gray-900">{nombreMes(mes)}</span>
            <button type="button" onClick={() => setMes((m) => sumarMeses(m, 1))} aria-label="Mes siguiente" className={navCls}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            {/* La aritmética del año es sumar uno a un entero, así que va aquí y
                no en el servidor: no hay meses de 30 ni bisiestos que puedan
                salir mal. Lo que sí sale del servidor —los días de cada mes y
                los ordinales— es lo que no se puede contar sin equivocarse. */}
            <button
              type="button"
              onClick={() => setAnio((a) => String(Number(a) - 1))}
              aria-label="Año anterior"
              className={navCls}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-44 text-center text-sm font-medium text-gray-900">{anio}</span>
            <button
              type="button"
              onClick={() => setAnio((a) => String(Number(a) + 1))}
              aria-label="Año siguiente"
              className={navCls}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}

        <select className={selCls} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {TIPOS_DE_AUSENCIA.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        {/* Los dos filtros de persona solo tienen sentido cuando hay más de una:
            a quien recibe únicamente su propia fila le serían un desplegable de
            un elemento y una casilla que no cambia nada. La condición mira la
            rejilla y no un permiso — ver `hayVariasPersonas`. */}
        {hayVariasPersonas && (
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
          {vista === 'anio' ? (
            <FranjaAnual datos={anual} filas={filas} franjasPorEmpleado={franjasPorEmpleado} onAbrirMes={irAlMes} />
          ) : (
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
          )}

          {/* La leyenda va FUERA del condicional: los colores y la atenuación
              significan lo mismo en las dos vistas, y duplicarla es como se
              acaba con dos leyendas que dicen cosas distintas. */}
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

interface FranjaAnualProps {
  datos: CalendarioDelAnio | null;
  /** Ya filtradas por «solo yo» y por el desplegable de persona. */
  filas: { id: string; nombreCompleto: string }[];
  franjasPorEmpleado: Map<string, FranjaCalendario[]>;
  onAbrirMes: (mes: string) => void;
}

/**
 * El año entero como una franja por persona.
 *
 * NO es una `<table>`, y es la única diferencia estructural con la vista
 * mensual: una barra que cubre nueve días no es una celda, es un elemento que
 * abarca nueve columnas que aquí ni existen. Forzarlo a una tabla exigiría
 * volver a las 365 celdas por fila —14.600 nodos para la plantilla entera— que
 * es justo lo que el formato de franjas evita.
 *
 * A cambio hay que reponer a mano lo que una tabla daba gratis: cada barra lleva
 * el NOMBRE de la persona en su etiqueta, porque no hay `scope="row"` que se lo
 * dé por contexto, y las filas sin ausencias dicen que están vacías en vez de
 * quedarse mudas.
 *
 * Todos los anchos salen de los ordinales que manda el servidor. Aquí no se
 * calcula ni una fecha: es el mismo principio que abre `calendario.ts` en
 * hub-api, y pesa más aquí porque esta app no tiene tests.
 */
function FranjaAnual({ datos, filas, franjasPorEmpleado, onAbrirMes }: FranjaAnualProps) {
  if (!datos) return null;
  const total = datos.diasDelAnio;

  return (
    // `min-w` para que la franja no se comprima hasta ser ilegible en un móvil:
    // por debajo de ~56rem un mes mide menos de 50px y las barras de un día
    // desaparecen. A partir de ahí, scroll horizontal — pero de una pantalla,
    // no de las doce que costaba ver el año antes.
    <div className="overflow-x-auto rounded-2xl border border-gray-200">
      <div className="min-w-[56rem]">
        <div className="flex border-b border-gray-200 bg-gray-50">
          <div className="w-48 shrink-0 px-4 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            Nombre
          </div>
          <div className="flex flex-1">
            {datos.meses.map((m) => (
              <button
                key={m.mes}
                type="button"
                onClick={() => onAbrirMes(m.mes)}
                // El ancho es proporcional a los DÍAS del mes, no 1/12: con doce
                // columnas iguales, febrero ocuparía lo mismo que enero y las
                // barras —que sí se posicionan por día— dejarían de caer bajo su
                // mes. El desfase se acumula y en diciembre son varios días.
                style={{ width: pct(m.dias, total) }}
                title={`Ver ${mesCorto(m.mes)} día a día`}
                className="border-l border-gray-200 py-2 text-center text-xs font-medium capitalize text-gray-500 first:border-l-0 hover:bg-gray-100 hover:text-blue-600"
              >
                {mesCorto(m.mes)}
              </button>
            ))}
          </div>
        </div>

        <ul className="divide-y divide-gray-100">
          {filas.map((e) => {
            const suyas = franjasPorEmpleado.get(e.id) ?? [];
            return (
              <li key={e.id} className="flex items-center hover:bg-gray-50">
                <div className="w-48 shrink-0 truncate px-4 py-1.5 text-sm text-gray-900" title={e.nombreCompleto}>
                  {e.nombreCompleto}
                </div>
                <div className="relative h-7 flex-1">
                  {/* Las separaciones de mes, para poder situar una barra sin
                      contar desde el borde. Se salta la de enero: caería justo
                      encima del borde izquierdo de la pista. */}
                  {datos.meses.slice(1).map((m) => (
                    <div
                      key={m.mes}
                      aria-hidden="true"
                      style={{ left: pct(m.desdeDia - 1, total) }}
                      className="absolute inset-y-0 w-px bg-gray-200"
                    />
                  ))}

                  {suyas.map((f) => {
                    // `desdeDia` empieza en 1, así que se le resta uno para
                    // convertirlo en desplazamiento; y el ancho lleva el `+1`
                    // porque los dos extremos son inclusivos — sin él, una
                    // ausencia de un solo día mediría cero y no se pintaría.
                    const descripcion =
                      `${e.nombreCompleto} · ${ETIQUETA_TIPO[f.tipo]} · ` +
                      `${f.fechaInicio}${f.fechaFin !== f.fechaInicio ? ` a ${f.fechaFin}` : ''}` +
                      `${enTramite(f.estado) ? ' · pendiente de aprobar' : ''}`;
                    return (
                      <div
                        key={`${f.tipo}|${f.fechaInicio}|${f.fechaFin}`}
                        role="img"
                        title={descripcion}
                        aria-label={descripcion}
                        style={{
                          left: pct(f.desdeDia - 1, total),
                          width: pct(f.hastaDia - f.desdeDia + 1, total),
                          // Un día es el 0,27 % del año: en una pista de 700px
                          // son menos de dos píxeles, y una incapacidad de un día
                          // se vería como una raya que no se distingue del
                          // separador de mes. Se le da un mínimo visible; el
                          // desplazamiento que introduce es de medio día y no se
                          // acumula, porque solo afecta al ancho de esa barra.
                          minWidth: '3px',
                        }}
                        className={`absolute top-1.5 h-4 rounded-sm ${COLOR[f.tipo]} ${
                          enTramite(f.estado) ? 'opacity-40 ring-1 ring-inset ring-gray-500' : ''
                        }`}
                      />
                    );
                  })}

                  {/* Sin esto, la fila de quien no faltó ningún día es una banda
                      en blanco que un lector de pantalla anuncia como nada. */}
                  {suyas.length === 0 && <span className="sr-only">Sin ausencias este año</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
