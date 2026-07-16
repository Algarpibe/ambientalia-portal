import { useState, useMemo } from 'react';
import type { ChangeEvent } from 'react';
import {
  FileSpreadsheet,
  Search,
  Download,
  AlertTriangle,
  ChevronRight,
  Loader2,
  Inbox,
  XCircle,
  Clock,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;
// Auth: JWT emitido por hub-api /api/login (guardado por el portal en localStorage).
const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// ---------------------------------------------------------------------------
// Tipos (espejo de apps/hub-api/src/wo-sales/types.ts)
// ---------------------------------------------------------------------------

type WarningTipo =
  | 'sin_centro_costos'
  | 'centro_costos_invalido'
  | 'varios_centros_costos'
  | 'sin_fecha_entrega'
  | 'sin_nit'
  | 'sin_sku'
  | 'sin_empresa'
  | 'moneda_no_cop'
  | 'descuento_cabecera_ignorado'
  | 'ov_parcialmente_facturada'
  | 'forma_pago_desconocida'
  | 'ov_antigua'
  | 'ov_sin_lineas'
  | 'valor_no_numerico'
  | 'valor_saneado';

interface Warning {
  tipo: WarningTipo;
  orden: string;
  sku?: string;
  mensaje: string;
}

interface SalesOrderLine {
  sku: string | null;
  descripcion: string | null;
  cantidad: number;
  valorUnitario: number;
  descuento: number;
  centroCostos: string | null;
  centrosCostosCount: number;
}

interface SalesOrder {
  numero: string;
  fecha: string;
  clienteNombre: string | null;
  nit: string | null;
  formaPagoZoho: string | null;
  fechaEntrega: string | null;
  moneda: string | null;
  lineas: SalesOrderLine[];
}

interface PreviewResponse {
  filtro: { desde: string; hasta: string; cliente?: string };
  ordenes: SalesOrder[];
  warnings: Warning[];
  filas: number;
}

// ---------------------------------------------------------------------------
// Textos de las advertencias
//
// Xiomara y Marcela no leen `sin_centro_costos`. Cada tipo lleva su título en
// castellano y la unidad que cuenta: los avisos de línea se cuentan en líneas
// (una OV puede aportar veinte) y los de cabecera, en órdenes. Decir "47 líneas"
// cuando son 3 órdenes, o al revés, da una idea falsa del tamaño del problema.
// ---------------------------------------------------------------------------

const WARNING_META: Record<WarningTipo, { titulo: string; unidad: 'linea' | 'orden' }> = {
  sin_centro_costos: { titulo: 'Sin centro de costos', unidad: 'linea' },
  centro_costos_invalido: { titulo: 'Centro de costos no reconocido', unidad: 'linea' },
  varios_centros_costos: { titulo: 'El artículo tiene varios centros de costos', unidad: 'linea' },
  sin_sku: { titulo: 'Línea sin código de artículo', unidad: 'linea' },
  valor_no_numerico: { titulo: 'Valor que no es un número', unidad: 'linea' },
  valor_saneado: { titulo: 'Valor corregido automáticamente', unidad: 'linea' },
  sin_fecha_entrega: { titulo: 'Sin fecha de entrega', unidad: 'orden' },
  sin_nit: { titulo: 'Cliente sin NIT', unidad: 'orden' },
  sin_empresa: { titulo: 'Sin empresa asignada', unidad: 'orden' },
  moneda_no_cop: { titulo: 'Moneda distinta de pesos', unidad: 'orden' },
  descuento_cabecera_ignorado: { titulo: 'Descuento de la OV que no llega al archivo', unidad: 'orden' },
  ov_parcialmente_facturada: { titulo: 'OV parcialmente facturada (solo va lo pendiente)', unidad: 'orden' },
  forma_pago_desconocida: { titulo: 'Forma de pago desconocida', unidad: 'orden' },
  ov_sin_lineas: { titulo: 'Orden sin líneas de producto', unidad: 'orden' },
  ov_antigua: { titulo: 'Orden antigua que sigue abierta', unidad: 'orden' },
};

const metaDe = (tipo: WarningTipo) =>
  WARNING_META[tipo] ?? { titulo: tipo, unidad: 'linea' as const };

function contar(n: number, unidad: 'linea' | 'orden'): string {
  if (unidad === 'orden') return n === 1 ? '1 orden' : `${n} órdenes`;
  return n === 1 ? '1 línea' : `${n} líneas`;
}

// ---------------------------------------------------------------------------
// Errores del hub, en cristiano
// ---------------------------------------------------------------------------

const CAMPO_FECHA: Record<string, string> = { from: 'Desde', to: 'Hasta' };

/** Traduce la respuesta de error a algo accionable. Un "Error 403" no le dice a
 *  nadie qué hacer; "no tienes esta app asignada, pídesela a un administrador",
 *  sí. */
async function mensajeDeError(res: Response): Promise<string> {
  if (res.status === 401) {
    return 'Tu sesión ha caducado. Vuelve a entrar en el portal e inténtalo de nuevo.';
  }
  if (res.status === 403) {
    return 'No tienes esta aplicación asignada. Pide acceso a un administrador del portal.';
  }
  if (res.status === 400) {
    let cuerpo: { error?: string; field?: string } = {};
    try {
      cuerpo = await res.json();
    } catch {
      /* respuesta sin JSON: caemos al texto genérico de abajo */
    }
    const campo = CAMPO_FECHA[cuerpo.field ?? ''] ?? 'la fecha';
    if (cuerpo.error === 'invalid_date') {
      return `La fecha "${campo}" no es válida. Revísala e inténtalo de nuevo.`;
    }
    if (cuerpo.error === 'invalid_range') {
      return 'El rango de fechas está al revés: "Desde" es posterior a "Hasta".';
    }
    return 'Los filtros no son válidos. Revisa las fechas e inténtalo de nuevo.';
  }
  return `No se ha podido conectar con el servidor (error ${res.status}). Inténtalo de nuevo en un momento.`;
}

// ---------------------------------------------------------------------------

const anioActual = new Date().getFullYear();

/** Saca el nombre del archivo de Content-Disposition. La cabecera está expuesta
 *  por CORS en hub-api; si aun así no llega, usamos uno por defecto. */
function nombreDesdeCabecera(cd: string | null): string | null {
  if (!cd) return null;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  return m ? decodeURIComponent(m[1]) : null;
}

function App() {
  const [desde, setDesde] = useState(`${anioActual}-01-01`);
  const [hasta, setHasta] = useState(`${anioActual}-12-31`);
  const [cliente, setCliente] = useState('');

  const [data, setData] = useState<PreviewResponse | null>(null);
  const [cargando, setCargando] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [desajuste, setDesajuste] = useState<{ revisados: number; archivo: number } | null>(null);

  // Al cambiar un filtro se descarta la vista previa: el CSV se construye con el
  // estado vivo de los inputs, así que dejar en pantalla el resumen del rango
  // anterior permitiría descargar un archivo cuyas advertencias nadie ha visto.
  // Las advertencias son el único cortafuegos antes de que el pedido entre al ERP.
  const cambiarFiltro =
    (set: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
      set(e.target.value);
      setData(null);
      setDesajuste(null);
    };

  const queryString = () => {
    const p = new URLSearchParams({ from: desde, to: hasta });
    if (cliente.trim()) p.set('cliente', cliente.trim());
    return p.toString();
  };

  const verOrdenes = async () => {
    setCargando(true);
    setError(null);
    setData(null);
    setDesajuste(null);
    setAbiertos({});
    try {
      if (!API_BASE) throw new Error('Configuración incompleta: falta VITE_HUB_API_URL');
      const res = await fetch(`${API_BASE}/api/wo-sales/preview?${queryString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await mensajeDeError(res));
      setData((await res.json()) as PreviewResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ha ocurrido un error inesperado.');
    } finally {
      setCargando(false);
    }
  };

  const descargarCsv = async () => {
    setDescargando(true);
    setError(null);
    setDesajuste(null);
    try {
      if (!API_BASE) throw new Error('Configuración incompleta: falta VITE_HUB_API_URL');
      const res = await fetch(`${API_BASE}/api/wo-sales/csv?${queryString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await mensajeDeError(res));

      // Segunda red: el archivo se genera en una consulta aparte de la vista previa,
      // así que puede no ser el que se revisó (una OV nueva sincronizada entretanto,
      // por ejemplo). X-WO-Sales-Warnings cuenta SOLO los avisos del builder, que son
      // los del archivo — sin los `ov_antigua` —, así que se compara contra
      // avisosArchivo y no contra el total de /preview. Si el header no llega, no se
      // puede concluir nada y no se inventa una alarma.
      // OJO: Number(null) es 0, no NaN. Sin este chequeo explícito, un header ausente
      // se leería como "0 avisos" y dispararía una falsa alarma en cada descarga.
      const cabecera = res.headers.get('X-WO-Sales-Warnings');
      const enArchivo = cabecera === null ? null : Number(cabecera);
      if (enArchivo !== null && Number.isFinite(enArchivo) && enArchivo !== avisosArchivo) {
        // Se corta ANTES de guardar el archivo, no después. Si ya está en Descargas,
        // "no lo subas" es solo una petición: el archivo existe y alguien lo subirá.
        // Sabemos que no es el que se revisó, así que no se entrega.
        setDesajuste({ revisados: avisosArchivo, archivo: enArchivo });
        return;
      }

      const blob = await res.blob();
      const nombre =
        nombreDesdeCabecera(res.headers.get('Content-Disposition')) ??
        'DocumentosVentasEncabezadosMovimientoInventarioWO.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido descargar el archivo.');
    } finally {
      setDescargando(false);
    }
  };

  // Los avisos se agrupan por tipo y se ordenan por volumen. Hoy el sync no baja el
  // centro de costos de Zoho, así que TODAS las líneas emiten `sin_centro_costos`:
  // listados en crudo serían cientos de avisos idénticos, el operador dejaría de
  // leerlos y el cortafuegos se perdería. Agrupado son una fila con su contador.
  const grupos = useMemo(() => {
    const mapa = new Map<WarningTipo, Warning[]>();
    for (const w of data?.warnings ?? []) {
      const lista = mapa.get(w.tipo);
      if (lista) lista.push(w);
      else mapa.set(w.tipo, [w]);
    }
    return [...mapa.entries()]
      .map(([tipo, avisos]) => ({ tipo, avisos }))
      .sort((a, b) => b.avisos.length - a.avisos.length);
  }, [data]);

  // `ov_antigua` no es un aviso del archivo: son OV vivas anteriores al rango, que
  // hub-api lista aparte y que NO van al CSV. Mezclarlas con el resto haría pensar
  // que el archivo tiene defectos que no tiene (y el contador no cuadraría con la
  // cabecera X-WO-Sales-Warnings, que solo cuenta los del archivo).
  const gruposArchivo = grupos.filter((g) => g.tipo !== 'ov_antigua');
  const grupoAntiguas = grupos.find((g) => g.tipo === 'ov_antigua');
  const avisosArchivo = gruposArchivo.reduce((n, g) => n + g.avisos.length, 0);

  const sinDatos = data !== null && data.ordenes.length === 0;
  const puedeDescargar = data !== null && data.filas > 0 && !descargando;

  return (
    <main className="flex-grow bg-transparent p-6 overflow-y-auto">
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 bg-gradient-to-br from-emerald-400 to-teal-600 rounded-2xl flex items-center justify-center shadow-soft">
            <FileSpreadsheet className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-gray-900">Pedidos para World Office</h1>
            <p className="text-gray-500 mt-1">
              Genera el archivo de pedidos a partir de las órdenes de venta de Zoho.
            </p>
          </div>
        </div>
      </header>

      {/* Filtros */}
      <section className="bg-white rounded-3xl border border-gray-200 shadow-soft p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label htmlFor="wo-desde" className="block text-sm font-medium text-gray-700 mb-1.5">
              Desde
            </label>
            <input
              id="wo-desde"
              type="date"
              value={desde}
              onChange={cambiarFiltro(setDesde)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
            />
          </div>
          <div>
            <label htmlFor="wo-hasta" className="block text-sm font-medium text-gray-700 mb-1.5">
              Hasta
            </label>
            <input
              id="wo-hasta"
              type="date"
              value={hasta}
              onChange={cambiarFiltro(setHasta)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
            />
          </div>
          <div>
            <label htmlFor="wo-cliente" className="block text-sm font-medium text-gray-700 mb-1.5">
              Cliente <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input
              id="wo-cliente"
              type="text"
              value={cliente}
              onChange={cambiarFiltro(setCliente)}
              placeholder="Nombre del cliente"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
            />
          </div>
          <button
            onClick={verOrdenes}
            disabled={cargando}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {cargando ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            {cargando ? 'Buscando…' : 'Ver órdenes'}
          </button>
        </div>
      </section>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6 flex items-start gap-3"
        >
          <XCircle className="text-red-500 shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-semibold text-red-900 text-sm">No se ha podido completar la operación</p>
            <p className="text-red-800 text-sm mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* La descarga se cancelo: el archivo no coincidia con lo revisado en pantalla */}
      {desajuste && (
        <div
          role="alert"
          className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 mb-6 flex items-start gap-3"
        >
          <AlertTriangle className="text-red-600 shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-semibold text-red-900 text-sm">
              Descarga cancelada: el archivo no es el que has revisado
            </p>
            <p className="text-red-800 text-sm mt-0.5">
              En pantalla revisaste {desajuste.revisados}{' '}
              {desajuste.revisados === 1 ? 'advertencia' : 'advertencias'}, pero el archivo traía{' '}
              {desajuste.archivo}. Las órdenes han debido cambiar mientras lo generabas, así que no
              se ha descargado nada. Vuelve a pulsar «Ver órdenes», revisa las advertencias y
              descárgalo otra vez.
            </p>
          </div>
        </div>
      )}

      {/* Cargando */}
      {cargando && (
        <div className="bg-white rounded-3xl border border-gray-200 shadow-soft p-12 text-center">
          <Loader2 className="mx-auto text-blue-500 animate-spin mb-3" size={28} />
          <p className="text-gray-600 text-sm">Consultando las órdenes de venta…</p>
        </div>
      )}

      {/* Vacío */}
      {!cargando && sinDatos && (
        <div className="bg-white rounded-3xl border border-gray-200 shadow-soft p-12 text-center">
          <Inbox className="mx-auto text-gray-300 mb-3" size={36} />
          <p className="text-gray-700 font-semibold mb-1">No hay órdenes en ese rango</p>
          <p className="text-gray-500 text-sm">
            Prueba a ampliar las fechas o a quitar el filtro de cliente.
          </p>
        </div>
      )}

      {!cargando && data && data.ordenes.length > 0 && (
        <>
          {/* Resumen + descarga */}
          <section className="bg-white rounded-3xl border border-gray-200 shadow-soft p-6 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-8">
                <div>
                  <p className="text-sm font-medium text-gray-600">Órdenes</p>
                  <p className="text-3xl font-bold text-gray-900">{data.ordenes.length}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Líneas en el archivo</p>
                  <p className="text-3xl font-bold text-gray-900">{data.filas}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Advertencias</p>
                  <p
                    className={`text-3xl font-bold ${avisosArchivo > 0 ? 'text-amber-600' : 'text-gray-900'}`}
                  >
                    {avisosArchivo}
                  </p>
                </div>
              </div>
              <button
                onClick={descargarCsv}
                disabled={!puedeDescargar}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-soft hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {descargando ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                {descargando ? 'Generando…' : 'Generar y descargar CSV'}
              </button>
            </div>
            {data.filas === 0 && (
              <p className="text-sm text-gray-500 mt-4">
                Estas órdenes no tienen líneas de producto, así que el archivo saldría vacío.
              </p>
            )}
          </section>

          {/* Advertencias: el cortafuegos antes de subir el archivo al ERP */}
          {avisosArchivo > 0 && (
            <section className="bg-amber-50 border-2 border-amber-300 rounded-3xl shadow-soft p-6 mb-6">
              <div className="flex items-start gap-3 mb-4">
                <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={24} />
                <div>
                  <h2 className="text-lg font-bold text-amber-900">
                    Revisa {avisosArchivo === 1 ? 'esta advertencia' : `estas ${avisosArchivo} advertencias`} antes de subir el archivo
                  </h2>
                  <p className="text-sm text-amber-800 mt-0.5">
                    El archivo crea pedidos en World Office que reservan inventario y precargan la
                    facturación. Un dato mal cargado bloquea existencias y descuadra la contabilidad.
                  </p>
                </div>
              </div>

              <ul className="space-y-2">
                {gruposArchivo.map(({ tipo, avisos }) => {
                  const meta = metaDe(tipo);
                  const abierto = !!abiertos[tipo];
                  return (
                    <li key={tipo} className="bg-white rounded-2xl border border-amber-200 overflow-hidden">
                      <button
                        onClick={() => setAbiertos((a) => ({ ...a, [tipo]: !a[tipo] }))}
                        aria-expanded={abierto}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-amber-50 transition-colors"
                      >
                        <ChevronRight
                          size={16}
                          className={`text-amber-600 shrink-0 transition-transform ${abierto ? 'rotate-90' : ''}`}
                        />
                        <span className="font-semibold text-gray-900 text-sm flex-grow">
                          {meta.titulo}
                        </span>
                        <span className="text-xs font-semibold text-amber-900 bg-amber-100 rounded-full px-3 py-1 shrink-0">
                          {contar(avisos.length, meta.unidad)}
                        </span>
                      </button>
                      {abierto && (
                        <div className="border-t border-amber-100 max-h-72 overflow-y-auto">
                          <table className="w-full text-sm">
                            <tbody>
                              {avisos.map((w, i) => (
                                <tr key={i} className="border-b border-gray-50 last:border-0">
                                  <td className="px-4 py-2 font-medium text-gray-900 whitespace-nowrap align-top w-px">
                                    {w.orden}
                                  </td>
                                  <td className="px-2 py-2 text-gray-500 whitespace-nowrap align-top w-px">
                                    {w.sku ?? '—'}
                                  </td>
                                  <td className="px-4 py-2 text-gray-600">{w.mensaje}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* OV antiguas: no entran en el archivo, pero alguien tiene que mirarlas */}
          {grupoAntiguas && (
            <section className="bg-white border border-gray-200 rounded-3xl shadow-soft p-6 mb-6">
              <button
                onClick={() => setAbiertos((a) => ({ ...a, ov_antigua: !a.ov_antigua }))}
                aria-expanded={!!abiertos.ov_antigua}
                className="w-full flex items-center gap-3 text-left"
              >
                <ChevronRight
                  size={16}
                  className={`text-gray-400 shrink-0 transition-transform ${abiertos.ov_antigua ? 'rotate-90' : ''}`}
                />
                <Clock className="text-gray-400 shrink-0" size={18} />
                <span className="font-semibold text-gray-900 text-sm flex-grow">
                  Órdenes antiguas que siguen abiertas
                  <span className="block text-xs font-normal text-gray-500 mt-0.5">
                    Son anteriores al rango, así que no entran en este archivo. Conviene revisar si
                    siguen vivas en Zoho.
                  </span>
                </span>
                <span className="text-xs font-semibold text-gray-700 bg-gray-100 rounded-full px-3 py-1 shrink-0">
                  {contar(grupoAntiguas.avisos.length, 'orden')}
                </span>
              </button>
              {abiertos.ov_antigua && (
                <div className="mt-3 border-t border-gray-100 pt-2 max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {grupoAntiguas.avisos.map((w, i) => (
                        <tr key={i} className="border-b border-gray-50 last:border-0">
                          <td className="px-2 py-2 font-medium text-gray-900 whitespace-nowrap align-top w-px">
                            {w.orden}
                          </td>
                          <td className="px-4 py-2 text-gray-600">{w.mensaje}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Vista previa de las OV */}
          <section className="bg-white rounded-3xl border border-gray-200 shadow-soft overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">Órdenes de venta</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Del {data.filtro.desde} al {data.filtro.hasta}
                {data.filtro.cliente ? ` · Cliente: ${data.filtro.cliente}` : ''}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    <th className="px-6 py-3">OV</th>
                    <th className="px-6 py-3">Fecha</th>
                    <th className="px-6 py-3">Cliente</th>
                    <th className="px-6 py-3">NIT</th>
                    <th className="px-6 py-3">Forma de pago</th>
                    <th className="px-6 py-3 text-right">Líneas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ordenes.map((o) => (
                    <tr key={o.numero} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {o.numero}
                      </td>
                      <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{o.fecha}</td>
                      <td className="px-6 py-3 text-gray-900">{o.clienteNombre ?? '—'}</td>
                      <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{o.nit ?? '—'}</td>
                      <td className="px-6 py-3 text-gray-600">{o.formaPagoZoho ?? '—'}</td>
                      <td className="px-6 py-3 text-gray-900 text-right tabular-nums">
                        {o.lineas.length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

export default App;
