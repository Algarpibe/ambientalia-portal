import { useMemo, useState } from 'react';
import type { FacturaContable } from './api';
import { formatCOP, formatPct } from './format';

type SortKey = keyof FacturaContable;

/**
 * Definición ÚNICA de las columnas: de aquí salen la cabecera, las celdas, el orden
 * por defecto y las etiquetas del menú "Columnas". Añadir una columna es añadir una
 * entrada aquí; el selector la recoge sola (y aparece visible, ver useColumnPrefs).
 *
 * `entrega` y `cartera` no son texto plano —una es la luz de entrega pendiente y la
 * otra un input editable—, por eso llevan su propio `kind`. Se listan como columnas
 * normales para que también se puedan reordenar y ocultar.
 */
interface ColDef {
  key: ColKey;
  label: string;
  align: 'left' | 'right';
  kind: 'text' | 'money' | 'pct' | 'luz' | 'cartera';
}

const CLAVES = [
  'entrega', 'razonSocial', 'qt', 'fechaFactura', 'fechaVencimiento', 'ov', 'trato', 'ticket',
  'total', 'iva', 'totalConIva', 'cobradoPct', 'cobrado', 'porCobrar', 'retenciones',
  'participacion', 'invoiceNumber', 'cartera',
] as const;
export type ColKey = (typeof CLAVES)[number];

const COLUMNAS: ColDef[] = [
  { key: 'entrega', label: 'ENTREGA', align: 'left', kind: 'luz' },
  { key: 'razonSocial', label: 'RAZÓN SOCIAL', align: 'left', kind: 'text' },
  { key: 'qt', label: 'QT', align: 'left', kind: 'text' },
  { key: 'fechaFactura', label: 'FECHA FACTURA', align: 'left', kind: 'text' },
  { key: 'fechaVencimiento', label: 'FECHA VENC.', align: 'left', kind: 'text' },
  { key: 'ov', label: 'OV', align: 'left', kind: 'text' },
  { key: 'trato', label: 'TRATO', align: 'left', kind: 'text' },
  { key: 'ticket', label: 'TICKET', align: 'left', kind: 'text' },
  { key: 'total', label: 'TOTAL ($)', align: 'right', kind: 'money' },
  { key: 'iva', label: 'IVA (19%)', align: 'right', kind: 'money' },
  { key: 'totalConIva', label: 'TOTAL + IVA', align: 'right', kind: 'money' },
  { key: 'cobradoPct', label: 'COBRADO (%)', align: 'right', kind: 'pct' },
  { key: 'cobrado', label: 'COBRADO ($)', align: 'right', kind: 'money' },
  { key: 'porCobrar', label: 'POR COBRAR ($)', align: 'right', kind: 'money' },
  { key: 'retenciones', label: 'RETENCIONES', align: 'right', kind: 'money' },
  { key: 'participacion', label: '% PART.', align: 'right', kind: 'pct' },
  { key: 'invoiceNumber', label: 'FACTURA', align: 'left', kind: 'text' },
  { key: 'cartera', label: 'CARTERA', align: 'left', kind: 'cartera' },
];

export const ORDEN_POR_DEFECTO: ColKey[] = COLUMNAS.map((c) => c.key);
export const ETIQUETAS = Object.fromEntries(COLUMNAS.map((c) => [c.key, c.label])) as Record<ColKey, string>;
const DEF = new Map<ColKey, ColDef>(COLUMNAS.map((c) => [c.key, c]));

interface Props {
  facturas: FacturaContable[];
  onEditarCartera: (invoiceNumber: string, cartera: string) => void;
  guardando: string | null; // invoiceNumber que se está guardando, o null
  onAbrirDetalle?: (invoiceNumber: string) => void;
  orden: ColKey[];
  esVisible: (key: ColKey) => boolean;
}

function texto(f: FacturaContable, kind: ColDef['kind'], key: ColKey): string {
  const v = f[key as SortKey];
  if (kind === 'money') return formatCOP(v as number);
  if (kind === 'pct') return formatPct(v as number);
  return String(v ?? '');
}

export default function FacturasTable({ facturas, onEditarCartera, guardando, onAbrirDetalle, orden, esVisible }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'fechaFactura', dir: 1 });

  const visibles = useMemo(
    () => orden.map((k) => DEF.get(k)).filter((c): c is ColDef => !!c && esVisible(c.key)),
    [orden, esVisible],
  );

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
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-2 py-2 text-left font-semibold">#</th>
            {visibles.map((c) =>
              c.kind === 'luz' ? (
                <th
                  key={c.key}
                  title="Entrega pendiente: hay artículos de la factura sin empaquetar"
                  className="px-2 py-2 text-left font-semibold whitespace-nowrap"
                >
                  {c.label}
                </th>
              ) : (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key as SortKey)}
                  className={`cursor-pointer select-none px-2 py-2 font-semibold whitespace-nowrap ${
                    c.align === 'right' ? 'text-right' : 'text-left'
                  } hover:text-gray-900`}
                >
                  {c.label}
                  {sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ),
            )}
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
                        className="w-36 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-300 focus:border-blue-400 focus:bg-white focus:outline-none"
                      />
                    </td>
                  );
                }
                return (
                  <td
                    key={c.key}
                    className={`px-2 py-1 whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}
                  >
                    {texto(f, c.kind, c.key)}
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
