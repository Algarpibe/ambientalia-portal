import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronsLeft, RefreshCw, Search } from 'lucide-react';
import { api, type Servicios as Datos } from '../api';
import { ESTADOS_PLAZO, ETIQUETA_PLAZO, type EstadoPlazo, type ServicioVista } from '../dominio';
import { TONO_PLAZO, barraServicio, columna, diasDelEje, ejeServicios, mesesDelEje, porUrgenciaPlazo, resumenServicios, textoPlazo } from '../lib/servicios';
import { fmtFecha } from '../lib/vistas';
import { Alert, Button, Loading, Tag } from '../ui';

/**
 * Servicios: todos los tickets de Zoho Desk que no están cerrados, con la
 * fecha límite que les da el plazo de su tipo de servicio (pestaña
 * «Configuración»). Dos vistas de lo mismo: la lista y el calendario de barras.
 * Carga sus propios datos: no dependen del inventario de la F-ST-022.
 */
type Vista = 'lista' | 'calendario';
type Orden = 'plazo' | 'numero' | 'cliente' | 'serial' | 'tipo' | 'estado' | 'ingreso' | 'limite';

interface Props {
  onConfigurar: () => void;
}

export default function Servicios({ onConfigurar }: Props) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [vista, setVista] = useState<Vista>('lista');
  const [estados, setEstados] = useState<EstadoPlazo[]>([]);
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

  const servicios = useMemo(() => datos?.servicios ?? [], [datos]);
  const res = useMemo(() => resumenServicios(servicios), [servicios]);
  const cnt = useMemo(() => {
    const c: Record<EstadoPlazo, number> = { VENCIDO: 0, VENCE_HOY: 0, EN_PLAZO: 0, SIN_PLAZO: 0 };
    for (const s of servicios) c[s.estadoPlazo]++;
    return c;
  }, [servicios]);

  const q = texto.trim().toLowerCase();
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
    return servicios
      .filter(
        (s) =>
          (estados.length === 0 || estados.includes(s.estadoPlazo)) &&
          (!q || String(s.numero).includes(q) || s.cliente.toLowerCase().includes(q) || s.serial.toLowerCase().includes(q)),
      )
      .sort((a, b) => {
        if (orden.k === 'plazo') return porUrgenciaPlazo(a, b) * orden.dir;
        const x = val(a);
        const y = val(b);
        return (x < y ? -1 : x > y ? 1 : 0) * orden.dir || porUrgenciaPlazo(a, b);
      });
  }, [servicios, estados, q, orden]);

  if (!datos) return error ? <Alert tone="red">{error}</Alert> : <Loading texto="Cargando los servicios abiertos en Zoho Desk…" />;

  const toggleEstado = (e: EstadoPlazo) => setEstados((x) => (x.includes(e) ? x.filter((y) => y !== e) : [...x, e]));

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

      {/* Hoy Desk no manda el tipo de servicio: se dice claro en vez de enseñar un calendario vacío sin explicación. */}
      {res.total > 0 && res.sinTipo > 0 && (
        <Alert tone="blue" title={res.sinTipo === res.total ? 'Todavía no hay plazos que pintar' : `${res.sinTipo} de ${res.total} servicios llegan sin tipo de servicio`}>
          <p>
            {res.sinTipo === res.total ? 'Zoho Desk aún no envía el tipo de servicio de los tickets' : 'Zoho Desk no envía su tipo de servicio'}, así que no se
            les puede calcular fecha límite y salen «sin plazo». Las barras aparecerán solas en cuanto Desk lo traiga; no hay que hacer nada aquí.
          </p>
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
        {ESTADOS_PLAZO.map((e) => (
          <button
            key={e}
            type="button"
            aria-pressed={estados.includes(e)}
            onClick={() => toggleEstado(e)}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
              estados.includes(e) ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${TONO_PLAZO[e].dot}`} aria-hidden />
            {ETIQUETA_PLAZO[e]}
            <span className="tabular-nums opacity-60">{cnt[e]}</span>
          </button>
        ))}
        {(estados.length > 0 || q) && (
          <button
            type="button"
            onClick={() => {
              setEstados([]);
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
          <table className="w-full min-w-[1040px] text-sm">
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
                  <td className="whitespace-nowrap px-3 py-2">{s.tipoServicio || <span className="text-gray-400">sin tipo</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{s.estado}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtFecha(s.ingreso)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtFecha(s.fechaLimite)}</td>
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

/**
 * Calendario de barras: una fila por servicio y una columna por día. La barra
 * va del ingreso a la fecha límite; si está vencido, sigue rayada hasta hoy.
 * Sin librerías: cajas con posición absoluta sobre un ancho fijo por día, y
 * desplazamiento horizontal cuando no cabe.
 */
function Barras({ servicios, hoy, festivos }: { servicios: ServicioVista[]; hoy: string; festivos: string[] }) {
  const eje = useMemo(() => ejeServicios(servicios, hoy), [servicios, hoy]);
  const dias = useMemo(() => diasDelEje(eje, festivos), [eje, festivos]);
  const meses = useMemo(() => mesesDelEje(eje), [eje]);
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
            const detalle = `Ticket ${s.numero} · ${s.tipoServicio || 'sin tipo'} · ingreso ${fmtFecha(s.ingreso)} · límite ${fmtFecha(s.fechaLimite)} · ${textoPlazo(s)}`;
            return (
              <div key={s.numero} className="flex border-b border-gray-100 last:border-b-0" style={{ height: FILA }}>
                <div className="z-10 flex shrink-0 items-center gap-2 border-r border-gray-200 bg-white px-3 text-xs sm:sticky sm:left-0" style={{ width: ETIQ }} title={s.asunto || undefined}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${s.sinConfirmar ? 'bg-amber-400' : t.dot}`} title={s.sinConfirmar ? 'Sin confirmar: Desk lleva más de un día sin refrescarlo' : undefined} />
                  <span className="shrink-0 font-mono font-semibold text-gray-900">{s.numero}</span>
                  <span className={`truncate ${s.clienteDeAsunto ? 'italic text-gray-500' : 'text-gray-700'}`}>{s.cliente || s.serial || '—'}</span>
                </div>
                <div className="relative flex shrink-0 items-center" style={{ width: ancho }} title={detalle}>
                  {!b && <span className="ml-2 text-[11px] text-gray-400 sm:sticky sm:left-[238px]">sin plazo</span>}
                  {b?.plazo && (
                    <div
                      className={`absolute top-2 h-5 ${t.barra} ${b.recortada ? '' : 'rounded-l-md'} ${b.atraso ? '' : 'rounded-r-md'}`}
                      style={{ left: b.plazo.desde * COL + (b.recortada ? 0 : 2), width: (b.plazo.hasta - b.plazo.desde + 1) * COL - (b.recortada ? 0 : 2) - (b.atraso ? 0 : 2) }}
                    />
                  )}
                  {b?.atraso && (
                    <div
                      className={`absolute top-2 h-5 rounded-r-md border border-red-300 ${b.plazo ? 'border-l-0' : ''}`}
                      style={{ left: b.atraso.desde * COL, width: (b.atraso.hasta - b.atraso.desde + 1) * COL - 2, backgroundImage: RAYADO }}
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
