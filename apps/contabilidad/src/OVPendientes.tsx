import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, PackageOpen } from 'lucide-react';
import { getUserId } from '@suite/auth-client';
import { fetchOVPendientes, type OVPendienteFacturable } from './api';
import { formatCOP } from './format';
import DetalleModal from './DetalleModal';
import ColumnasMenu from './ColumnasMenu';
import ResizeHandle from './ResizeHandle';
import { compararValores, traeAnticipos, columnasDisponibles, celdaAnticipo } from './ovTabla';
import { useColumnPrefs, clavePrefs } from './useColumnPrefs';

type SortKey = keyof OVPendienteFacturable;

const ESTADO: Record<string, { texto: string; cls: string }> = {
  open: { texto: 'Abierta', cls: 'bg-blue-50 text-blue-700' },
  overdue: { texto: 'Vencida', cls: 'bg-red-50 text-red-700' },
  partially_invoiced: { texto: 'Parcial', cls: 'bg-amber-50 text-amber-700' },
};
const estadoDe = (s: string) => ESTADO[s] ?? { texto: s, cls: 'bg-gray-100 text-gray-600' };

/**
 * Definición ÚNICA de las columnas: de aquí salen la cabecera, las celdas, el orden
 * por defecto, las etiquetas del menú "Columnas" y el ancho inicial.
 *
 * `indicio` (las luces) y `estado` (la etiqueta de color) no son texto plano, por eso
 * llevan su propio `kind`. Se listan como columnas normales para que también se puedan
 * reordenar, ocultar y redimensionar.
 */
interface ColDef {
  key: ColKey;
  label: string;
  align: 'left' | 'right';
  kind: 'text' | 'money' | 'estado' | 'indicio' | 'anticipo';
  ancho: number;
}

// Las de anticipo van AL FINAL a propósito: useColumnPrefs añade las claves nuevas al final
// para quien ya tiene la tabla personalizada, así que en cualquier otra posición un usuario
// nuevo y uno antiguo las verían en sitios distintos.
const CLAVES = [
  'indicio', 'salesorder_number', 'ticket', 'customer_name', 'trato', 'qt', 'date',
  'shipment_date', 'total', 'pending', 'status', 'anticipoCobrado', 'anticipoSinAplicar',
] as const;
export type ColKey = (typeof CLAVES)[number];

const COLUMNAS: ColDef[] = [
  { key: 'indicio', label: 'INDICIO', align: 'left', kind: 'indicio', ancho: 95 },
  { key: 'salesorder_number', label: 'OV', align: 'left', kind: 'text', ancho: 115 },
  { key: 'ticket', label: 'TICKET', align: 'left', kind: 'text', ancho: 80 },
  { key: 'customer_name', label: 'CLIENTE', align: 'left', kind: 'text', ancho: 300 },
  { key: 'trato', label: 'TRATO', align: 'left', kind: 'text', ancho: 240 },
  { key: 'qt', label: 'QT', align: 'left', kind: 'text', ancho: 90 },
  { key: 'date', label: 'FECHA OV', align: 'left', kind: 'text', ancho: 105 },
  { key: 'shipment_date', label: 'ENTREGA', align: 'left', kind: 'text', ancho: 105 },
  { key: 'total', label: 'TOTAL ($)', align: 'right', kind: 'money', ancho: 130 },
  { key: 'pending', label: 'POR FACTURAR ($)', align: 'right', kind: 'money', ancho: 145 },
  { key: 'status', label: 'ESTADO', align: 'left', kind: 'estado', ancho: 100 },
  { key: 'anticipoCobrado', label: 'ANTICIPO COBRADO ($)', align: 'right', kind: 'anticipo', ancho: 160 },
  { key: 'anticipoSinAplicar', label: 'ANTICIPO SIN APLICAR ($)', align: 'right', kind: 'anticipo', ancho: 180 },
];

const ORDEN_POR_DEFECTO: ColKey[] = COLUMNAS.map((c) => c.key);
const ETIQUETAS = Object.fromEntries(COLUMNAS.map((c) => [c.key, c.label])) as Record<ColKey, string>;
const DEF = new Map<ColKey, ColDef>(COLUMNAS.map((c) => [c.key, c]));

// Columnas cuyo orden por defecto al cambiar de criterio es descendente (el importe más
// alto primero), en vez de ascendente/alfabético.
const IMPORTES: SortKey[] = ['pending', 'total', 'anticipoCobrado', 'anticipoSinAplicar'];

const LUZ = 'inline-block h-2.5 w-2.5 rounded-full';

type LuzKey = 'despachada' | 'despachoParcial' | 'soloPaquete' | 'ticketPorFacturar' | 'paquetePorCrear';

