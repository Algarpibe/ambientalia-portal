import { useMemo, useState } from 'react';
import type { FacturaContable } from './api';
import { formatCOP, formatPct } from './format';
import ResizeHandle from './ResizeHandle';

type SortKey = keyof FacturaContable;

/**
 * Definición ÚNICA de las columnas: de aquí salen la cabecera, las celdas, el orden
 * por defecto, las etiquetas del menú "Columnas" y el ancho inicial. Añadir una
 * columna es añadir una entrada aquí; el selector la recoge sola.
 *
 * `entrega` y `cartera` no son texto plano —una es la luz de entrega pendiente y la
 * otra un input editable—, por eso llevan su propio `kind`. Se listan como columnas
 * normales para que también se puedan reordenar, ocultar y redimensionar.
 */
interface ColDef {
  key: ColKey;
  label: string;
  align: 'left' | 'right';
  kind: 'text' | 'money' | 'pct' | 'luz' | 'cartera';
  /** Ancho inicial en px. El usuario lo cambia arrastrando el borde de la cabecera. */
  ancho: number;
}

const CLAVES = [
  'entrega', 'razonSocial', 'qt', 'fechaFactura', 'fechaVencimiento', 'ov', 'trato', 'ticket',
  'total', 'iva', 'totalConIva', 'cobradoPct', 'cobrado', 'porCobrar', 'retenciones',
  'participacion', 'invoiceNumber', 'cartera',
] as const;
export type ColKey = (typeof CLAVES)[number];

const COLUMNAS: ColDef[] = [
  { key: 'entrega', label: 'ENTREGA', align: 'left', kind: 'luz', ancho: 70 },
  { key: 'razonSocial', label: 'RAZÓN SOCIAL', align: 'left', kind: 'text', ancho: 260 },
  { key: 'qt', label: 'QT', align: 'left', kind: 'text', ancho: 85 },
  { key: 'fechaFactura', label: 'FECHA FACTURA', align: 'left', kind: 'text', ancho: 110 },
  { key: 'fechaVencimiento', label: 'FECHA VENC.', align: 'left', kind: 'text', ancho: 110 },
  { key: 'ov', label: 'OV', align: 'left', kind: 'text', ancho: 110 },
  { key: 'trato', label: 'TRATO', align: 'left', kind: 'text', ancho: 240 },
  { key: 'ticket', label: 'TICKET', align: 'left', kind: 'text', ancho: 80 },
  { key: 'total', label: 'TOTAL ($)', align: 'right', kind: 'money', ancho: 120 },
  { key: 'iva', label: 'IVA (19%)', align: 'right', kind: 'money', ancho: 110 },
  { key: 'totalConIva', label: 'TOTAL + IVA', align: 'right', kind: 'money', ancho: 120 },
  { key: 'cobradoPct', label: 'COBRADO (%)', align: 'right', kind: 'pct', ancho: 105 },
  { key: 'cobrado', label: 'COBRADO ($)', align: 'right', kind: 'money', ancho: 120 },
  { key: 'porCobrar', label: 'POR COBRAR ($)', align: 'right', kind: 'money', ancho: 125 },
  { key: 'retenciones', label: 'RETENCIONES', align: 'right', kind: 'money', ancho: 110 },
  { key: 'participacion', label: '% PART.', align: 'right', kind: 'pct', ancho: 85 },
  { key: 'invoiceNumber', label: 'FACTURA', align: 'left', kind: 'text', ancho: 95 },
  { key: 'cartera', label: 'CARTERA', align: 'left', kind: 'cartera', ancho: 160 },
];

export const ORDEN_POR_DEFECTO: ColKey[] = COLUMNAS.map((c) => c.key);
export const ETIQUETAS = Object.fromEntries(COLUMNAS.map((c) => [c.key, c.label])) as Record<ColKey, string>;
const DEF = new Map<ColKey, ColDef>(COLUMNAS.map((c) => [c.key, c]));

const ANCHO_MINIMO = 48; // por debajo de esto la columna deja de ser legible
const ANCHO_NUMERO_FILA = 44;

interface Props {
  facturas: FacturaContable[];
  onEditarCartera: (invoiceNumber: string, cartera: string) => void;
  guardando: string | null; // invoiceNumber que se está guardando, o null
  onAbrirDetalle?: (invoiceNumber: string) => void;
  orden: ColKey[];
  esVisible: (key: ColKey) => boolean;
  anchoDe: (key: ColKey) => number | undefined;
  onRedimensionar: (key: ColKey, ancho: number) => void;
  onRestablecerAncho: (key: ColKey) => void;
}

