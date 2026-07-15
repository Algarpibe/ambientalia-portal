import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Settings,
  Users,
  ShieldCheck,
  Box,
  Wrench,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import { clearToken } from '../auth';
import { useAuth } from '../hooks/useAuth';
import { hasAssignedInCategory } from '../lib/apps';

// El estado plegado vive en localStorage y NO en el perfil del usuario a propósito:
// es una preferencia por dispositivo (plegada en el portátil, desplegada en el
// monitor grande), no algo que deba seguirte entre equipos.
const COLLAPSED_KEY = 'sidebar_collapsed';

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { role, apps } = useAuth();
  const showHerramientas = hasAssignedInCategory('herramienta', apps);
  const showAplicaciones = hasAssignedInCategory('aplicacion', apps);

  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(COLLAPSED_KEY) === 'true',
  );
  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  const isActive = (path: string) => location.pathname === path;

  const handleLogOut = () => {
    clearToken();
    navigate('/auth');
  };

  // Plegada: el icono se centra y el texto desaparece; la etiqueta pasa al title
  // para que siga siendo identificable al pasar el ratón.
  const itemClass = (path: string) =>
    `nav-item w-full ${isActive(path) ? 'active' : ''} ${collapsed ? 'justify-center px-0' : ''}`;

  return (
    <aside
      className={`bg-white border-r border-gray-200 flex flex-col hidden lg:flex transition-[width] duration-200 ease-out ${
        collapsed ? 'w-20 p-3' : 'w-72 p-6'
      }`}
    >
      <div className={`flex items-center mb-10 ${collapsed ? 'flex-col gap-3' : 'justify-between px-2'}`}>
        <Link to="/" className="flex items-center gap-3 overflow-hidden">
          <div className="w-10 h-10 bg-blue-500 rounded-2xl flex items-center justify-center shadow-soft shrink-0">
            <ShieldCheck className="text-white" size={24} />
          </div>
          {!collapsed && (
            <span className="text-xl font-bold tracking-tight text-gray-900 whitespace-nowrap">Antigravity</span>
          )}
        </Link>
        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expandir menú' : 'Contraer menú'}
          aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
          aria-expanded={!collapsed}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-900 hover:bg-gray-50 transition-colors shrink-0"
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <nav className="flex-grow space-y-2">
        <Link to="/" className={itemClass('/')} title={collapsed ? 'Dashboard' : undefined}>
          <LayoutDashboard size={20} className="shrink-0" />
          {!collapsed && 'Dashboard'}
        </Link>
        {showHerramientas && (
          <Link
            to="/herramientas"
            className={itemClass('/herramientas')}
            title={collapsed ? 'Herramientas' : undefined}
          >
            <Wrench size={20} className="shrink-0" />
            {!collapsed && 'Herramientas'}
          </Link>
        )}
        {showAplicaciones && (
          <Link
            to="/aplicaciones"
            className={itemClass('/aplicaciones')}
            title={collapsed ? 'Aplicaciones' : undefined}
          >
            <Box size={20} className="shrink-0" />
            {!collapsed && 'Aplicaciones'}
          </Link>
        )}
        {role === 'admin' && (
          <Link
            to="/admin/users"
            className={itemClass('/admin/users')}
            title={collapsed ? 'Usuarios' : undefined}
          >
            <Users size={20} className="shrink-0" />
            {!collapsed && 'Usuarios'}
          </Link>
        )}
        <button
          className={`nav-item w-full ${collapsed ? 'justify-center px-0' : ''}`}
          title={collapsed ? 'Ajustes' : undefined}
        >
          <Settings size={20} className="shrink-0" />
          {!collapsed && 'Ajustes'}
        </button>
      </nav>

      {!collapsed && (
        <div className="mt-auto p-4 bg-gray-50 rounded-2xl border border-gray-200">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-bold mb-2">Suscripción</p>
          <p className="text-sm font-semibold text-gray-900">Enterprise Plan</p>
          <div className="mt-3 w-full bg-gray-200 h-2 rounded-full overflow-hidden">
            <div className="bg-blue-500 h-full w-3/4 rounded-full"></div>
          </div>
        </div>
      )}

      <button
        onClick={handleLogOut}
        title={collapsed ? 'Cerrar sesión' : undefined}
        aria-label="Cerrar sesión"
        className={`mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-semibold transition-all duration-200 border border-red-200 hover:border-red-300 ${
          collapsed ? 'mt-auto px-0' : 'px-4'
        }`}
      >
        <LogOut size={20} className="shrink-0" />
        {!collapsed && 'Cerrar sesión'}
      </button>
    </aside>
  );
}
