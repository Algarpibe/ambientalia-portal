import { Link } from 'react-router-dom';
import {
  Package,
  Users,
  ChevronRight,
  Wrench
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { isRouteAssigned } from '../lib/apps';

interface AppConfig {
  name: string;
  description: string;
  path: string;
  icon: any;
  color: string;
}

const herramientas: AppConfig[] = [
  {
    name: "Consolidador de Inventario",
    description: "Balance de existencias optimizado en todos tus centros logísticos.",
    path: "/consolidador-inventario",
    icon: Package,
    color: "from-emerald-400 to-teal-500"
  },
  {
    name: "Ventas Artículos",
    description: "Explora tendencias de consumo y rendimiento por categoría de producto.",
    path: "/ventas-articulos",
    icon: Users,
    color: "from-purple-400 to-pink-500"
  }
];

export default function Herramientas() {
  // Solo las herramientas asignadas al usuario (Req 4.4).
  const { apps: assigned } = useAuth();
  const visibles = herramientas.filter((app) => isRouteAssigned(app.path, assigned));
  return (
    <main className="flex-grow bg-transparent p-6 overflow-y-auto">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-2xl flex items-center justify-center shadow-soft">
            <Wrench className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-gray-900">Herramientas</h1>
            <p className="text-gray-500 mt-1">Utilidades rápidas para optimizar tus procesos operativos</p>
          </div>
        </div>
      </header>

      {visibles.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-soft mb-6">
          <p className="text-gray-700 font-semibold mb-1">No tienes herramientas asignadas todavía</p>
          <p className="text-gray-500 text-sm">Contacta a un administrador para obtener acceso a las herramientas.</p>
        </div>
      )}

      {/* Grid de Herramientas */}
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
              Abrir Herramienta <ChevronRight size={16} />
            </div>
          </Link>
        ))}

        {/* Add Tool Card */}
        <button className="app-card p-8 flex flex-col items-center justify-center border-dashed border-gray-300 hover:border-blue-500 bg-white group">
          <div className="w-16 h-16 rounded-full border-2 border-gray-200 flex items-center justify-center group-hover:bg-blue-50 group-hover:border-blue-500 transition-all mb-4">
            <span className="text-3xl text-gray-400 group-hover:text-blue-500 transition-colors">+</span>
          </div>
          <span className="font-semibold text-gray-700 group-hover:text-gray-900">Agregar Herramienta</span>
          <p className="text-xs text-gray-500 mt-2">Añadir nueva utilidad al portal</p>
        </button>
      </div>

      {/* Stats */}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-soft">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Total Herramientas</h3>
          <p className="text-3xl font-bold text-gray-900">{visibles.length}</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-soft">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Uso Mensual</h3>
          <p className="text-3xl font-bold text-gray-900">156</p>
          <p className="text-xs text-green-600 mt-1">↑ 24% vs mes anterior</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-soft">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Tiempo Ahorrado</h3>
          <p className="text-3xl font-bold text-gray-900">42h</p>
          <p className="text-xs text-gray-500 mt-1">Este mes</p>
        </div>
      </div>
    </main>
  );
}