// Fuente única de las 5 luces: pinta el indicio de cada fila Y arma los botones de filtro.
// Orden = avance logístico: por crear → empaquetada → parcial → despachada (+ el ticket).
const LUCES: { key: LuzKey; label: string; cls: string; title: string }[] = [
  { key: 'despachada', label: 'Despachada', cls: 'bg-green-500', title: 'Despacho completo (todo enviado)' },
  { key: 'despachoParcial', label: 'Despacho parcial', cls: 'bg-violet-500', title: 'Despacho parcial: salió parte, falta mercancía por enviar' },
  { key: 'soloPaquete', label: 'Sólo paquete', cls: 'bg-amber-400', title: 'Sólo paquete (sin enviar)' },
  { key: 'ticketPorFacturar', label: 'Ticket por facturar', cls: 'bg-red-500', title: 'Ticket por facturar' },
  { key: 'paquetePorCrear', label: 'Paquete por crear', cls: 'bg-blue-500', title: 'Paquete por crear (hay stock disponible)' },
];

function Luces({ o }: { o: OVPendienteFacturable }) {
  return (
    <div className="flex items-center gap-1">
      {LUCES.filter((l) => o[l.key]).map((l) => (
        <span key={l.key} title={l.title} className={`${LUZ} ${l.cls}`} />
      ))}
    </div>
  );
}

