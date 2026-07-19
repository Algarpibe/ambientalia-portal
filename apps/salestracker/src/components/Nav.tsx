import { NavLink } from 'react-router-dom';
const link = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium ${isActive ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`;
export default function Nav() {
  return (
    <nav className="flex gap-2 px-8 py-3 border-b bg-white">
      <NavLink to="." end className={link}>Inicio</NavLink>
      <NavLink to="articulos" className={link}>Artículos</NavLink>
      <NavLink to="clientes" className={link}>Clientes</NavLink>
    </nav>
  );
}
