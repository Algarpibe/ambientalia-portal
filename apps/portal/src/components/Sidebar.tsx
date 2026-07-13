import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Settings,
  Users,
  ShieldCheck,
  Box,
  Wrench,
  LogOut
} from 'lucide-react';
import { clearToken } from '../auth';

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => location.pathname === path;

  const handleLogOut = () => {
    clearToken();
    navigate('/auth');
  };

  return (
    <aside className="w-72 bg-white border-r border-gray-200 p-6 flex flex-col hidden lg:flex">
      <Link to="/" className="flex items-center gap-3 mb-10 px-2">
        <div className="w-10 h-10 bg-blue-500 rounded-2xl flex items-center justify-center shadow-soft">
          <ShieldCheck className="text-white" size={24} />
        </div>
        <span className="text-xl font-bold tracking-tight text-gray-900">Antigravity</span>
      </Link>

      <nav className="flex-grow space-y-2">
        <Link
          to="/"
          className={`nav-item w-full ${isActive('/') ? 'active' : ''}`}
        >
          <LayoutDashboard size={20} /> Dashboard
        </Link>
        <Link
          to="/herramientas"
          className={`nav-item w-full ${isActive('/herramientas') ? 'active' : ''}`}
        >
          <Wrench size={20} /> Herramientas
        </Link>
        <Link
          to="/aplicaciones"
          className={`nav-item w-full ${isActive('/aplicaciones') ? 'active' : ''}`}
        >
          <Box size={20} /> Aplicaciones
        </Link>
        <button className="nav-item w-full">
          <Users size={20} /> Usuarios
        </button>
        <button className="nav-item w-full">
          <Settings size={20} /> Ajustes
        </button>
      </nav>

      <div className="mt-auto p-4 bg-gray-50 rounded-2xl border border-gray-200">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-bold mb-2">Suscripción</p>
        <p className="text-sm font-semibold text-gray-900">Enterprise Plan</p>
        <div className="mt-3 w-full bg-gray-200 h-2 rounded-full overflow-hidden">
          <div className="bg-blue-500 h-full w-3/4 rounded-full"></div>
        </div>
      </div>

      <button
        onClick={handleLogOut}
        className="mt-4 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-semibold transition-all duration-200 border border-red-200 hover:border-red-300"
      >
        <LogOut size={20} />
        Cerrar sesión
      </button>
    </aside>
  );
}
