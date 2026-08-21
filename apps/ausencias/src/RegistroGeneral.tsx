import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Loader2, Pencil, Trash2 } from 'lucide-react';
import {
  borrarSolicitud,
  CLASES_MOVIMIENTO,
  fetchEmpleados,
  fetchMovimientos,
  fetchSolicitud,
  type ClaseModificacion,
  type ClaseMovimiento,
  type Empleado,
  type EstadoModificacion,
  type Movimiento,
  type Solicitud,
} from './api';
import {
  chipDeSolicitud,
  diasDeLaFila,
  esOtorgamiento,
  ETIQUETA_TIPO,
  fechasDeLaFila,
  formatInstante,
  resumenPropuesta,
  TIPOS,
} from './dominio';
import EditarSolicitud from './EditarSolicitud';

// El registro general: lo que antes había que ir a mirar a la hoja. Cada fila ya
// no es una solicitud, sino un MOVIMIENTO —o una solicitud, o una modificación
// ya cerrada sobre ella (un cambio de fechas o una anulación)—. Sin las
// modificaciones el registro contaba la mitad de la historia: una solicitud
// anulada aparecía como «rechazada», y quién la anuló, cuándo y por qué no
// constaba en ninguna pantalla.

/**
 * La variante de solicitud de la unión, con nombre propio.
 *
 * Es el candado de esta pantalla, y no un atajo de escritura. Desde que la tabla
 * mezcla dos entidades, cuatro cosas que antes eran ciertas *por construcción*
 * —porque aquí solo había solicitudes— dejan de serlo: los dos totales, los
 * chips por persona, el CSV de nómina y los botones de editar y borrar. Un
 * comentario que lo avisara se rompería solo: esta app no tiene tests y su único
 * portón es `npx tsc --noEmit`, así que el aviso tiene que ser un tipo.
 *
 * De ahí que las funciones que sostienen esas cuatro cosas pidan
 * `MovimientoDeSolicitud[]` y no `Movimiento[]`. Pasarles la lista mezclada NO
 * compila, y por partida doble: la rama de modificación discrepa en `clase` y
 * además en `estado`, que es `EstadoModificacion` e incluye `'retirada'`, un
 * literal que `EstadoSolicitud` no tiene.
 */
type MovimientoDeSolicitud = Extract<Movimiento, { clase: 'solicitud' }>;

/**
 * El estrechamiento, en un solo sitio: `filter(esDeSolicitud)` devuelve
 * `MovimientoDeSolicitud[]`, que es justo lo que exigen las funciones candado.
 */
const esDeSolicitud = (m: Movimiento): m is MovimientoDeSolicitud => m.clase === 'solicitud';

interface Chip {
  label: string;
  clase: string;
}

/** Las clases van completas y literales: Tailwind purga lo que se arme en runtime. */
const CHIP_DESCONOCIDO = 'bg-gray-100 text-gray-700 border-gray-200';

/**
 * Los chips de los estados de una MODIFICACIÓN.
 *
 * Aquí y no en `dominio.ts` porque esta es la única pantalla que enseña el estado
 * de una modificación como tal; las demás enseñan la propuesta viva, que es
 * siempre `pendiente` y no necesita chip.
 *
 * ⚠️ No vale reutilizar `CHIP_ESTADO`: los dos enums comparten los literales
 * `pendiente`, `aprobada` y `rechazada`, pero `EstadoModificacion` tiene además
 * `retirada`, que allí no existe. Es exactamente el solape por el que
 * `Movimiento` es una unión discriminada y no un `estado` suelto.
 */
