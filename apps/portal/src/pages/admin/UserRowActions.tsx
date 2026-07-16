import { CheckCircle2, XCircle, RefreshCw, Trash2, LayoutGrid, UserCog, ChevronDown } from 'lucide-react';
import type { AdminUser, UserRole } from './types';

// Acciones inline por fila (sin menú ⋮), según estado del usuario (Req 2.2, 2.3,
// 2.5, 2.6, 3.2). En la propia cuenta del admin se ocultan Desactivar, Eliminar
// y el selector de rol (Req 2.7); "Asignar apps" sigue disponible para poder
// auto-asignarse aplicaciones.

export interface UserRowActionsProps {
  user: AdminUser;
  isSelf: boolean;
  onApprove: (u: AdminUser) => void;
  onDeactivate: (u: AdminUser) => void;
  onReactivate: (u: AdminUser) => void;
  onChangeRole: (u: AdminUser, role: UserRole) => void;
  onDelete: (u: AdminUser) => void;
  onAssignApps: (u: AdminUser) => void;
}

const textBtn = 'inline-flex items-center gap-1.5 text-sm font-medium transition-colors';

export default function UserRowActions(props: UserRowActionsProps) {
  const { user, isSelf } = props;

  return (
    <div className="flex items-center justify-end gap-3">
      {/* Aprobar (pending) */}
      {user.status === 'pending' && (
        <button onClick={() => props.onApprove(user)} className={`${textBtn} text-green-600 hover:text-green-700`}>
          <CheckCircle2 className="w-4 h-4" /> Aprobar
        </button>
      )}

      {/* Reactivar (inactive) */}
      {user.status === 'inactive' && (
        <button onClick={() => props.onReactivate(user)} className={`${textBtn} text-green-600 hover:text-green-700`}>
          <RefreshCw className="w-4 h-4" /> Reactivar
        </button>
      )}

      {/* Asignar apps (active) — disponible también en la propia cuenta */}
      {user.status === 'active' && (
        <button
          onClick={() => props.onAssignApps(user)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
          <LayoutGrid className="w-4 h-4 text-gray-400" /> Asignar apps
        </button>
      )}

      {/* Selector de rol (active, no en la propia cuenta) */}
      {user.status === 'active' && !isSelf && (
        <div className="relative inline-flex items-center gap-2 border border-gray-200 rounded-lg pl-2.5 pr-7 py-1.5 text-gray-700">
          <UserCog className="w-4 h-4 text-gray-400 shrink-0" />
          <select
            aria-label="Cambiar rol"
            value={user.role}
            onChange={(e) => props.onChangeRole(user, e.target.value as UserRole)}
            className="appearance-none bg-transparent text-sm focus:outline-none cursor-pointer min-w-[8rem]">
            <option value="reader">Lector</option>
            <option value="admin">Administrador</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 pointer-events-none absolute right-2" />
        </div>
      )}

      {/* Desactivar (active, no en la propia cuenta) */}
      {user.status === 'active' && !isSelf && (
        <button onClick={() => props.onDeactivate(user)} className={`${textBtn} text-gray-600 hover:text-gray-900`}>
          <XCircle className="w-4 h-4" /> Desactivar
        </button>
      )}

      {/* Eliminar (cualquier estado, no en la propia cuenta) */}
      {!isSelf && (
        <button
          onClick={() => props.onDelete(user)}
          aria-label="Eliminar usuario"
          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
