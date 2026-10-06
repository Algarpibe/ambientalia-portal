import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronsLeft, RefreshCw, Search } from 'lucide-react';
import { api, type Servicios as Datos } from '../api';
import { type EstadoPlazo, type ServicioVista, type TipoServicioOpcion } from '../dominio';
import {
  GRUPOS_PLAZO,
  TITULO_STANDBY,
  TONO_PLAZO,
  alternarGrupo,
  avisoSinTipo,
  barraServicio,
  columna,
  contarGrupo,
  contarPlazos,
  contarStandby,
  diasDelEje,
  ejeServicios,
  filtrarServicios,
  grupoElegido,
  leyendaServicios,
  mesesDelEje,
  notaTipo,
  pausasBarra,
  porUrgenciaPlazo,
  resumenServicios,
  segmentosBarra,
  selectorTipo,
  textoPlazo,
  textoTramos,
  tituloFechaLimite,
  tituloGrupo,
  tituloSegmento,
  tituloStandby,
  tituloTerminado,
} from '../lib/servicios';
import { fmtFecha } from '../lib/vistas';
import { Alert, Button, Loading, Tag } from '../ui';

/**
 * Servicios: todos los tickets de Zoho Desk que no están cerrados, con la
 * fecha límite que les da el plazo de su tipo de servicio (pestaña
 * «Configuración»). Dos vistas de lo mismo: la lista y el calendario de barras.
 * Carga sus propios datos: no dependen del inventario de la F-ST-022.
 *
 * El tipo de servicio se puede poner a mano desde la lista (Desk aún no lo
 * envía) y manda sobre el de Desk. Al cambiarlo, el servidor devuelve todos
 * los servicios recalculados y se sustituyen de una vez: fecha límite,
 * contadores y barras salen del mismo dato, sin recargar la página.
 *
 * El estado de Desk del ticket tiene un rol en el reloj (se elige en
 * «Configuración»). «standby» lo pone en pausa: esos días hábiles no cuentan y
 * la fecha límite se corre; en el calendario salen como una banda rayada
 * neutra dentro de la barra. «terminado» lo para: la barra acaba el día en que
 * se terminó el trabajo, con una marca, en verde si cumplió, en rojo si no y
 * en neutro si no se pudo medir. Todo llega ya calculado del servidor: aquí
 * sólo se enseña, se cuenta y se filtra.
 */
type Vista = 'lista' | 'calendario';
type Orden = 'plazo' | 'numero' | 'cliente' | 'serial' | 'tipo' | 'estado' | 'ingreso' | 'limite';

interface Props {
  onConfigurar: () => void;
  notificar: (msg: string) => void;
}

