import { useMemo, useState } from 'react';
import { BarChart3, Search, Bell, Plus, Pencil, Check, AlertTriangle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useWidgetRegistry } from '../hooks/useWidgetRegistry';
import { useDashboardLayout } from '../hooks/useDashboardLayout';
import WidgetGrid from '../components/WidgetGrid';
import CatalogPanel from '../components/CatalogPanel';

// Dashboard = panel de widgets configurables del usuario. La navegación a las
// apps vive en el Sidebar (Herramientas / Aplicaciones), por lo que el dashboard
// no repite el directorio de tarjetas.

export default function Dashboard() {
  const { apps: assigned, user_id } = useAuth();

  const registry = useWidgetRegistry();
  const availableIds = useMemo(
    () => (registry.status === 'ready' ? new Set(registry.widgets.map((w) => w.id)) : null),
    [registry],
  );
  const { layoutItems, anchoredWidgetIds, addWidget, removeWidget, onLayoutChange, persistError } =
    useDashboardLayout(user_id, availableIds);

  const [editMode, setEditMode] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const allWidgets = registry.status === 'ready' ? registry.widgets : [];
  const availableWidgets = allWidgets.filter((w) => !anchoredWidgetIds.has(w.id));
  const hasWidgets = anchoredWidgetIds.size > 0;
  const deleteTarget = confirmDelete ? allWidgets.find((w) => w.id === confirmDelete) : null;
  const noAppsAssigned = assigned.length === 0;

  return (
    <main className="flex-grow bg-transparent p-6 overflow-y-auto">
      {/* Top Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <h1 className="text-4xl font-bold mb-2 tracking-tight text-gray-900">Bienvenido, Portal Ambientalia</h1>
          <p className="text-gray-500">Gestiona todas tus herramientas operativas desde un solo lugar.</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input type="text" placeholder="Buscar app..." className="input-field pl-10 pr-4 w-64" />
          </div>
          <button className="p-2.5 bg-white rounded-2xl border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors shadow-soft">
            <Bell size={20} />
          </button>
        </div>
      </header>

      {/* Controles del dashboard de widgets */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-slate-700 to-slate-900 rounded-2xl flex items-center justify-center shadow-soft">
            <BarChart3 className="text-white" size={20} />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Mi Panel</h2>
        </div>
        <div className="flex items-center gap-2">
          {editMode && (
            <button
              onClick={() => setCatalogOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl px-4 py-2 transition-colors shadow-soft"
            >
              <Plus size={16} /> Añadir widget
            </button>
          )}
          <button
            onClick={() => setEditMode((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 border border-gray-200 bg-white rounded-xl px-4 py-2 hover:bg-gray-50 transition-colors shadow-soft"
          >
            {editMode ? <><Check size={16} /> Listo</> : <><Pencil size={16} /> Editar panel</>}
          </button>
        </div>
      </div>

      {/* Estado de carga / error del registry */}
      {registry.status === 'loading' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-soft">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
          <p className="text-gray-500 text-sm mt-3">Cargando widgets…</p>
        </div>
      )}
      {registry.status === 'error' && (
        <div className="bg-red-50 rounded-2xl border border-red-200 p-6 text-center text-red-600 text-sm">
          {registry.message}
        </div>
      )}

      {/* Banner de error de persistencia */}
      {persistError && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-4 py-2.5 text-sm mb-6">
          <AlertTriangle size={16} /> {persistError}
        </div>
      )}

      {/* Grid de widgets o estado vacío */}
      {registry.status === 'ready' &&
        (hasWidgets ? (
          <div className="-mx-2">
            <WidgetGrid
              layoutItems={layoutItems}
              widgets={allWidgets}
              editMode={editMode}
              onLayoutChange={onLayoutChange}
              onRemoveWidget={(id) => setConfirmDelete(id)}
            />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-10 text-center shadow-soft">
            <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
              <Plus className="text-blue-500" size={28} />
            </div>
            {noAppsAssigned ? (
              <>
                <p className="text-gray-700 font-semibold mb-1">No tienes aplicaciones asignadas todavía</p>
                <p className="text-gray-500 text-sm">Contacta a un administrador para obtener acceso a las aplicaciones.</p>
              </>
            ) : (
              <>
                <p className="text-gray-700 font-semibold mb-1">Tu panel está vacío</p>
                <p className="text-gray-500 text-sm mb-5">
                  {availableWidgets.length > 0
                    ? 'Añade widgets de tus aplicaciones para verlos aquí.'
                    : 'Aún no hay widgets disponibles en tus aplicaciones asignadas.'}
                </p>
                {availableWidgets.length > 0 && (
                  <button
                    onClick={() => {
                      setEditMode(true);
                      setCatalogOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl px-4 py-2 transition-colors"
                  >
                    <Plus size={16} /> Añadir widget
                  </button>
                )}
              </>
            )}
          </div>
        ))}

      {/* Catálogo de widgets */}
      <CatalogPanel
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        availableWidgets={availableWidgets}
        onAddWidget={addWidget}
      />

      {/* Confirmación de eliminación */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Eliminar widget</h3>
            <p className="text-sm text-gray-600 mb-6">¿Quitar «{deleteTarget.name}» de tu panel?</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm font-semibold text-gray-700 rounded-xl border border-gray-200 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  removeWidget(deleteTarget.id);
                  setConfirmDelete(null);
                }}
                className="px-4 py-2 text-sm font-semibold text-white rounded-xl bg-red-600 hover:bg-red-700"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
