import { Link } from 'react-router-dom';
import {
  type LucideIcon,
  BarChart3,
  Wallet,
  TrendingUp,
  ChevronRight,
  Beaker,
  Users,
  FileSpreadsheet,
  Landmark,
  CalendarDays
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { isRouteAssigned } from '../lib/apps';

interface AppConfig {
  name: string;
  description: string;
  path: string;
  icon: LucideIcon;
  color: string;
}

const aplicaciones: AppConfig[] = [
  {
    name: "Conciliador de Pagos",
    description: "Sincroniza y valida cobros con facturación pendiente en tiempo real.",
    path: "/conciliador-pagos",
    icon: Wallet,
    color: "from-blue-400 to-blue-600"
  },
  {
    name: "Rentabilidad Clientes",
    description: "Identifica tus cuentas más valiosas con análisis de margen profundo.",
    path: "/rentabilidad-clientes",
    icon: TrendingUp,
    color: "from-orange-400 to-rose-500"
  },
  {
    name: "Análisis de Inventario",
    description: "Algoritmos predictivos para evitar quiebres de stock y excesos.",
    path: "/analisis-inventario",
    icon: BarChart3,
    color: "from-cyan-400 to-blue-500"
  },
  {
    name: "Buscador de Laboratorios Ambientales",
    description: "Búsqueda y análisis de laboratorios acreditados por IDEAM con datos en tiempo real.",
    path: "/laboratorios-ambientales",
    icon: Beaker,
    color: "from-green-400 to-emerald-600"
  },
  {
    name: "Valoración de Clientes",
    description: "Scoring de Valor y Riesgo por cliente: rentabilidad, pagos y recencia con segmentación automática.",
    path: "/valoracion-clientes",
    icon: Users,
    color: "from-violet-400 to-purple-600"
  },
  {
    name: "Carga de Pedidos WO",
    description: "Genera el archivo plano de pedidos que World Office importa, desde las órdenes de venta vivas de Zoho.",
    path: "/carga-pedidos-wo",
    icon: FileSpreadsheet,
    color: "from-amber-400 to-orange-500"
  },
  {
    name: "Contabilidad",
    description: "Facturación 2026 en vivo desde Zoho: cartera, cobros, IVA y retenciones, con avance mensual frente al presupuesto.",
    path: "/contabilidad",
    icon: Landmark,
    color: "from-teal-400 to-emerald-600"
  },
  {
    name: "Vacaciones y Permisos",
    description: "Solicita vacaciones, compensatorios y permisos, o informa una incapacidad, con aprobación y calendario.",
    path: "/ausencias",
    icon: CalendarDays,
    color: "from-sky-400 to-indigo-600"
  }
];

export default function Aplicaciones() {
  // Solo las apps asignadas al usuario (Req 4.4).
  const { apps: assigned } = useAuth();
  const visibles = aplicaciones.filter((app) => isRouteAssigned(app.path, assigned));
  return (
    <main className="flex-grow bg-transparent p-6 overflow-y-auto">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-soft">
            <BarChart3 className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-gray-900">Aplicaciones</h1>
            <p className="text-gray-500 mt-1">Soluciones empresariales avanzadas para análisis y gestión de datos</p>
          </div>
        </div>
      </header>

      {visibles.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-soft mb-6">
          <p className="text-gray-700 font-semibold mb-1">No tienes aplicaciones asignadas todavía</p>
          <p className="text-gray-500 text-sm">Contacta a un administrador para obtener acceso a las aplicaciones.</p>
        </div>
      )}

      {/* Grid de Aplicaciones */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {visibles.map((app, index) => (
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

        {/* Add Application Card */}
        <button className="app-card p-8 flex flex-col items-center justify-center border-dashed border-gray-300 hover:border-blue-500 bg-white group">
          <div className="w-16 h-16 rounded-full border-2 border-gray-200 flex items-center justify-center group-hover:bg-blue-50 group-hover:border-blue-500 transition-all mb-4">
            <span className="text-3xl text-gray-400 group-hover:text-blue-500 transition-colors">+</span>
          </div>
          <span className="font-semibold text-gray-700 group-hover:text-gray-900">Expandir Ecosistema</span>
          <p className="text-xs text-gray-500 mt-2">Añadir nueva aplicación local</p>
        </button>
      </div>
    </main>
  );
}