export default function OVPendientes({ bare = false }: { bare?: boolean }) {
  const [ordenes, setOrdenes] = useState<OVPendienteFacturable[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState('todos');
  const [filtro, setFiltro] = useState('');
  const [luces, setLuces] = useState<LuzKey[]>([]); // vacío = sin filtro por indicio
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'pending', dir: -1 });
  const [detalleOV, setDetalleOV] = useState<string | null>(null);
  // Ancho en curso mientras se arrastra, para verlo en vivo sin persistir cada píxel.
  const [arrastre, setArrastre] = useState<{ key: ColKey; ancho: number } | null>(null);

  // Configuración de columnas del usuario: la clave lleva su user_id, así dos personas
  // que compartan el mismo navegador no se pisan la vista.
  const cols = useColumnPrefs<ColKey>(clavePrefs('ov-pendientes', getUserId()), ORDEN_POR_DEFECTO);

  useEffect(() => {
    let vivo = true;
    fetchOVPendientes()
      .then((o) => vivo && (setOrdenes(o), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, []);

  // Las columnas de anticipo solo existen si el servidor manda los campos (solo lo hace a
  // quien tiene Contabilidad); para el resto se quitan del orden, del menú y de la tabla.
  const conAnticipos = useMemo(() => traeAnticipos(ordenes), [ordenes]);
  const ordenDisponible = useMemo(() => columnasDisponibles(cols.orden, conAnticipos), [cols.orden, conAnticipos]);

  const visibles = useMemo(
    () => ordenDisponible.map((k) => DEF.get(k)).filter((c): c is ColDef => !!c && cols.esVisible(c.key)),
    [ordenDisponible, cols],
  );

  const anchoActual = (c: ColDef): number =>
    arrastre?.key === c.key ? arrastre.ancho : (cols.anchoDe(c.key) ?? c.ancho);

  const filtradas = useMemo(() => {
    if (!ordenes) return [];
    const q = filtro.trim().toLowerCase();
    const arr = ordenes.filter((o) => {
      // Filtro por luces: OR — basta con que tenga UNA de las seleccionadas.
      if (luces.length && !luces.some((k) => o[k])) return false;
      if (estado !== 'todos' && o.status !== estado) return false;
      if (q && !(o.salesorder_number.toLowerCase().includes(q) || (o.customer_name ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
    arr.sort((a, b) => compararValores(a[sort.key], b[sort.key]) * sort.dir);
    return arr;
  }, [ordenes, estado, filtro, luces, sort]);

  const totales = useMemo(
    () => filtradas.reduce((a, o) => ({ n: a.n + 1, total: a.total + o.total, pending: a.pending + o.pending }), { n: 0, total: 0, pending: 0 }),
    [filtradas],
  );

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: IMPORTES.includes(key) ? -1 : 1 }));

  return (
    <section className={`${bare ? '' : 'mt-10 '}space-y-3`}>
      {!bare && (
        <div className="flex items-center gap-2">
          <PackageOpen className="h-5 w-5 text-amber-600" />
          <h2 className="text-sm font-semibold text-gray-700">OV pendientes de facturar</h2>
        </div>
      )}

      {cargando && (
        <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Cargando OV…</div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {ordenes && !cargando && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <select className="rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="todos">Todos los estados</option>
              <option value="open">Abiertas</option>
              <option value="overdue">Vencidas</option>
              <option value="partially_invoiced">Parciales</option>
            </select>
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar OV o cliente…" className="w-64 rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none" />
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-gray-500">{totales.n} OV</span>
              <span className="text-gray-700">Total: <b className="tabular-nums">{formatCOP(totales.total)}</b></span>
              <span className="text-gray-700">Por facturar: <b className="tabular-nums">{formatCOP(totales.pending)}</b></span>
            </div>
            <div className="ml-auto">
              <ColumnasMenu
                orden={ordenDisponible}
                etiquetas={ETIQUETAS}
                esVisible={cols.esVisible}
                onMover={cols.mover}
                onAlternar={cols.alternar}
                onRestablecer={cols.restablecer}
                personalizado={cols.personalizado}
              />
            </div>
          </div>

          {/* Luces = filtro multiselección. Sin ninguna marcada no filtra; con varias, OR
              (basta con que la OV tenga UNA de ellas). Sustituye al antiguo "Solo facturables":
              marcar las cuatro equivale a "las que tienen algún indicio". */}
          <div className="flex flex-wrap items-center gap-2">
            {LUCES.map((l) => {
              const activa = luces.includes(l.key);
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setLuces((ls) => (ls.includes(l.key) ? ls.filter((x) => x !== l.key) : [...ls, l.key]))}
                  title={l.title}
                  aria-pressed={activa}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    activa
                      ? 'border-gray-400 bg-gray-100 font-semibold text-gray-900'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <span className={`${LUZ} ${l.cls} ${activa ? '' : 'opacity-50'}`} />
                  {l.label}
                </button>
              );
            })}
            {luces.length > 0 && (
              <button type="button" onClick={() => setLuces([])} className="text-xs text-blue-500 hover:underline">
                Limpiar
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-soft">
            {/* table-fixed + colgroup: sin esto el navegador trata el ancho como una simple
                sugerencia y el contenido vuelve a estirar la columna al soltarla. */}
            <table className="min-w-full table-fixed text-xs">
              <colgroup>
                {visibles.map((c) => (
                  <col key={c.key} style={{ width: anchoActual(c) }} />
                ))}
              </colgroup>
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  {visibles.map((c) => (
                    <th
                      key={c.key}
                      onClick={c.kind === 'indicio' ? undefined : () => toggleSort(c.key as SortKey)}
                      title={c.label}
                      className={`group relative select-none px-2 py-2 font-semibold ${
                        c.align === 'right' ? 'text-right' : 'text-left'
                      } ${c.kind === 'indicio' ? '' : 'cursor-pointer hover:text-gray-900'}`}
                    >
                      <span className="block truncate">
                        {c.label}
                        {sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                      </span>
                      <ResizeHandle
                        ancho={anchoActual(c)}
                        onPreview={(a) => setArrastre(a === null ? null : { key: c.key, ancho: a })}
                        onFin={(a) => cols.redimensionar(c.key, a)}
                        onRestablecer={() => cols.restablecerAncho(c.key)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtradas.map((o) => (
                  <tr key={o.salesorder_number} onClick={() => setDetalleOV(o.salesorder_number)} className="cursor-pointer hover:bg-amber-50/40">
                    {visibles.map((c) => {
                      if (c.kind === 'indicio') {
                        return <td key={c.key} className="px-2 py-1"><Luces o={o} /></td>;
                      }
                      if (c.kind === 'estado') {
                        const e = estadoDe(o.status);
                        return (
                          <td key={c.key} className="px-2 py-1">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${e.cls}`}>{e.texto}</span>
                          </td>
                        );
                      }
                      const v = o[c.key as SortKey];
                      if (c.kind === 'anticipo') {
                        return <td key={c.key} className="truncate px-2 py-1 text-right tabular-nums">{celdaAnticipo(v as number | null | undefined)}</td>;
                      }
                      if (c.kind === 'money') {
                        return <td key={c.key} className="truncate px-2 py-1 text-right tabular-nums">{formatCOP(v as number)}</td>;
                      }
                      const txt = String(v ?? '') || '—';
                      // El title deja leer entero lo que la columna recorte al estrecharse.
                      return <td key={c.key} title={txt} className="truncate px-2 py-1">{txt}</td>;
                    })}
                  </tr>
                ))}
                {filtradas.length === 0 && (
                  <tr><td colSpan={visibles.length} className="px-2 py-4 text-center text-gray-400">Sin OV pendientes con estos filtros.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {detalleOV && (
        <DetalleModal
          tipo="ov"
          numero={detalleOV}
          onClose={() => setDetalleOV(null)}
          // Mismas luces que muestra su fila, con la etiqueta de lo que significan.
          indicios={LUCES.filter((l) => ordenes?.find((o) => o.salesorder_number === detalleOV)?.[l.key])}
        />
      )}
    </section>
  );
}
