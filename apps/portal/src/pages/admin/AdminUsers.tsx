import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Users } from 'lucide-react';
import { authFetch } from '../../lib/api';
import { clearToken } from '../../auth';
import { notify } from '../../lib/notify';
import { useAuth } from '../../hooks/useAuth';
import type { AdminUser, PaginatedUsers, UserRole } from './types';
import UserTable from './UserTable';
import AppAssignModal from './AppAssignModal';

// Página principal del Panel de Administración (Req 2.1). Carga la lista de
// usuarios paginada (50/página) y expone las acciones de gestión por fila
// (aprobar/desactivar/reactivar/cambiar rol/eliminar), refrescando tras cada
// mutación. La asignación de apps (modal) se añade en la tarea 15.3.

const PAGE_SIZE = 50;

/** Mensaje de error legible según el HTTP y el código devuelto por el backend. */
function errorMessage(status: number, code?: string): string {
  if (code === 'cannot_modify_own_account') return 'No puedes modificar tu propia cuenta.';
  if (status === 404) return 'El usuario ya no existe.';
  if (status === 429) return 'Demasiadas peticiones. Espera un momento.';
  if (status === 401) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  if (status === 403) return 'No tienes permisos para esta acción.';
  return 'No se pudo completar la acción.';
}

export default function AdminUsers() {
  const { user_id } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [appsUser, setAppsUser] = useState<AdminUser | null>(null);

  // Req 5.6: sesión expirada dentro del panel → limpiar token y volver a /auth
  // sin aplicar ninguna mutación pendiente (el backend ya la rechazó con 401).
  const handleExpiredSession = useCallback(() => {
    clearToken();
    notify('Tu sesión expiró. Vuelve a iniciar sesión.', 'error');
    navigate('/auth', { replace: true });
  }, [navigate]);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setError('');
      try {
        const res = await authFetch(`/api/users?page=${p}&limit=${PAGE_SIZE}`);
        if (res.status === 401) {
          handleExpiredSession();
          return;
        }
        if (!res.ok) {
          setError('No se pudo cargar la lista de usuarios.');
          return;
        }
        const data: PaginatedUsers = await res.json();
        setUsers(Array.isArray(data.users) ? data.users : []);
        setTotal(typeof data.total === 'number' ? data.total : 0);
        setPage(typeof data.page === 'number' ? data.page : p);
      } catch {
        setError('No se pudo conectar con el servidor.');
      } finally {
        setLoading(false);
      }
    },
    [handleExpiredSession],
  );

  useEffect(() => {
    load(page);
  }, [page, load]);

  /** Ejecuta una mutación, notifica el resultado y refresca la lista. */
  const act = useCallback(
    async (req: () => Promise<Response>, okMsg: string) => {
      try {
        const res = await req();
        if (res.status === 401) {
          handleExpiredSession();
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          notify(errorMessage(res.status, (body as { error?: string })?.error), 'error');
          return;
        }
        notify(okMsg, 'info');
        await load(page);
      } catch {
        notify('No se pudo conectar con el servidor.', 'error');
      }
    },
    [load, page, handleExpiredSession],
  );

  const changeStatus = (u: AdminUser, status: 'active' | 'inactive', okMsg: string) =>
    act(() => authFetch(`/api/users/${u.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }), okMsg);

  const handleApprove = (u: AdminUser) => changeStatus(u, 'active', 'Usuario aprobado.');
  const handleReactivate = (u: AdminUser) => changeStatus(u, 'active', 'Usuario reactivado.');
  const handleDeactivate = (u: AdminUser) => changeStatus(u, 'inactive', 'Usuario desactivado.');

  const handleChangeRole = (u: AdminUser, role: UserRole) => {
    if (role === u.role) return;
    act(() => authFetch(`/api/users/${u.id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }), 'Rol actualizado.');
  };

  const handleDelete = (u: AdminUser) => {
    if (!window.confirm(`¿Eliminar permanentemente a ${u.email}? Esta acción no se puede deshacer.`)) return;
    act(() => authFetch(`/api/users/${u.id}`, { method: 'DELETE' }), 'Usuario eliminado.');
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex-grow bg-[#F7F8FA] p-8">
      <div className="w-full">
        {/* Cabecera */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Gestión de Usuarios</h1>
            <p className="text-gray-500 mt-1">Aprueba o desactiva el acceso de los usuarios a la plataforma.</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
            <Users className="w-5 h-5" />
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
        )}

        {/* Card: Lista de Usuarios */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/60">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-semibold text-gray-900">Lista de Usuarios</h2>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {total} usuario{total === 1 ? '' : 's'} registrado{total === 1 ? '' : 's'} en total.
            </p>
          </div>

          <UserTable
            users={users}
            loading={loading}
            currentUserId={user_id}
            onApprove={handleApprove}
            onDeactivate={handleDeactivate}
            onReactivate={handleReactivate}
            onChangeRole={handleChangeRole}
            onDelete={handleDelete}
            onAssignApps={setAppsUser}
          />
        </div>

        {appsUser && (
          <AppAssignModal
            user={appsUser}
            onClose={() => setAppsUser(null)}
            onSaved={() => load(page)}
          />
        )}

        {/* Paginación */}
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-gray-500">Página {page} de {totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={loading || page <= 1}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50">
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={loading || page >= totalPages}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50">
              Siguiente
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
