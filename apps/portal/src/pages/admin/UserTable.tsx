import type { AdminUser } from './types';
import UserStatusBadge from './UserStatusBadge';
import UserActionsMenu from './UserActionsMenu';

// Tabla de usuarios del panel admin: nombre, correo, estado (badge), fecha de
// registro y menú de acciones por fila.

export interface UserTableProps {
  users: AdminUser[];
  loading: boolean;
  currentUserId: string | null;
  onApprove: (u: AdminUser) => void;
  onDeactivate: (u: AdminUser) => void;
  onReactivate: (u: AdminUser) => void;
  onChangeRole: (u: AdminUser) => void;
  onDelete: (u: AdminUser) => void;
  onAssignApps?: (u: AdminUser) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function UserTable(props: UserTableProps) {
  const { users, loading, currentUserId } = props;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="px-6 py-3 font-medium">Nombre</th>
              <th className="px-6 py-3 font-medium">Correo</th>
              <th className="px-6 py-3 font-medium">Estado</th>
              <th className="px-6 py-3 font-medium">Registro</th>
              <th className="px-6 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-gray-400">Cargando…</td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-gray-400">No hay usuarios.</td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="px-6 py-3 text-gray-900">
                    {u.full_name}
                    {u.role === 'admin' && (
                      <span className="ml-2 text-xs text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded">admin</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-gray-600">{u.email}</td>
                  <td className="px-6 py-3"><UserStatusBadge status={u.status} /></td>
                  <td className="px-6 py-3 text-gray-500">{formatDate(u.created_at)}</td>
                  <td className="px-6 py-3 text-right">
                    <UserActionsMenu
                      user={u}
                      isSelf={currentUserId != null && u.id === currentUserId}
                      onApprove={props.onApprove}
                      onDeactivate={props.onDeactivate}
                      onReactivate={props.onReactivate}
                      onChangeRole={props.onChangeRole}
                      onDelete={props.onDelete}
                      onAssignApps={props.onAssignApps}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
