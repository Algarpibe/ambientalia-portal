import { Link } from 'react-router-dom';
import {
  BarChart3,
  Wallet,
  Package,
  TrendingUp,
  Users,
  Search,
  ChevronRight,
  Bell,
  Wrench,
  Star
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { isRouteAssigned } from '../lib/apps';

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

export default function Dashboard() {
  // Solo se muestran las apps asignadas al usuario (Req 4.4).
  const { apps: assigned } = useAuth();
  const visibles = apps.filter(app => isRouteAssigned(app.path, assigned));
  const herramientas = visibles.filter(app => app.section === 'herramientas');
  const aplicaciones = visibles.filter(app => app.section === 'aplicaciones');

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
            <input
              type="text"
              placeholder="Buscar app..."
              className="input-field pl-10 pr-4 w-64"
            />
          </div>
          <button className="p-2.5 bg-white rounded-2xl border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors shadow-soft">
            <Bell size={20} />
          </button>
        </div>
      </header>

      {/* Sin apps asignadas (Req 4.4) */}
      {visibles.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-soft">
          <p className="text-gray-700 font-semibold mb-1">No tienes aplicaciones asignadas todavía</p>
          <p className="text-gray-500 text-sm">Contacta a un administrador para obtener acceso a las aplicaciones.</p>
        </div>
      )}

      {/* Herramientas Section */}
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
            <Link
              key={index}
              to={app.path}
              className="app-card p-8 group flex flex-col h-[280px]"
            >
              <div className="flex justify-between items-start mb-6">
                <div className={`w-14 h-14 bg-gradient-to-br ${app.color} rounded-2xl flex items-center justify-center shadow-soft group-hover:scale-110 transition-transform duration-300`}>
                  <app.icon className="text-white" size={28} />
                </div>
              </div>

              <h2 className="text-xl font-bold mb-3 text-gray-900 group-hover:text-blue-500 transition-colors">
                {app.name}
              </h2>
              <p className="text-gray-600 leading-relaxed mb-6 flex-grow text-sm">
                {app.description}
              </p>

              <div className="flex items-center gap-2 text-blue-500 font-semibold group-hover:gap-3 transition-all text-sm">
                Abrir Herramienta <ChevronRight size={16} />
              </div>
            </Link>
          ))}
        </div>
      </section>
      )}

      {/* Aplicaciones Section */}
      {aplicaciones.length > 0 && (
      <section id="aplicaciones" className="mb-12">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-soft">
            <BarChart3 className="text-white" size={20} />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Aplicaciones</h2>
          <div className="h-px bg-gray-200 flex-grow ml-4"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {aplicaciones.map((app, index) => (
            <Link
              key={index}
              to={app.path}
              className="app-card p-8 group flex flex-col h-[280px]"
            >
              <div className="flex justify-between items-start mb-6">
                <div className={`w-14 h-14 bg-gradient-to-br ${app.color} rounded-2xl flex items-center justify-center shadow-soft group-hover:scale-110 transition-transform duration-300`}>
                  <app.icon className="text-white" size={28} />
                </div>
              </div>

              <h2 className="text-xl font-bold mb-3 text-gray-900 group-hover:text-blue-500 transition-colors">
                {app.name}
              </h2>
              <p className="text-gray-600 leading-relaxed mb-6 flex-grow text-sm">
                {app.description}
              </p>

              <div className="flex items-center gap-2 text-blue-500 font-semibold group-hover:gap-3 transition-all text-sm">
                Abrir Aplicación <ChevronRight size={16} />
              </div>
            </Link>
          ))}

          {/* Add Project Card */}
          <button className="app-card p-8 flex flex-col items-center justify-center border-dashed border-gray-300 hover:border-blue-500 bg-white group">
            <div className="w-16 h-16 rounded-full border-2 border-gray-200 flex items-center justify-center group-hover:bg-blue-50 group-hover:border-blue-500 transition-all mb-4">
              <span className="text-3xl text-gray-400 group-hover:text-blue-500 transition-colors">+</span>
            </div>
            <span className="font-semibold text-gray-700 group-hover:text-gray-900">Expandir Ecosistema</span>
            <p className="text-xs text-gray-500 mt-2">Añadir nueva aplicación local</p>
          </button>
        </div>
      </section>
      )}

      {/* System Stats Footer Area */}
      <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="flex items-center gap-4 bg-white p-4 rounded-2xl border border-gray-200 shadow-soft">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span className="text-sm font-medium text-gray-700">Core Engine: Operational</span>
        </div>
        <div className="flex items-center gap-4 bg-white p-4 rounded-2xl border border-gray-200 shadow-soft">
          <ChevronRight className="text-blue-500" size={16} />
          <span className="text-sm font-medium text-gray-700">Last Sync: 2m ago</span>
        </div>
        <div className="flex items-center gap-4 bg-white p-4 rounded-2xl border border-gray-200 shadow-soft">
          <Users className="text-blue-500" size={16} />
          <span className="text-sm font-medium text-gray-700">5 Apps Integrated</span>
        </div>
      </div>
    </main>
  );
}