export default function Servicios({ onConfigurar, notificar }: Props) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [vista, setVista] = useState<Vista>('lista');
  const [estados, setEstados] = useState<EstadoPlazo[]>([]);
  /** Filtro «Standby»: se suma a los del plazo (tiene que cumplir los dos). */
  const [soloStandby, setSoloStandby] = useState(false);
  const [texto, setTexto] = useState('');
  const [orden, setOrden] = useState<{ k: Orden; dir: 1 | -1 }>({ k: 'plazo', dir: 1 });

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await api.servicios());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Ticket cuyo tipo se está guardando. Mientras dura, ningún desplegable admite otro cambio: las respuestas no se pisan. */
  const [guardando, setGuardando] = useState<number | null>(null);

  /** Pone a mano el tipo de un ticket (clave vacía = quitarlo) y pinta lo que devuelve el servidor. */
  const cambiarTipo = useCallback(
    async (s: ServicioVista, clave: string, etiqueta: string) => {
      setGuardando(s.numero);
      try {
        setDatos(await api.fijarTipoServicio(s.numero, clave || null));
        setError(null);
        notificar(clave ? `Ticket ${s.numero}: ${etiqueta}` : `Ticket ${s.numero}: tipo puesto a mano quitado`);
      } catch (e) {
        setError(`No se pudo guardar el tipo de servicio del ticket ${s.numero}: ${(e as Error).message}`);
        notificar(`Ticket ${s.numero}: no se pudo guardar el tipo de servicio`);
      } finally {
        setGuardando(null);
      }
    },
    [notificar],
  );

  const servicios = useMemo(() => datos?.servicios ?? [], [datos]);
  const tipos = useMemo(() => datos?.tipos ?? [], [datos]);
  const res = useMemo(() => resumenServicios(servicios), [servicios]);
  const cnt = useMemo(() => contarPlazos(servicios), [servicios]);

  const enStandby = useMemo(() => contarStandby(servicios), [servicios]);

  const q = texto.trim();
  const lista = useMemo(() => {
    const val = (s: ServicioVista): string | number => {
      switch (orden.k) {
        case 'plazo':
          return 0; // lo resuelve porUrgenciaPlazo
        case 'numero':
          return s.numero;
        case 'cliente':
          return s.cliente.toLowerCase();
        case 'serial':
          return s.serial;
        case 'tipo':
          return s.tipoServicio.toLowerCase();
        case 'estado':
          return s.estado.toLowerCase();
        case 'ingreso':
          return s.ingreso ?? '';
        case 'limite':
          // Sin fecha límite, siempre al final de la subida.
          return s.fechaLimite ?? '9999';
      }
    };
    return filtrarServicios(servicios, { estados, standby: soloStandby, texto }).sort((a, b) => {
      if (orden.k === 'plazo') return porUrgenciaPlazo(a, b) * orden.dir;
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * orden.dir || porUrgenciaPlazo(a, b);
    });
  }, [servicios, estados, soloStandby, texto, orden]);

  if (!datos) return error ? <Alert tone="red">{error}</Alert> : <Loading texto="Cargando los servicios abiertos en Zoho Desk…" />;

  const aviso = avisoSinTipo(res);

  const Th = ({ k, children, right = false }: { k: Orden; children: string; right?: boolean }) => (
    <th className={`px-3 py-2 font-semibold ${right ? 'text-right' : ''}`}>
      <button type="button" onClick={() => setOrden((o) => ({ k, dir: o.k === k ? (-o.dir as 1 | -1) : 1 }))} className="uppercase tracking-wide hover:text-gray-800">
        {children}
        {orden.k === k ? (orden.dir > 0 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="red">{error}</Alert>}

      {/* Hoy Desk no manda el tipo de servicio: se dice claro, y dónde se elige a mano. Se va solo cuando todos tienen tipo. */}
      {aviso && (
        <Alert tone="blue" title={aviso.titulo}>
          <p>{aviso.texto}</p>
        </Alert>
      )}
      {res.tiposSinPlazo.length > 0 && (
        <Alert tone="amber" title="Hay tipos de servicio sin plazo">
          <p>
            {res.tiposSinPlazo.join(', ')}.{' '}
            <button type="button" onClick={onConfigurar} className="font-semibold underline">
              Ponles un plazo en Configuración
            </button>{' '}
            para que sus servicios tengan fecha límite.
          </p>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Vista" className="inline-flex overflow-hidden rounded-xl border border-gray-300 bg-white">
          {(['lista', 'calendario'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={vista === v}
              onClick={() => setVista(v)}
              className={`min-h-[44px] px-4 text-sm font-medium capitalize transition-colors ${vista === v ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              {v}
            </button>
          ))}
        </div>
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Buscar por ticket, cliente o serial</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por ticket, cliente o serial"
            className="block min-h-[44px] w-full rounded-xl border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <Button variant="ghost" onClick={() => void cargar()} busy={cargando} aria-label="Actualizar servicios">
          {!cargando && <RefreshCw className="h-4 w-4" aria-hidden />} Actualizar
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Un filtro por estado del plazo; los tres veredictos del trabajo terminado van en uno solo, con el desglose en su `title`. */}
        {GRUPOS_PLAZO.map((g) => {
          const puesto = grupoElegido(g, estados);
          return (
            <button
              key={g.clave}
              type="button"
              aria-pressed={puesto}
              onClick={() => setEstados((x) => alternarGrupo(g, x))}
              title={tituloGrupo(g, cnt)}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                puesto ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${g.dot}`} aria-hidden />
              {g.etiqueta}
              <span className="tabular-nums opacity-60">{contarGrupo(g, cnt)}</span>
            </button>
          );
        })}
        {/* Standby no es un estado del plazo: es el rol del estado de Desk (reloj en pausa), y se combina con los de arriba. */}
        <button
          type="button"
          aria-pressed={soloStandby}
          onClick={() => setSoloStandby((x) => !x)}
          title={TITULO_STANDBY}
          className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
            soloStandby ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className="h-2 w-2 rounded-full border border-current" aria-hidden />
          Standby
          <span className="tabular-nums opacity-60">{enStandby}</span>
        </button>
        {(estados.length > 0 || soloStandby || q) && (
          <button
            type="button"
            onClick={() => {
              setEstados([]);
              setSoloStandby(false);
              setTexto('');
            }}
            className="px-2 text-sm font-medium text-blue-600 hover:underline"
          >
            Quitar filtros
          </button>
        )}
      </div>

      <p className="text-sm text-gray-500">
        <span className="font-semibold text-gray-800">{lista.length}</span> servicio{lista.length === 1 ? '' : 's'} abierto{lista.length === 1 ? '' : 's'} en Zoho Desk ·
        plazo en días hábiles desde el ingreso, a {fmtFecha(datos.hoy)}
        {res.sinConfirmar > 0 && <> · {res.sinConfirmar} sin confirmar (Desk lleva más de un día sin refrescarlos: pueden estar ya cerrados)</>}
      </p>

      {vista === 'lista' ? (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <Th k="numero">Ticket</Th>
                <Th k="cliente">Cliente</Th>
                <Th k="serial">Serial</Th>
                <th className="px-3 py-2 font-semibold uppercase tracking-wide">Modelo</th>
                <Th k="tipo">Tipo de servicio</Th>
                <Th k="estado">Estado en Desk</Th>
                <Th k="ingreso">Ingreso</Th>
                <Th k="limite">Fecha límite</Th>
                <Th k="plazo" right>
                  Plazo (días hábiles)
                </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.map((s) => (
                <tr key={s.numero} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[13px] font-semibold text-gray-900">
                    {s.numero} {s.sinConfirmar && <Tag tone="amber">sin confirmar</Tag>}
                  </td>
                  <td className="px-3 py-2">
                    <Cliente s={s} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[13px]">{s.serial || <Vacio />}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{s.modelo || <Vacio />}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <TipoSelect s={s} tipos={tipos} guardando={guardando === s.numero} bloqueado={guardando !== null || cargando} onCambio={cambiarTipo} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                    {s.estado} <RolTag s={s} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtFecha(s.ingreso)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    <FechaLimite s={s} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <PlazoBadge s={s} />
                  </td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                    {servicios.length === 0 ? 'No hay ningún servicio abierto en Zoho Desk.' : 'Ningún servicio cumple los filtros.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <Barras servicios={lista} hoy={datos.hoy} festivos={datos.festivos} />
      )}
    </div>
  );
}

const Vacio = () => <span className="text-gray-300">—</span>;

/**
 * La marca del rol del estado de Desk de un servicio: «standby» (reloj en
 * pausa; el `title` dice cuántos días hábiles lleva y desde cuándo se mide) o
 * «terminado» (reloj parado; el `title` dice cuándo y con qué veredicto). Un
 * estado que cuenta no lleva marca. Neutra a propósito: no es una alarma; el
 * color del plazo ya lo da su etiqueta.
 */
function RolTag({ s }: { s: ServicioVista }) {
  if (s.rolEstado === 'cuenta') return null;
  return (
    <span title={s.rolEstado === 'standby' ? tituloStandby(s) : tituloTerminado(s)} className="shrink-0">
      <Tag>{s.rolEstado}</Tag>
    </span>
  );
}

/** La cuenta de Desk; si no viene, el asunto del ticket en gris (no es un nombre de cliente fiable). */
function Cliente({ s }: { s: ServicioVista }) {
  if (!s.cliente) return <Vacio />;
  return s.clienteDeAsunto ? (
    <span className="italic text-gray-500" title="Desk no envía la cuenta de este ticket: se muestra su asunto">
      {s.cliente}
    </span>
  ) : (
    <span className="text-gray-900">{s.cliente}</span>
  );
}

/**
 * El tipo de servicio del ticket, elegible a mano. La primera opción es «no hay
 * nada puesto a mano» (vale lo que diga Desk); las demás, los tipos de
 * Configuración. Cambiarlo guarda al momento. Los puestos a mano llevan la
 * marca «manual», y el `title` dice quién y cuándo.
 */
function TipoSelect({
  s,
  tipos,
  guardando,
  bloqueado,
  onCambio,
}: {
  s: ServicioVista;
  tipos: readonly TipoServicioOpcion[];
  guardando: boolean;
  bloqueado: boolean;
  onCambio: (s: ServicioVista, clave: string, etiqueta: string) => void | Promise<void>;
}) {
  const { valor, opciones } = selectorTipo(s, tipos);
  const sinTipo = !s.tipoServicio;
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={valor}
        disabled={bloqueado}
        aria-busy={guardando}
        aria-label={`Tipo de servicio del ticket ${s.numero}`}
        title={notaTipo(s)}
        // La fila no tiene acción propia hoy; si la gana, usar el desplegable no debe dispararla.
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const clave = e.target.value;
          if (clave === valor) return;
          void onCambio(s, clave, tipos.find((t) => t.clave === clave)?.etiqueta ?? '');
        }}
        className={`min-h-[36px] w-[230px] rounded-xl border bg-white px-2 py-1 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60 ${
          sinTipo ? 'border-dashed border-gray-300 text-gray-500' : 'border-gray-300 text-gray-900'
        }`}
      >
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
      {guardando ? (
        <span className="text-[11px] text-gray-500" role="status">
          guardando…
        </span>
      ) : (
        s.tipoManual && (
          <span title={notaTipo(s)}>
            <Tag tone="blue">manual</Tag>
          </span>
        )
      )}
    </span>
  );
}

/**
 * La fecha límite, ya corrida por los días en pausa. Lleva en el `title` lo
 * que haya que explicar —en un tipo compuesto, hasta cuándo va cada tramo; con
 * pausas, cuál sería la fecha sin ellas y cuántos días son— y un subrayado
 * punteado que avisa de que hay algo que leer.
 */
function FechaLimite({ s }: { s: ServicioVista }) {
  const titulo = tituloFechaLimite(s);
  if (!titulo) return <>{fmtFecha(s.fechaLimite)}</>;
  return (
    <span title={titulo} className="cursor-help underline decoration-gray-300 decoration-dotted underline-offset-4">
      {fmtFecha(s.fechaLimite)}
    </span>
  );
}

function PlazoBadge({ s }: { s: ServicioVista }) {
  const t = TONO_PLAZO[s.estadoPlazo];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${t.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden />
      {textoPlazo(s)}
    </span>
  );
}

/** Ancho de un día y de la columna de etiquetas, y alto de una fila y de la cabecera, en píxeles. */
const COL = 26;
const ETIQ = 230;
const FILA = 36;
const CABECERA = 44;
/** El atraso: mismo rojo, más claro y rayado, para que se distinga del plazo ya consumido. */
const RAYADO = 'repeating-linear-gradient(135deg, #fecaca 0 5px, #fee2e2 5px 10px)';
/** Muestra de la leyenda para la barra de un tipo compuesto: tono lleno, raya blanca y el mismo tono aclarado. */
const DOS_TRAMOS = 'linear-gradient(90deg, #10b981 0 45%, #ffffff 45% 55%, #70d4b3 55% 100%)';
/** Los días en pausa: rayado gris, fino y en el otro sentido que el del atraso, para que no se confundan. Deja ver el color de la barra. */
const PAUSA = 'repeating-linear-gradient(45deg, rgba(51, 65, 85, 0.6) 0 2px, rgba(255, 255, 255, 0.7) 2px 6px)';
const LEYENDA_TERMINADO: Partial<Record<EstadoPlazo, string>> = {
  CUMPLIDO: 'Terminado: cumplido',
  INCUMPLIDO: 'Terminado: incumplido',
  TERMINADO: 'Terminado: sin medir',
};

/**
 * Calendario de barras: una fila por servicio y una columna por día. La barra
 * va del ingreso a la fecha límite (ya corrida por las pausas); si está
 * vencido, sigue rayada en rojo hasta hoy. Los días en pausa van encima, como
 * una banda rayada gris (`pausasBarra`). Con el trabajo terminado la barra
 * acaba el día en que se terminó, con una marca oscura, y no sigue: su tono
 * (más claro) es el del veredicto.
 * En un tipo compuesto («Diagnóstico + Calibración») la barra va partida en
 * sus tramos (`segmentosBarra`); el color sigue siendo el de la fecha final.
 * Sin librerías: cajas con posición absoluta sobre un ancho fijo por día, y
 * desplazamiento horizontal cuando no cabe.
 */
function Barras({ servicios, hoy, festivos }: { servicios: ServicioVista[]; hoy: string; festivos: string[] }) {
  const eje = useMemo(() => ejeServicios(servicios, hoy), [servicios, hoy]);
  const dias = useMemo(() => diasDelEje(eje, festivos), [eje, festivos]);
  const meses = useMemo(() => mesesDelEje(eje), [eje]);
  const ley = useMemo(() => leyendaServicios(servicios), [servicios]);
  const colHoy = columna(eje, hoy);
  const ancho = eje.dias * COL;
  const caja = useRef<HTMLDivElement>(null);

  // Al abrir (o al cambiar el tramo), deja «hoy» a la vista sin tener que buscarlo.
  useEffect(() => {
    if (caja.current) caja.current.scrollLeft = Math.max(0, colHoy * COL - 160);
  }, [colHoy, eje.inicio]);

  if (servicios.length === 0) {
    return <p className="rounded-2xl border border-gray-200 bg-white px-3 py-8 text-center text-sm text-gray-500 shadow-sm">Ningún servicio que pintar.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600" aria-label="Leyenda">
        <Leyenda className={TONO_PLAZO.EN_PLAZO.barra}>En plazo</Leyenda>
        <Leyenda className={TONO_PLAZO.VENCE_HOY.barra}>Vence hoy</Leyenda>
        <Leyenda className={TONO_PLAZO.VENCIDO.barra}>Vencido</Leyenda>
        <Leyenda className="border border-red-300" style={{ backgroundImage: RAYADO }}>
          Atraso hasta hoy
        </Leyenda>
        {ley.dosTramos && (
          <Leyenda className="" style={{ backgroundImage: DOS_TRAMOS }}>
            Diagnóstico + Calibración: dos tramos
          </Leyenda>
        )}
        {ley.pausas && (
          <Leyenda className="border border-slate-300 bg-emerald-500" style={{ backgroundImage: PAUSA }}>
            En pausa: no cuenta para el plazo
          </Leyenda>
        )}
        {ley.terminados.map((e) => (
          <Leyenda key={e} className={TONO_PLAZO[e].barra}>
            {LEYENDA_TERMINADO[e] ?? ''}
          </Leyenda>
        ))}
        {ley.terminados.length > 0 && (
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-1 rounded-sm bg-slate-700" aria-hidden /> Día en que se terminó
          </li>
        )}
        <Leyenda className="border border-gray-200 bg-gray-100">Fin de semana o festivo</Leyenda>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-blue-500" aria-hidden /> Hoy
        </li>
      </ul>

      <div ref={caja} className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="relative" style={{ width: ETIQ + ancho }}>
          {/* Fondo: días no hábiles, de arriba abajo */}
          <div className="pointer-events-none absolute inset-y-0" style={{ left: ETIQ, width: ancho }} aria-hidden>
            {dias.map((d, i) => (d.habil ? null : <div key={d.fecha} className="absolute inset-y-0 bg-gray-100" style={{ left: i * COL, width: COL }} />))}
          </div>

          {/* Cabecera: meses y días */}
          <div className="flex border-b border-gray-200 text-[11px] text-gray-500">
            <div className="z-10 flex shrink-0 items-end border-r border-gray-200 bg-gray-50 px-3 pb-1.5 font-semibold uppercase tracking-wide sm:sticky sm:left-0" style={{ width: ETIQ }}>
              Ticket · cliente
            </div>
            <div className="relative shrink-0" style={{ width: ancho, height: CABECERA }}>
              {meses.map((m) => (
                <div
                  key={m.etiqueta}
                  className="absolute top-0 truncate border-l border-gray-200 px-1.5 pt-1 font-semibold capitalize text-gray-700"
                  style={{ left: m.desde * COL, width: (m.hasta - m.desde + 1) * COL }}
                >
                  {m.etiqueta}
                </div>
              ))}
              {dias.map((d, i) => (
                <div
                  key={d.fecha}
                  className={`absolute bottom-1 text-center tabular-nums ${d.fecha === hoy ? 'rounded bg-blue-600 font-semibold text-white' : d.habil ? '' : 'text-gray-400'}`}
                  style={{ left: i * COL + 2, width: COL - 4 }}
                >
                  {d.dia}
                </div>
              ))}
            </div>
          </div>

          {servicios.map((s) => {
            const b = barraServicio(s, eje, hoy);
            const t = TONO_PLAZO[s.estadoPlazo];
            const fin = b ? (b.atraso ?? b.plazo)?.hasta ?? 0 : 0;
            const tramos = textoTramos(s);
            const enPausa = s.diasPausados > 0 ? ` · ${s.diasPausados} d háb. en pausa` : '';
            const terminado = s.terminadoEl ? ` · trabajo terminado el ${fmtFecha(s.terminadoEl)}` : '';
            const detalle = `Ticket ${s.numero} · ${s.tipoServicio || 'sin tipo'} · ingreso ${fmtFecha(s.ingreso)} · límite ${fmtFecha(s.fechaLimite)}${tramos ? ` (${tramos})` : ''}${enPausa}${terminado} · ${textoPlazo(s)}`;
            // Bordes de la barra del plazo en píxeles: los tramos de un tipo compuesto se pintan dentro de ella.
            const izq = b?.plazo ? b.plazo.desde * COL + (b.recortada ? 0 : 2) : 0;
            const der = b?.plazo ? (b.plazo.hasta + 1) * COL - (b.atraso ? 0 : 2) : 0;
            const segmentos = b?.plazo ? (segmentosBarra(s, eje) ?? []) : [];
            const pausas = b ? pausasBarra(s, eje, hoy) : [];
            return (
              <div key={s.numero} className="flex border-b border-gray-100 last:border-b-0" style={{ height: FILA }}>
                <div className="z-10 flex shrink-0 items-center gap-2 border-r border-gray-200 bg-white px-3 text-xs sm:sticky sm:left-0" style={{ width: ETIQ }} title={s.asunto || undefined}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${s.sinConfirmar ? 'bg-amber-400' : t.dot}`} title={s.sinConfirmar ? 'Sin confirmar: Desk lleva más de un día sin refrescarlo' : undefined} />
                  <span className="shrink-0 font-mono font-semibold text-gray-900">{s.numero}</span>
                  <span className={`truncate ${s.clienteDeAsunto ? 'italic text-gray-500' : 'text-gray-700'}`}>{s.cliente || s.serial || '—'}</span>
                  <RolTag s={s} />
                </div>
                <div className="relative flex shrink-0 items-center" style={{ width: ancho }} title={detalle}>
                  {!b && <span className="ml-2 text-[11px] text-gray-400 sm:sticky sm:left-[238px]">sin plazo</span>}
                  {b?.plazo && (
                    <div
                      className={`absolute top-2 h-5 overflow-hidden ${t.barra} ${b.recortada ? '' : 'rounded-l-md'} ${b.atraso ? '' : 'rounded-r-md'}`}
                      style={{ left: izq, width: der - izq }}
                    >
                      {/* Tipo compuesto: un tramo por parte. El color (estado) es el de la fecha límite final; el segundo
                          tramo va aclarado y con una raya blanca delante, y cada uno dice en su `title` cuándo acaba. */}
                      {segmentos.map((seg, i) => {
                        if (!seg.tramo) return null;
                        const desde = Math.max(seg.tramo.desde * COL, izq);
                        const hasta = Math.min((seg.tramo.hasta + 1) * COL, der);
                        return (
                          <div
                            key={seg.etiqueta}
                            title={tituloSegmento(seg)}
                            // La raya sólo separa dos tramos visibles: si el anterior quedó fuera del eje, no hay qué separar.
                            className={`absolute inset-y-0 ${i > 0 ? 'bg-white/30' : ''} ${i > 0 && segmentos[i - 1].tramo ? 'border-l-2 border-white' : ''}`}
                            style={{ left: desde - izq, width: hasta - desde }}
                          />
                        );
                      })}
                    </div>
                  )}
                  {b?.atraso && (
                    <div
                      className={`absolute top-2 h-5 rounded-r-md border border-red-300 ${b.plazo ? 'border-l-0' : ''}`}
                      style={{ left: b.atraso.desde * COL, width: (b.atraso.hasta - b.atraso.desde + 1) * COL - 2, backgroundImage: RAYADO }}
                    />
                  )}
                  {/* Días en pausa: banda rayada gris sobre la barra, del mismo alto. No cuentan para el plazo. */}
                  {pausas.map((p) => (
                    <div
                      key={p.desde}
                      title="En pausa: estos días hábiles no cuentan para el plazo"
                      className="absolute top-2 h-5 border-x border-slate-400/70"
                      style={{ left: p.desde * COL, width: (p.hasta - p.desde + 1) * COL, backgroundImage: PAUSA }}
                    />
                  ))}
                  {/* Trabajo terminado: la barra acaba aquí. La marca dice el día; el veredicto lo da el tono de la barra. */}
                  {b && b.terminado !== null && (
                    <div
                      title={`Trabajo terminado el ${fmtFecha(s.terminadoEl)}`}
                      className="absolute top-1 h-7 w-1 rounded-sm bg-slate-700"
                      style={{ left: (b.terminado + 1) * COL - 4 }}
                    />
                  )}
                  {/* El ingreso es anterior al tramo visible: la barra viene de más atrás. */}
                  {b?.recortada && <ChevronsLeft className={`absolute left-0 top-2.5 h-4 w-4 ${b.plazo ? 'text-white' : 'text-red-500'}`} aria-label={`Ingresó el ${fmtFecha(s.ingreso)}, antes del tramo visible`} />}
                  {b && (
                    <span className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-medium ${t.text}`} style={{ left: (fin + 1) * COL + 4 }}>
                      {textoPlazo(s)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* La línea de hoy, por encima de las barras */}
          <div className="pointer-events-none absolute bottom-0 w-0.5 bg-blue-500" style={{ top: CABECERA + 1, left: ETIQ + colHoy * COL + COL / 2 - 1 }} aria-hidden />
        </div>
      </div>
    </div>
  );
}

function Leyenda({ className, style, children }: { className: string; style?: CSSProperties; children: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={`h-3 w-5 rounded-sm ${className}`} style={style} aria-hidden />
      {children}
    </li>
  );
}
