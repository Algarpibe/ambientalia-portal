import { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import { getApp } from '../lib/apps';
import type { WidgetDescriptor } from '../widgets/types';

// Panel lateral (slide-over) con los widgets disponibles que aún no están
// anclados, agrupados por app de origen.

interface Props {
  open: boolean;
  onClose: () => void;
  availableWidgets: WidgetDescriptor[]; // widgets no anclados todavía
  onAddWidget: (descriptor: WidgetDescriptor) => void;
}

export default function CatalogPanel({ open, onClose, availableWidgets, onAddWidget }: Props) {
  const grouped = useMemo(() => {
    const map = new Map<string, WidgetDescriptor[]>();
    for (const w of availableWidgets) {
      const arr = map.get(w.appId) ?? [];
      arr.push(w);
      map.set(w.appId, arr);
    }
    return [...map.entries()];
  }, [availableWidgets]);

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Slide-over */}
      <aside
        className={`fixed inset-y-0 right-0 w-80 max-w-[90vw] bg-white shadow-xl z-50 transform transition-transform duration-200 flex flex-col ${open ? 'translate-x-0' : 'translate-x-full'}`}
        role="dialog"
        aria-label="Catálogo de widgets"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Añadir widget</h2>
          <button onClick={onClose} aria-label="Cerrar catálogo" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {availableWidgets.length === 0 ? (
            <p className="text-sm text-gray-500 text-center mt-8">No hay más widgets disponibles para añadir.</p>
          ) : (
            grouped.map(([appId, widgets]) => (
              <div key={appId}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                  {getApp(appId)?.label ?? appId}
                </h3>
                <div className="space-y-2">
                  {widgets.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => {
                        onAddWidget(w);
                        onClose();
                      }}
                      className="w-full text-left p-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50/50 transition-colors group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm text-gray-800">{w.name}</span>
                        <Plus className="w-4 h-4 text-gray-400 group-hover:text-blue-500 shrink-0" />
                      </div>
                      <p className="text-xs text-gray-500 mt-1 leading-snug">{w.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
