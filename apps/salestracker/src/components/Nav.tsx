import { NavLink } from 'react-router-dom';
import { APP_BASE } from '../appBase';

const link = ({ isActive }: { isActive: boolean }) =>
  `st-nav-link${isActive ? ' is-active' : ''}`;

// Enlaces ABSOLUTOS (ver appBase.ts): estables sea cual sea la página actual.
export default function Nav() {
  return (
    <nav className="st-nav">
      <NavLink to={APP_BASE} end className={link}>Inicio</NavLink>
      <NavLink to={`${APP_BASE}/articulos`} className={link}>Artículos</NavLink>
      <NavLink to={`${APP_BASE}/tablas`} className={link}>Tablas</NavLink>
      <NavLink to={`${APP_BASE}/clientes`} className={link}>Clientes</NavLink>
      <NavLink to={`${APP_BASE}/cliente-articulo`} className={link}>Cliente × Artículo</NavLink>
      <NavLink to={`${APP_BASE}/analisis`} className={link}>Análisis</NavLink>
      <NavLink to={`${APP_BASE}/categorias`} className={link}>Categorías</NavLink>
    </nav>
  );
}
