import { NavLink } from 'react-router-dom';
import { APP_BASE } from '../appBase';

const link = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium ${isActive ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`;

// Enlaces ABSOLUTOS (ver appBase.ts): estables sea cual sea la página actual.
export default function Nav() {
  return (
    <nav className="flex gap-2 px-8 py-3 border-b bg-white">
      <NavLink to={APP_BASE} end className={link}>Inicio</NavLink>
      <NavLink to={`${APP_BASE}/articulos`} className={link}>Artículos</NavLink>
      <NavLink to={`${APP_BASE}/clientes`} className={link}>Clientes</NavLink>
      <NavLink to={`${APP_BASE}/cliente-articulo`} className={link}>Cliente × Artículo</NavLink>
    </nav>
  );
}
