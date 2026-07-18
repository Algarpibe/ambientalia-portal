import { useMemo, useState } from 'react';
import type { FacturaContable } from './api';
import { formatCOP, formatPct } from './format';

type SortKey = keyof FacturaContable;
interface Props {
  facturas: FacturaContable[];
  onEditarCartera: (invoiceNumber: string, cartera: string) => void;
  guardando: string | null; // invoiceNumber que se está guardando, o null
}

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right'; kind: 'text' | 'money' | 'pct' }[] = [
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
];

function cell(f: FacturaContable, kind: 'text' | 'money' | 'pct', key: SortKey): string {
  const v = f[key];
  if (kind === 'money') return formatCOP(v as number);
  if (kind === 'pct') return formatPct(v as number);
  return String(v ?? '');
}

export default function FacturasTable({ facturas, onEditarCartera, guardando }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'fechaFactura', dir: 1 });

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
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                onClick={() => toggleSort(c.key)}
                className={`cursor-pointer select-none px-2 py-2 font-semibold whitespace-nowrap ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                } hover:text-gray-900`}
              >
                {c.label}
                {sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
            <th className="px-2 py-2 text-left font-semibold">CARTERA</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ordenadas.map((f, i) => (
            <tr key={f.invoiceNumber} className="hover:bg-blue-50/40">
              <td className="px-2 py-1 text-gray-400">{i + 1}</td>
              {COLUMNS.map((c) => (
                <td
                  key={c.key}
                  className={`px-2 py-1 whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}
                >
                  {cell(f, c.kind, c.key)}
                </td>
              ))}
              <td className="px-2 py-1">
                <input
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
