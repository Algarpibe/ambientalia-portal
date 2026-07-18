import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, ArrowUp, ArrowDown } from 'lucide-react';

// Desplegable "Columnas": reordena las columnas de una tabla con flechas ↑/↓
// (sin arrastrar). `columns` viene en el orden actual; `onMove(key, dir)` sube (-1)
// o baja (+1) la columna. El orden lo persiste el hook useColumnOrder.

interface Props {
  columns: { key: string; label: string }[];
  onMove: (key: string, dir: -1 | 1) => void;
}

export default function ColumnOrderMenu({ columns, onMove }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 hover:bg-gray-50 whitespace-nowrap"
      >
        <SlidersHorizontal size={13} /> Columnas
      </button>

      {open && (
        <div className="absolute z-30 mt-1 right-0 w-56 bg-white border border-gray-200 rounded-xl shadow-lg p-2">
          <p className="text-[11px] text-gray-400 px-1 pb-1">Orden de columnas</p>
          <ul className="max-h-64 overflow-auto">
            {columns.map((c, i) => (
              <li key={c.key} className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-gray-50">
                <span className="text-xs text-gray-700 truncate">{c.label}</span>
                <span className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => onMove(c.key, -1)}
                    aria-label={`Subir ${c.label}`}
                    className="p-0.5 rounded text-gray-400 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    disabled={i === columns.length - 1}
                    onClick={() => onMove(c.key, 1)}
                    aria-label={`Bajar ${c.label}`}
                    className="p-0.5 rounded text-gray-400 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ArrowDown size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