function texto(f: FacturaContable, kind: ColDef['kind'], key: ColKey): string {
  const v = f[key as SortKey];
  if (kind === 'money') return formatCOP(v as number);
  if (kind === 'pct') return formatPct(v as number);
  return String(v ?? '');
}

export default function FacturasTable({
  facturas,
  onEditarCartera,
  guardando,
  onAbrirDetalle,
  orden,
  esVisible,
  anchoDe,
  onRedimensionar,
  onRestablecerAncho,
}: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'fechaFactura', dir: 1 });
  // Ancho en curso mientras se arrastra, para ver el cambio en vivo sin escribir
  // en localStorage en cada píxel (eso solo pasa al soltar).
  const [arrastre, setArrastre] = useState<{ key: ColKey; ancho: number } | null>(null);

  const visibles = useMemo(
    () => orden.map((k) => DEF.get(k)).filter((c): c is ColDef => !!c && esVisible(c.key)),
    [orden, esVisible],
  );

  const anchoActual = (c: ColDef): number =>
    arrastre?.key === c.key ? arrastre.ancho : (anchoDe(c.key) ?? c.ancho);

  const ordenadas = useMemo(() => {
    const arr = [...facturas];
    arr.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv), 'es') * sort.dir;
    });
    return arr;
  }, [facturas, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-soft">
      {/* table-fixed + colgroup: sin esto el navegador trata el ancho como una simple
          sugerencia y el contenido vuelve a estirar la columna al soltarla. */}
      <table className="min-w-full table-fixed text-xs">
        <colgroup>
          <col style={{ width: ANCHO_NUMERO_FILA }} />
          {visibles.map((c) => (
            <col key={c.key} style={{ width: anchoActual(c) }} />
          ))}
        </colgroup>
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-2 py-2 text-left font-semibold">#</th>
            {visibles.map((c) => (
              <th
                key={c.key}
                onClick={c.kind === 'luz' ? undefined : () => toggleSort(c.key as SortKey)}
                title={c.kind === 'luz' ? 'Entrega pendiente: hay artículos de la factura sin empaquetar' : c.label}
                className={`group relative select-none px-2 py-2 font-semibold ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                } ${c.kind === 'luz' ? '' : 'cursor-pointer hover:text-gray-900'}`}
              >
                <span className="block truncate">
                  {c.label}
                  {sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </span>
                <ResizeHandle
                  ancho={anchoActual(c)}
                  minimo={ANCHO_MINIMO}
                  onPreview={(a) => setArrastre(a === null ? null : { key: c.key, ancho: a })}
                  onFin={(a) => onRedimensionar(c.key, a)}
                  onRestablecer={() => onRestablecerAncho(c.key)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ordenadas.map((f, i) => (
            <tr
              key={f.invoiceNumber}
              onClick={() => onAbrirDetalle?.(f.invoiceNumber)}
              className="cursor-pointer hover:bg-blue-50/40"
            >
              <td className="px-2 py-1 text-gray-400">{i + 1}</td>
              {visibles.map((c) => {
                if (c.kind === 'luz') {
                  return (
                    <td key={c.key} className="px-2 py-1">
                      {f.unidadesPorDespachar > 0 && (
                        <span
                          title={`Entrega pendiente: ${f.unidadesPorDespachar} unidad(es) sin empaquetar de ${f.ov || 'su OV'}`}
                          className="inline-block h-2.5 w-2.5 rounded-full bg-violet-500"
                        />
                      )}
                    </td>
                  );
                }
                if (c.kind === 'cartera') {
                  return (
                    <td key={c.key} className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        // key incluye la cartera: si un guardado falla y App revierte el
                        // valor en estado, el input se remonta y muestra el valor revertido
                        // (un input no controlado con defaultValue no se actualizaría solo).
                        key={`${f.invoiceNumber}:${f.cartera}`}
                        type="text"
                        defaultValue={f.cartera}
                        disabled={guardando === f.invoiceNumber}
                        onBlur={(e) => {
                          if (e.target.value !== f.cartera) onEditarCartera(f.invoiceNumber, e.target.value);
                        }}
                        placeholder="—"
                        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-300 focus:border-blue-400 focus:bg-white focus:outline-none"
                      />
                    </td>
                  );
                }
                const v = texto(f, c.kind, c.key);
                return (
                  <td
                    key={c.key}
                    // El title deja leer entero lo que la columna recorte al estrecharse.
                    title={v}
                    className={`truncate px-2 py-1 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}
                  >
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
