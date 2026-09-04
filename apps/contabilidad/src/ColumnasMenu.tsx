import { useEffect, useRef, useState } from 'react';
import { Eye, GripVertical } from 'lucide-react';

/**
 * Desplegable "Columnas": arrastra para reordenar y marca/desmarca para mostrar u
 * ocultar. Mismo patrón que el Conciliador de Pagos, con el estilo del portal.
 * El estado lo posee y persiste `useColumnPrefs` (por usuario, en localStorage).
 */
interface Props<K extends string> {
  orden: K[];
  etiquetas: Record<K, string>;
  esVisible: (key: K) => boolean;
  onMover: (origen: K, destino: K) => void;
  onAlternar: (key: K) => void;
  onRestablecer: () => void;
  personalizado: boolean;
}

export default function ColumnasMenu<K extends string>({
  orden,
  etiquetas,
  esVisible,
  onMover,
  onAlternar,
  onRestablecer,
  personalizado,
}: Props<K>) {
  const [abierto, setAbierto] = useState(false);
  const [arrastrando, setArrastrando] = useState<K | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', esc);
    };
  }, [abierto]);

  const ocultas = orden.filter((k) => !esVisible(k)).length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAbierto((o) => !o)}
        aria-expanded={abierto}
        className="flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-blue-400 hover:text-blue-600"
      >
        <Eye size={16} />
        Columnas
        {ocultas > 0 && (
          <span className="rounded-full bg-blue-100 px-1.5 text-[11px] font-semibold text-blue-700">
            {ocultas} oculta{ocultas > 1 ? 's' : ''}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-strong">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Arrastra para reordenar</span>
            {personalizado && (
              <button type="button" onClick={onRestablecer} className="text-xs text-blue-500 hover:underline">
                Restablecer
              </button>
            )}
          </div>

          <div className="max-h-80 space-y-0.5 overflow-y-auto">
            {orden.map((k) => (
              <label
                key={k}
                draggable
                onDragStart={() => setArrastrando(k)}
                onDragEnd={() => setArrastrando(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (arrastrando) onMover(arrastrando, k);
                  setArrastrando(null);
                }}
                className={`flex items-center gap-2 rounded-lg border-2 p-1.5 transition-all ${
                  arrastrando === k
                    ? 'cursor-grabbing border-transparent opacity-50'
                    : arrastrando
                      ? 'cursor-grab border-dashed border-blue-300'
                      : 'cursor-grab border-transparent hover:bg-gray-50'
                }`}
              >
                <GripVertical size={15} className="shrink-0 text-gray-400" />
                <input
                  type="checkbox"
                  checked={esVisible(k)}
                  onChange={() => onAlternar(k)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className={`flex-1 truncate text-sm ${esVisible(k) ? 'text-gray-700' : 'text-gray-400 line-through'}`}>
                  {etiquetas[k]}
                </span>
              </label>
            ))}
          </div>

          <p className="mt-2 border-t border-gray-100 pt-2 text-[11px] text-gray-400">
            Tu configuración se guarda solo en este equipo y no afecta a otros usuarios.
          </p>
        </div>
      )}
    </div>
  );
}
