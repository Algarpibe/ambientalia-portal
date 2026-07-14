import type { UserRole } from './types';

// Badge de rol: Administrador (azul relleno) / Lector (gris).
export default function UserRoleBadge({ role }: { role: UserRole }) {
  const isAdmin = role === 'admin';
  return (
    <span
      className={
        'inline-block px-3 py-1 rounded-full text-xs font-medium ' +
        (isAdmin ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700')
      }>
      {isAdmin ? 'Administrador' : 'Lector'}
    </span>
  );
}
