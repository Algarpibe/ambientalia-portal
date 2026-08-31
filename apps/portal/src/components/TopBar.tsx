import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, LogOut, Menu } from 'lucide-react';
import { logout as cerrarSesion } from '../auth';
import { useProfile } from '../hooks/useProfile';
import Avatar from './Avatar';

interface Props {
  /** Abre la navegación en móvil, donde la barra lateral fija está oculta. */
  onOpenMenu?: () => void;
  menuOpen?: boolean;
}

// Barra superior con el avatar del usuario y su menú desplegable (nombre, email,
// Perfil → /configuracion, Cerrar sesión). Por debajo de `lg` es además el único
// sitio desde donde se alcanza la navegación, vía el botón de menú.
export default function TopBar({ onOpenMenu, menuOpen = false }: Props) {
  const { profile } = useProfile();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const logout = async () => {
    await cerrarSesion();
    navigate('/auth');
  };

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-end px-6 shrink-0">
      {/* `mr-auto` empuja el avatar a la derecha sin tocar el `justify-end`: en
          escritorio este botón no existe y el avatar sigue donde estaba. */}
      <button
        onClick={onOpenMenu}
        aria-label="Abrir menú de navegación"
        aria-expanded={menuOpen}
        className="lg:hidden mr-auto -ml-2 p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors">
        <Menu size={22} />
      </button>

      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Menú de usuario"
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center rounded-full ring-2 ring-transparent hover:ring-blue-100 transition">
          <Avatar src={profile?.avatar} name={profile?.full_name} size={40} />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div role="menu" className="absolute right-0 top-12 z-50 w-64 bg-white border border-gray-200 rounded-xl shadow-xl py-1">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="font-semibold text-gray-900 text-sm">{profile?.full_name ?? '—'}</p>
                <p className="text-gray-500 text-xs truncate">{profile?.email ?? ''}</p>
              </div>
              <Link
                to="/configuracion"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                <User className="w-4 h-4" /> Perfil
              </Link>
              <button
                onClick={logout}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">
                <LogOut className="w-4 h-4" /> Cerrar sesión
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
