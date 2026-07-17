import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  Wallet,
  Package,
  TrendingUp,
  Users,
  Search,
  ChevronRight,
  ChevronDown,
  Bell,
  Wrench,
  Star,
  Plus,
  Pencil,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { isRouteAssigned } from '../lib/apps';
import { useWidgetRegistry } from '../hooks/useWidgetRegistry';
import { useDashboardLayout } from '../hooks/useDashboardLayout';
import WidgetGrid from '../components/WidgetGrid';
import CatalogPanel from '../components/CatalogPanel';

interface AppConfig {
  name: string;
  description: string;
  path: string;
  icon: any;
  section: 'herramientas' | 'aplicaciones';
  color: string;
}

const apps: AppConfig[] = [
  {
    name: "Consolidador de Inventario",
    description: "Balance de existencias optimizado en todos tus centros logísticos.",
    path: "/consolidador-inventario",
    icon: Package,
    section: "herramientas",
    color: "from-emerald-400 to-teal-500"
  },
  {
    name: "Ventas Artículos",
    description: "Explora tendencias de consumo y rendimiento por categoría de producto.",
    path: "/ventas-articulos",
    icon: Users,
    section: "herramientas",
    color: "from-purple-400 to-pink-500"
  },
  {
    name: "Conciliador de Pagos",
    description: "Sincroniza y valida cobros con facturación pendiente en tiempo real.",
    path: "/conciliador-pagos",
    icon: Wallet,
    section: "aplicaciones",
    color: "from-blue-400 to-blue-600"
  },
  {
    name: "Rentabilidad Clientes",
    description: "Identifica tus cuentas más valiosas con análisis de margen profundo.",
    path: "/rentabilidad-clientes",
    icon: TrendingUp,
    section: "aplicaciones",
    color: "from-orange-400 to-rose-500"
  },
  {
    name: "Análisis de Inventario",
    description: "Algoritmos predictivos para evitar quiebres de stock y excesos.",
    path: "/analisis-inventario",
    icon: BarChart3,
    section: "aplicaciones",
    color: "from-cyan-400 to-blue-500"
  },
  {
    name: "Valoración de Clientes",
    description: "Scoring de Valor y Riesgo por cliente con segmentación y políticas comerciales.",
    path: "/valoracion-clientes",
    icon: Star,
    section: "aplicaciones",
    color: "from-violet-400 to-purple-600"
  }
];

// ─── Directorio de apps (extraído; su contenido y filtrado se preservan) ──────

function AppsDirectory({ visibles }: { visibles: AppConfig[] }) {
  const herramientas = visibles.filter((app) => app.section === 'herramientas');
  const aplicaciones = visibles.filter((app) => app.section === 'aplicaciones');

  return (
    <>
      {herramientas.length > 0 && (
        <section id="herramientas" className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-2xl flex items-center justify-center shadow-soft">
              <Wrench className="text-white" size={20} />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Herramientas</h2>
            <div className="h-px bg-gray-200 flex-grow ml-4"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {herramientas.map((app, index) => (
              <AppCard key={index} app={app} verb="Abrir Herramienta" />
            ))}
          </div>
        </section>
      )}

      {aplicaciones.length > 0 && (
        <section id="aplicaciones" className="mb-4">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-soft">
              <BarChart3 className="text-white" size={20} />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Aplicaciones</h2>
            <div className="h-px bg-gray-200 flex-grow ml-4"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {aplicaciones.map((app, index) => (
              <AppCard key={index} app={app} verb="Abrir Aplicación" />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function AppCard({ app, verb }: { app: AppConfig; verb: string }) {
  return (
    <Link to={app.path} className="app-card p-8 group flex flex-col h-[280px]">
      <div className="flex justify-between items-start mb-6">
        <div className={`w-14 h-14 bg-gradient-to-br ${app.color} rounded-2xl flex items-center justify-center shadow-soft group-hover:scale-110 transition-transform duration-300`}>
          <app.icon className="text-white" size={28} />
        </div>
      </div>
      <h2 className="text-xl font-bold mb-3 text-gray-900 group-hover:text-blue-500 transition-colors">{app.name}</h2>
      <p className="text-gray-600 leading-relaxed mb-6 flex-grow text-sm">{app.description}</p>
      <div className="flex items-center gap-2 text-blue-500 font-semibold group-hover:gap-3 transition-all text-sm">
        {verb} <ChevronRight size={16} />
      </div>
    </Link>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function readDirectorioExpanded(userId: string | null): boolean {
  if (!userId) return true;
  try {
    const v = localStorage.getItem(`dashboard_apps_expanded_${userId}`);
    return v === null ? true : v === 'true';
  } catch {
    return true;
  }
}

export default function Dashboard() {
  const { apps: assigned, user_id } = useAuth();
  const visibles = apps.filter((app) => isRouteAssigned(app.path, assigned));

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
  const [directorioExpanded, setDirectorioExpanded] = useState(() => readDirectorioExpanded(user_id));

  useEffect(() => {
    setDirectorioExpanded(readDirectorioExpanded(user_id));
  }, [user_id]);

  const toggleDirectorio = () => {
    setDirectorioExpanded((prev) => {
      const next = !prev;
      if (user_id) {
        try {
          localStorage.setItem(`dashboard_apps_expanded_${user_id}`, String(next));
        } catch {
          /* no-op */
        }
      }
      return next;
    });
  };

  const allWidgets = registry.status === 'ready' ? registry.widgets : [];
  const availableWidgets = allWidgets.filter((w) => !anchoredWidgetIds.has(w.id));
  const hasWidgets = anchoredWidgetIds.size > 0;
  const deleteTarget = confirmDelete ? allWidgets.find((w) => w.id === confirmDelete) : null;

  return (
    <main className="flex-grow bg-transparent p-6 overflow-y-auto">
      {/* Top Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <h1 className="text-4xl font-bold mb-2 tracking-tight text-gray-900">Bienvenido, Portal Maestro</h1>
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
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-soft mb-10">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
          <p className="text-gray-500 text-sm mt-3">Cargando widgets…</p>
        </div>
      )}
      {registry.status === 'error' && (
        <div className="bg-red-50 rounded-2xl border border-red-200 p-6 text-center text-red-600 text-sm mb-10">
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
      {registry.status === 'ready' && (
        hasWidgets ? (
          <div className="mb-12 -mx-2">
            <WidgetGrid
              layoutItems={layoutItems}
              widgets={allWidgets}
              editMode={editMode}
              onLayoutChange={onLayoutChange}
              onRemoveWidget={(id) => setConfirmDelete(id)}
            />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-10 text-center shadow-soft mb-12">
            <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
              <Plus className="text-blue-500" size={28} />
            </div>
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
          </div>
        )
      )}

      {/* Directorio de apps: expandido si no hay widgets; colapsable si los hay */}
      {visibles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-soft">
          <p className="text-gray-700 font-semibold mb-1">No tienes aplicaciones asignadas todavía</p>
          <p className="text-gray-500 text-sm">Contacta a un administrador para obtener acceso a las aplicaciones.</p>
        </div>
      ) : hasWidgets ? (
        <section>
          <button
            onClick={toggleDirectorio}
            className="flex items-center gap-2 text-lg font-bold text-gray-700 hover:text-gray-900 mb-4"
          >
            <ChevronDown className={`transition-transform ${directorioExpanded ? '' : '-rotate-90'}`} size={20} />
            Todas mis aplicaciones
          </button>
          {directorioExpanded && <AppsDirectory visibles={visibles} />}
        </section>
      ) : (
        <AppsDirectory visibles={visibles} />
      )}

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
