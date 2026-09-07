import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Settings,
  Users,
  Box,
  Wrench,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  X
} from 'lucide-react';
import logotipo from '../assets/ambientalia-logo.png';
import isotipo from '../assets/ambientalia-isotipo.png';
import { logout } from '../auth';
import { useAuth } from '../hooks/useAuth';
import { hasAssignedInCategory } from '../lib/apps';

// El estado plegado vive en localStorage y NO en el perfil del usuario a propósito:
// es una preferencia por dispositivo (plegada en el portátil, desplegada en el
// monitor grande), no algo que deba seguirte entre equipos.
const COLLAPSED_KEY = 'sidebar_collapsed';

/** Debe coincidir con la duración de la transición del panel (duration-200). */
const CIERRE_MS = 200;

interface Props {
  /**
   * Abre la navegación como panel deslizante. Solo aplica por debajo de `lg`,
   * que es donde la barra fija se oculta; en escritorio se ignora.
   */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

/**
 * Navegación del portal. Se pinta de dos formas con los MISMOS enlaces:
 *
 * - Escritorio (≥1024px): barra fija a la izquierda, plegable.
 * - Móvil/tablet (<1024px): panel deslizante sobre un fondo oscurecido, porque
 *   la barra fija no cabe. Sin esto el teléfono se quedaba SIN navegación
 *   ninguna —la barra era `hidden lg:flex` y nada la sustituía—, así que
 *   Aplicaciones y Herramientas eran inalcanzables desde el móvil.
 *
 * El panel solo se monta cuando está abierto. No es un detalle de rendimiento:
 * si ambas navegaciones coexistieran en el DOM, cada enlace saldría duplicado
 * —dos veces en el orden de tabulación, y dos veces para un lector de pantalla—
 * y las consultas por texto encontrarían dos nodos donde esperan uno.
 */
export default function Sidebar({ mobileOpen = false, onMobileClose }: Props) {
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

  // `montado` va por detrás de `mobileOpen` al cerrar para que dé tiempo a la
  // animación de salida; `visible` va por detrás al abrir para que el navegador
  // pinte primero la posición inicial y la transición se vea.
  const [montado, setMontado] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (mobileOpen) {
      setMontado(true);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const id = setTimeout(() => setMontado(false), CIERRE_MS);
    return () => clearTimeout(id);
  }, [mobileOpen]);

  // Con el panel abierto, Escape cierra y el fondo no debe hacer scroll: en un
  // móvil, arrastrar sobre el panel movería la página de debajo.
  useEffect(() => {
    if (!mobileOpen) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose?.();
    };
    document.addEventListener('keydown', alPulsar);
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', alPulsar);
      document.body.style.overflow = previo;
    };
  }, [mobileOpen, onMobileClose]);

  const isActive = (path: string) => location.pathname === path;

  const handleLogOut = async () => {
    onMobileClose?.();
    await logout();
    navigate('/auth');
  };

  // Plegada: el icono se centra y el texto desaparece; la etiqueta pasa al title
  // para que siga siendo identificable al pasar el ratón.
  const itemClass = (path: string, plegada: boolean) =>
    `nav-item w-full ${isActive(path) ? 'active' : ''} ${plegada ? 'justify-center px-0' : ''}`;

  /**
   * Enlaces + pie, compartidos por las dos presentaciones. `alNavegar` cierra el
   * panel al tocar un enlace: sin eso el panel taparía la página recién abierta.
   */
  const enlaces = (plegada: boolean, alNavegar?: () => void) => (
    <>
      <nav className="flex-grow space-y-2">
        <Link to="/" onClick={alNavegar} className={itemClass('/', plegada)} title={plegada ? 'Dashboard' : undefined}>
          <LayoutDashboard size={20} className="shrink-0" />
          {!plegada && 'Dashboard'}
        </Link>
        {showHerramientas && (
          <Link
            to="/herramientas"
            onClick={alNavegar}
            className={itemClass('/herramientas', plegada)}
            title={plegada ? 'Herramientas' : undefined}
          >
            <Wrench size={20} className="shrink-0" />
            {!plegada && 'Herramientas'}
          </Link>
        )}
        {showAplicaciones && (
          <Link
            to="/aplicaciones"
            onClick={alNavegar}
            className={itemClass('/aplicaciones', plegada)}
            title={plegada ? 'Aplicaciones' : undefined}
          >
            <Box size={20} className="shrink-0" />
            {!plegada && 'Aplicaciones'}
          </Link>
        )}
        {role === 'admin' && (
          <Link
            to="/admin/users"
            onClick={alNavegar}
            className={itemClass('/admin/users', plegada)}
            title={plegada ? 'Usuarios' : undefined}
          >
            <Users size={20} className="shrink-0" />
            {!plegada && 'Usuarios'}
          </Link>
        )}
        <button
          className={`nav-item w-full ${plegada ? 'justify-center px-0' : ''}`}
          title={plegada ? 'Ajustes' : undefined}
        >
          <Settings size={20} className="shrink-0" />
          {!plegada && 'Ajustes'}
        </button>
      </nav>

      <button
        onClick={handleLogOut}
        title={plegada ? 'Cerrar sesión' : undefined}
        aria-label="Cerrar sesión"
        className={`mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-semibold transition-all duration-200 border border-red-200 hover:border-red-300 ${
          plegada ? 'px-0' : 'px-4'
        }`}
      >
        <LogOut size={20} className="shrink-0" />
        {!plegada && 'Cerrar sesión'}
      </button>
    </>
  );

  return (
    <>
      {/* Escritorio: barra fija y plegable. */}
      <aside
        className={`bg-white border-r border-gray-200 flex flex-col hidden lg:flex transition-[width] duration-200 ease-out ${
          collapsed ? 'w-20 p-3' : 'w-72 p-6'
        }`}
      >
        <div className={`flex items-center mb-10 ${collapsed ? 'flex-col gap-3' : 'justify-between px-2'}`}>
          {/* El logotipo ya lleva la palabra «Ambientalia» dentro, así que no se
              acompaña de texto: duplicarlo se leería dos veces. Plegada solo cabe
              el isotipo (las barras), que es el mismo logo recortado sin la palabra.
              El `alt` da nombre accesible al enlace en ambos estados. */}
          <Link to="/" className="flex items-center overflow-hidden">
            <img
              src={collapsed ? isotipo : logotipo}
              alt="Portal Ambientalia"
              className={collapsed ? 'w-14 shrink-0' : 'h-12 w-auto shrink-0'}
            />
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

        {enlaces(collapsed)}
      </aside>

      {/* Móvil/tablet: panel deslizante. Nunca plegado — ahí el ancho sobra. */}
      {montado && (
        <div className="lg:hidden">
          <div
            onClick={onMobileClose}
            aria-hidden="true"
            className={`fixed inset-0 bg-black/40 z-40 transition-opacity duration-200 ${
              visible ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
            className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-white p-6 flex flex-col overflow-y-auto shadow-xl transition-transform duration-200 ease-out ${
              visible ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <div className="flex items-center justify-between mb-10 px-2">
              <Link to="/" onClick={onMobileClose} className="flex items-center overflow-hidden">
                <img src={logotipo} alt="Portal Ambientalia" className="h-12 w-auto shrink-0" />
              </Link>
              <button
                onClick={onMobileClose}
                aria-label="Cerrar menú"
                className="p-2 rounded-xl text-gray-400 hover:text-gray-900 hover:bg-gray-50 transition-colors shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            {enlaces(false, onMobileClose)}
          </aside>
        </div>
      )}
    </>
  );
}
