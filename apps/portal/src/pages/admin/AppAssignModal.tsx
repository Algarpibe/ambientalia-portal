import { useEffect, useState } from 'react';
import { authFetch } from '../../lib/api';
import { notify } from '../../lib/notify';
import { APPS } from '../../lib/apps';
import type { AdminUser } from './types';

// Modal de asignación de aplicaciones (Req 4.2). Precarga las apps actuales del
// usuario (GET /api/users/:id/apps) y, al confirmar, las reemplaza
// (PUT /api/users/:id/apps).

export interface AppAssignModalProps {
  user: AdminUser;
  onClose: () => void;
  onSaved: () => void;
}

export default function AppAssignModal({ user, onClose, onSaved }: AppAssignModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await authFetch(`/api/users/${user.id}/apps`);
        if (!res.ok) {
          notify('No se pudieron cargar las apps del usuario.', 'error');
          return;
        }
        const data = await res.json();
        if (active) setSelected(new Set(Array.isArray(data.apps) ? data.apps : []));
      } catch {
        notify('No se pudo conectar con el servidor.', 'error');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user.id]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/users/${user.id}/apps`, {
        method: 'PUT',
        body: JSON.stringify({ apps: [...selected] }),
      });
      if (!res.ok) {
        notify('No se pudieron guardar las apps.', 'error');
        return;
      }
      notify('Aplicaciones actualizadas.', 'info');
      onSaved();
      onClose();
    } catch {
      notify('No se pudo conectar con el servidor.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Asignar aplicaciones</h2>
          <p className="text-sm text-gray-500">
            {user.full_name} · {user.email}
          </p>
        </div>

        <div className="px-6 py-4 max-h-80 overflow-y-auto">
          {loading ? (
            <p className="text-gray-400 py-6 text-center">Cargando…</p>
          ) : (
            APPS.map((app) => (
              <label key={app.id} className="flex items-center gap-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(app.id)}
                  onChange={() => toggle(app.id)}
                  className="w-4 h-4 accent-cyan-500"
                />
                <span className="text-sm text-gray-800">{app.label}</span>
              </label>
            ))
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="px-4 py-2 text-sm rounded-lg bg-cyan-500 text-white font-semibold hover:bg-cyan-600 disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