const CHIP_ESTADO_MODIFICACION: Record<EstadoModificacion, Chip> = {
  // El servidor solo manda modificaciones YA CERRADAS (`m.estado <> 'pendiente'`),
  // así que esta entrada no se pinta hoy. Va igual porque el `Record` es
  // exhaustivo sobre el enum: el día que ese filtro se relaje, la fila aparece
  // rotulada en vez de en blanco, y quien lo relaje no tiene que acordarse de
  // volver aquí.
  pendiente: { label: 'Pendiente', clase: 'bg-amber-100 text-amber-800 border-amber-200' },
  aprobada: { label: 'Aprobada', clase: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  rechazada: { label: 'Rechazada', clase: 'bg-red-100 text-red-700 border-red-200' },
  // Gris y no rojo, por lo mismo que `CHIP_ANULADA` en `dominio.ts`: retirarla no
  // es un castigo, la quitó su propio autor antes de que nadie la decidiera.
  retirada: { label: 'Retirada', clase: 'bg-gray-100 text-gray-700 border-gray-200' },
};

/**
 * El chip del estado de una modificación, con la misma red de seguridad que
 * `chipDe` en `dominio.ts`: hub-api y el portal son dos servicios de EasyPanel y
 * se despliegan por separado, así que hay una ventana de minutos en que uno va
 * por delante. Un estado que este bundle no conozca no puede reventar la tabla.
 */
const chipDeModificacion = (estado: EstadoModificacion): Chip =>
  CHIP_ESTADO_MODIFICACION[estado] ?? { label: estado, clase: CHIP_DESCONOCIDO };

interface ChipDeClase extends Chip {
  /** Qué significan las columnas de esa fila, para el `title`. */
  ayuda: string;
}

/**
 * Qué ES esta fila, cuando no es una solicitud.
 *
 * Sin esto, un cambio de fechas y la solicitud que modifica se leen igual —mismo
 * nombre, mismo tipo, fechas parecidas— y la tabla parece tener duplicados. La
 * `ayuda` no es decorativa: las columnas «Desde», «Hasta» y «Días» de una
 * modificación son sus fechas EFECTIVAS, que en una anulación son las PREVIAS
 * (las que la solicitud tenía antes de desaparecer) y en un cambio son las
 * nuevas. Eso hay que poder leerlo sin ir al código.
 */
const CHIP_CLASE: Record<ClaseModificacion, ChipDeClase> = {
  anulacion: {
    label: 'Anulación',
    clase: 'bg-slate-100 text-slate-700 border-slate-200',
    ayuda: 'Anulación ya decidida. Las fechas y los días son los que la solicitud tenía ANTES de anularse.',
  },
  fechas: {
    label: 'Cambio de fechas',
    clase: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    ayuda: 'Cambio de fechas ya decidido. Las fechas y los días son los que se propusieron.',
  },
};

/**
 * Las opciones del filtro por clase. `Record` exhaustivo sobre `ClaseMovimiento`
 * a propósito: una clase nueva en el servidor no compila hasta que alguien decida
 * cómo se llama aquí, en vez de quedarse fuera del desplegable en silencio.
 */
const ETIQUETA_CLASE: Record<ClaseMovimiento, string> = {
  solicitud: 'Solo solicitudes',
  anulacion: 'Solo anulaciones',
  fechas: 'Solo cambios de fecha',
};

/**
 * Por qué «Decidida por» sale en gris.
 *
 * En las sesiones con token legacy `aprobador_user_id` es NULL, y entonces el
 * nombre sale del `aprobador_correo` congelado en el alta, que es *quién debía
 * firmar* y no necesariamente quién firmó —un admin pudo destrabarla en su
 * lugar—. Pintarlo igual que un decisor que sí consta sería afirmar una autoría
 * que no consta, que es justo lo que el servidor se ha esforzado en no hacer.
 */
const AYUDA_APROXIMADO = 'No consta quién firmó: se muestra el aprobador previsto en el alta de la solicitud.';

interface Props {
  /** Cambia cuando se importa, para recargar sin montar el componente de nuevo. */
  recargarToken: number;
  /** Festivos del contexto, para sugerir el conteo de días al editar. */
  festivos: Set<string>;
  /** Editar y borrar son solo suyos. También decide qué alcance anuncia el subtítulo. */
  esAdmin: boolean;
  /** Si se dibuja el botón del CSV. Quien de verdad recorta lo que sale es el servidor. */
  puedeExportar: boolean;
}

/** Escapa una celda para CSV: comillas dobles y separador dentro del texto. */
function celdaCsv(v: string | number | null): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Los días de un grupo de filas.
 *
 * ⚠️ Pide `MovimientoDeSolicitud[]` **por el tipo y no por costumbre**. Si un
 * cambio de fechas entrara aquí, sus días se sumarían a los de la solicitud que
 * modifica y cada corrección contaría dos veces — y este número es el que alguien
 * usa para nómina. Con la firma así, pasarle la lista mezclada es un error de
 * compilación, no un descuido silencioso.
 */
function sumarDias(filas: MovimientoDeSolicitud[]): number {
  return filas.reduce((a, s) => a + Number(s.diasHabiles), 0);
}

/**
 * Los días por persona, de mayor a menor. Mismo candado y por la misma razón: el
 * chip por persona es exactamente el número que alguien llevaría a nómina.
 */
function contarPorPersona(filas: MovimientoDeSolicitud[]): [string, number][] {
  const m = new Map<string, number>();
  for (const s of filas) m.set(s.empleadoNombre, (m.get(s.empleadoNombre) ?? 0) + Number(s.diasHabiles));
  return [...m].sort((a, b) => b[1] - a[1]);
}

/**
 * El CSV que sustituye al Excel de nómina.
 *
 * ⚠️ Solo entran SOLICITUDES DE AUSENCIA, y el tipo del parámetro es lo que lo
 * sostiene. La regla ya existía para los otorgamientos, y las modificaciones caen
 * bajo exactamente la misma: la columna «Días» significa días fuera en todas las
 * columnas que tiene el fichero, y **no hay ninguna que diga el signo ni que diga
 * que una fila es una anulación**. Una anulación ahí dentro se leería como unos
 * días de ausencia MÁS cuando es justo lo contrario, y un cambio de fechas
 * contaría los mismos días dos veces. Es un error que se descubre en un recibo.
 *
 * Todo eso se sigue viendo en la tabla, que sí marca la clase con un chip y los
 * otorgamientos con un `+`. Quien necesite el detalle lo tiene ahí.
 *
 * El nombre del fichero sigue diciendo `solicitudes_ausencia` porque eso es
 * exactamente lo que lleva dentro, aunque la pantalla de la que sale ya enseñe
 * más cosas.
 */
function exportarCsv(filas: MovimientoDeSolicitud[]) {
  const cab = ['Nombre y Apellidos', 'Tipo', 'Fecha Inicio', 'Fecha Fin', 'Días', 'Estado', 'Comentarios', 'Observaciones'];
  const lineas = [
    cab.join(';'),
    ...filas.map((s) =>
      [
        s.empleadoNombre,
        ETIQUETA_TIPO[s.tipo],
        s.fechaInicio,
        s.fechaFin,
        s.diasHabiles,
        // `chipDeSolicitud` y NO `chipDe(s.estado)`: una anulada saldría rotulada
        // «Rechazada» —quien lo lea entenderá que el jefe le negó unos días que en
        // realidad devolvió la propia persona—. Se exporta la MISMA etiqueta que
        // se ve en pantalla, que es lo que permite cotejar fichero y tabla.
        //
        // Es además la SEGUNDA cerradura del candado de arriba, y sale gratis:
        // `anuladaAt` vive solo en la rama `solicitud` de la unión, así que esta
        // línea tampoco compilaría si alguien ensanchara el parámetro a
        // `Movimiento[]` para «exportarlo todo».
        chipDeSolicitud(s).label,
        s.motivo ?? '',
        // Última columna, en la misma posición que tenía antes de que el
        // registro pasara a ser de movimientos: `observaciones` vive solo en
        // la rama `solicitud` de la unión, así que esta línea es la TERCERA
        // cerradura del candado de más arriba y sale gratis por la misma
        // razón que `anuladaAt`.
        s.observaciones ?? '',
      ]
        .map(celdaCsv)
        .join(';'),
    ),
  ];
  // BOM para que Excel abra las tildes bien en Windows sin preguntar nada.
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `solicitudes_ausencia_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RegistroGeneral({ recargarToken, festivos, esAdmin, puedeExportar }: Props) {
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [editando, setEditando] = useState<Solicitud | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState('');
  const [persona, setPersona] = useState('');
  const [anio, setAnio] = useState('');
  const [clase, setClase] = useState('');
  // Borrado en dos pasos: el primer clic pide confirmación en la propia fila. Es
  // irreversible y toca el registro de la compañía; un clic suelto no basta.
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  // La fila cuya solicitud se está pidiendo al servidor para poder editarla.
  const [abriendo, setAbriendo] = useState<string | null>(null);
  // Una solicitud ya cargada que resultó tener una propuesta de cambio viva. Ver
  // `pedirEdicion`.
  const [avisoPropuesta, setAvisoPropuesta] = useState<{ solicitud: Solicitud; resumen: string } | null>(null);
  // Se incrementa tras guardar una corrección: recarga por el MISMO camino que la
  // carga inicial en vez de parchear la fila a mano. Un movimiento tiene campos
  // que no salen de la solicitud corregida —`decididaPor`, sobre todo—, así que
  // reconstruirlo aquí sería otro mapeo capaz de desviarse en silencio.
  const [recargaLocal, setRecargaLocal] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    // ⚠️ Los empleados solo se piden si quien mira es admin: `GET
    // /ausencias/empleados` va tras `requireAdmin`, así que a un jefe no admin le
    // contestaría 403 y el `Promise.all` entero se caería — dejándole sin registro
    // por culpa de una lista que su pantalla ni siquiera usa (solo la necesita el
    // desplegable de reasignar del modal de edición, que es de admin).
    Promise.all([fetchMovimientos(), esAdmin ? fetchEmpleados() : Promise.resolve<Empleado[]>([])])
      .then(([m, e]) => vivo && (setMovimientos(m), setEmpleados(e), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [recargarToken, recargaLocal, esAdmin]);

  const personas = useMemo(
    () => [...new Set(movimientos.map((m) => m.empleadoNombre))].sort((a, b) => a.localeCompare(b, 'es')),
    [movimientos],
  );
  const anios = useMemo(
    () => [...new Set(movimientos.map((m) => m.fechaInicio.slice(0, 4)))].sort().reverse(),
    [movimientos],
  );

  const filtradas = useMemo(
    () =>
      movimientos.filter(
        (m) =>
          (!tipo || m.tipo === tipo) &&
          (!persona || m.empleadoNombre === persona) &&
          (!anio || m.fechaInicio.startsWith(anio)) &&
          (!clase || m.clase === clase),
      ),
    [movimientos, tipo, persona, anio, clase],
  );

  // El único punto por el que la lista mezclada entra en la contabilidad de la
  // pantalla. De aquí para abajo ya nada puede sumar un cambio de fechas.
  const soloSolicitudes = useMemo(() => filtradas.filter(esDeSolicitud), [filtradas]);

  // ⚠️ Los otorgamientos NO entran en estos dos totales. Sus días SUMAN a una
  // bolsa; los de todos los demás tipos son días fuera. Mezclarlos daría un número
  // sin significado, y el chip por persona es exactamente el número que alguien
  // usaría para nómina.
  const ausencias = useMemo(() => soloSolicitudes.filter((s) => !esOtorgamiento(s.tipo)), [soloSolicitudes]);
  const concedidos = useMemo(() => soloSolicitudes.filter((s) => esOtorgamiento(s.tipo)), [soloSolicitudes]);

  const totalDias = useMemo(() => sumarDias(ausencias), [ausencias]);
  const totalConcedido = useMemo(() => sumarDias(concedidos), [concedidos]);
  const porPersona = useMemo(() => contarPorPersona(ausencias), [ausencias]);

  /**
   * Trae la solicitud ENTERA antes de abrir el modal.
   *
   * De un movimiento faltan `empleadoId` y `observaciones`, y el `PATCH` de
   * edición sobreescribe la fila completa: reconstruir la solicitud a partir de lo
   * que se ve en la tabla borraría las observaciones de la hoja y podría devolver
   * a la persona equivocada una fila que un admin ya había reasignado. Las dos
   * cosas, en silencio y sobre el registro que sustituye al Excel de nómina.
   */
  async function pedirEdicion(m: MovimientoDeSolicitud) {
    setAbriendo(m.id);
    setError(null);
    try {
      const s = await fetchSolicitud(m.solicitudId);
      // Antes de dejar corregir, avisar si hay una propuesta de cambio viva. El
      // registro ya no puede marcarla con un chip —una propuesta PENDIENTE no es
      // un movimiento, el servidor solo manda las cerradas—, y sin el aviso un
      // admin le cambia las fechas sin saber que había una. Los datos los salva el
      // testigo triple del servidor —la aprobación dará 409—, pero al trabajador
      // se le queda la petición invalidada y nadie se lo dice.
      if (s.modificacionPendiente) {
        setAvisoPropuesta({ solicitud: s, resumen: resumenPropuesta(s.modificacionPendiente) });
      } else {
        setEditando(s);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAbriendo(null);
    }
  }

  async function borrar(m: MovimientoDeSolicitud) {
    setBorrando(m.id);
    setError(null);
    try {
      await borrarSolicitud(m.solicitudId);
      // Se van también sus modificaciones: colgaban de esa solicitud y sin ella son
      // filas huérfanas que hablan de algo que ya no existe.
      setMovimientos((ms) => ms.filter((x) => x.solicitudId !== m.solicitudId));
      setConfirmando(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBorrando(null);
    }
  }

  const selCls = 'rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none';

  return (
    <div>
      {/* Sin «de la compañía»: desde que el registro se abre a los jefes, para
          quien no es admin ese título sería falso. El alcance lo dice el
          subtítulo, y lo dice de verdad. */}
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Registro general</h3>
      <p className="mb-3 text-sm text-gray-600">
        {esAdmin
          ? 'Todas las solicitudes de la compañía, y los cambios y anulaciones que se han decidido sobre ellas.'
          : 'Las solicitudes de tu equipo —quienes te reportan y quienes reportan a ellos—, y los cambios y anulaciones que se han decidido sobre ellas.'}
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {avisoPropuesta && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">
              {avisoPropuesta.solicitud.empleadoNombre} tiene una petición de cambio esperando decisión.
            </p>
            <p className="mt-0.5">{avisoPropuesta.resumen}</p>
            <p className="mt-0.5">
              Si corriges las fechas ahora, esa petición se queda invalidada: al aprobarla dará error y el
              trabajador no se enterará. Decídela primero en la bandeja.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditando(avisoPropuesta.solicitud);
                  setAvisoPropuesta(null);
                }}
                className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                Editar de todas formas
              </button>
              <button
                type="button"
                onClick={() => setAvisoPropuesta(null)}
                className="rounded-lg px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {cargando ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select className={selCls} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
              <option value="">Todos los tipos</option>
              {TIPOS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            {/* Sin este filtro la tabla se vuelve ruidosa: una solicitud corregida
                dos veces trae tres filas que se parecen mucho entre sí. */}
            <select className={selCls} value={clase} onChange={(e) => setClase(e.target.value)} aria-label="Movimiento">
              <option value="">Todos los movimientos</option>
              {CLASES_MOVIMIENTO.map((c) => (
                <option key={c} value={c}>
                  {ETIQUETA_CLASE[c]}
                </option>
              ))}
            </select>
            <select className={selCls} value={persona} onChange={(e) => setPersona(e.target.value)} aria-label="Persona">
              <option value="">Todas las personas</option>
              {personas.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select className={selCls} value={anio} onChange={(e) => setAnio(e.target.value)} aria-label="Año">
              <option value="">Todos los años</option>
              {anios.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            {puedeExportar && (
              <button
                type="button"
                onClick={() => exportarCsv(ausencias)}
                // Contra `ausencias` y no contra `filtradas`: es lo que el CSV
                // lleva dentro. Filtrando por «Solo anulaciones», la condición
                // vieja habría dejado el botón vivo para descargar un fichero con
                // solo la cabecera.
                disabled={ausencias.length === 0}
                className="flex items-center gap-1.5 rounded-xl border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <Download className="h-4 w-4" /> Exportar CSV
              </button>
            )}
          </div>

          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            {/* Los dos recuentos, y no solo el de filas: «Días de ausencia» sale de
                las solicitudes, así que enseñar únicamente el de movimientos
                invitaría a dividir un número por el otro. */}
            <span className="text-gray-500">
              {filtradas.length} movimientos · {soloSolicitudes.length} solicitudes
            </span>
            <span className="text-gray-700">
              Días de ausencia: <b className="tabular-nums">{totalDias}</b>
            </span>
            {/* Aparte y solo si los hay: es la otra cara de la moneda, y sumarlo al
                de arriba daría un número que no significa nada. */}
            {totalConcedido > 0 && (
              <span className="text-emerald-700">
                Compensatorios concedidos: <b className="tabular-nums">+{totalConcedido}</b>
              </span>
            )}
          </div>

          {porPersona.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {porPersona.map(([nombre, dias]) => (
                <span key={nombre} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700">
                  {nombre}: <b className="tabular-nums">{dias}</b>
                </span>
              ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Desde</th>
                  <th className="px-4 py-3 font-medium">Hasta</th>
                  <th className="px-4 py-3 text-right font-medium">Días</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Decidida</th>
                  <th className="px-4 py-3 font-medium">Decidida por</th>
                  <th className="px-4 py-3 font-medium">Motivo o comentarios</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtradas.map((m) => {
                  // El chip del estado sale de una función distinta según la clase,
                  // y tiene que ser así: los dos enums comparten literales pero no
                  // significan lo mismo. En una solicitud, `chipDeSolicitud` y NO
                  // `chipDe(m.estado)` —mismo contrato que en las otras cuatro
                  // tablas—: una anulada rotulada «Rechazada» dice que el jefe le
                  // negó unos días que en realidad devolvió la propia persona.
                  const chip = esDeSolicitud(m) ? chipDeSolicitud(m) : chipDeModificacion(m.estado);
                  const clasificacion = esDeSolicitud(m) ? null : CHIP_CLASE[m.clase];
                  const fechas = fechasDeLaFila(m);
                  return (
                    <tr
                      key={`${m.clase}-${m.id}`}
                      // Fondo propio: una modificación y la solicitud de la que
                      // cuelga comparten nombre, tipo y fechas parecidas, y en una
                      // tabla larga se leen como un duplicado.
                      className={
                        clasificacion ? 'align-top bg-gray-50/70 hover:bg-gray-100' : 'align-top hover:bg-gray-50'
                      }
                    >
                      <td className="px-4 py-2.5 text-gray-900">{m.empleadoNombre}</td>
                      <td className="px-4 py-2.5 text-gray-700">{ETIQUETA_TIPO[m.tipo]}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">{fechas.desde}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">
                        {fechas.hasta || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">{diasDeLaFila(m)}</td>
                      <td className="px-4 py-2.5">
                        {clasificacion && (
                          <div className="mb-1">
                            <span
                              title={clasificacion.ayuda}
                              className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${clasificacion.clase}`}
                            >
                              {clasificacion.label}
                            </span>
                          </div>
                        )}
                        <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${chip.clase}`}>
                          {chip.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">
                        {/* `formatInstante` y no `formatFecha`: `decididaAt` es un
                            timestamptz, y cortarle los diez primeros caracteres
                            fecharía al día siguiente una decisión tomada a las
                            20:00 en Bogotá. */}
                        {formatInstante(m.decididaAt) || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">
                        {m.decididaPor ? (
                          <span
                            className={m.decididaPor.aproximado ? 'text-gray-400' : undefined}
                            title={m.decididaPor.aproximado ? AYUDA_APROXIMADO : undefined}
                          >
                            {m.decididaPor.nombre ?? m.decididaPor.correo}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="max-w-md px-4 py-2.5 text-gray-600">
                        {m.motivo || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        {/* ⚠️ Editar y borrar, solo sobre SOLICITUDES y solo para un
                            admin. Una modificación ya cerrada es un asiento del
                            registro: no se corrige ni se borra, porque lo que
                            cuenta es que ocurrió. El candado lo sostiene el tipo —
                            `pedirEdicion` y `borrar` piden `MovimientoDeSolicitud`,
                            así que llamarlas con una fila de modificación no
                            compila. */}
                        {esAdmin && esDeSolicitud(m) ? (
                          confirmando === m.id ? (
                            <span className="flex items-center justify-end gap-2">
                              <span className="text-xs text-gray-600">¿Borrar?</span>
                              <button
                                type="button"
                                disabled={borrando === m.id}
                                onClick={() => void borrar(m)}
                                className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:bg-gray-300"
                              >
                                {borrando === m.id ? 'Borrando…' : 'Sí, borrar'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmando(null)}
                                className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                              >
                                No
                              </button>
                            </span>
                          ) : (
                            <span className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                disabled={abriendo === m.id}
                                onClick={() => void pedirEdicion(m)}
                                aria-label={`Editar la solicitud de ${m.empleadoNombre} del ${m.fechaInicio}`}
                                title="Editar"
                                className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50"
                              >
                                {abriendo === m.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Pencil className="h-4 w-4" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmando(m.id)}
                                aria-label={`Borrar la solicitud de ${m.empleadoNombre} del ${m.fechaInicio}`}
                                title="Borrar del registro"
                                className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </span>
                          )
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editando && (
        <EditarSolicitud
          solicitud={editando}
          empleados={empleados}
          festivos={festivos}
          onCerrar={() => setEditando(null)}
          onGuardada={() => {
            setEditando(null);
            setRecargaLocal((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
