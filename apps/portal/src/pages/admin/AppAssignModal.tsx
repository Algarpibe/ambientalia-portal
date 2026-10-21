import { useEffect, useState } from 'react';
import { authFetch } from '../../lib/api';
import { notify } from '../../lib/notify';
import { APPS } from '../../lib/apps';
import { useDialogo } from '../../lib/useDialogo';
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
  // FE-411 — si la precarga falla, `selected` se queda vacío. Guardar con eso
  // manda `PUT apps: []` y deja al usuario sin ninguna app, así que con la
  // carga fallida no se pinta la selección ni se deja guardar.
  const [loadError, setLoadError] = useState(false);
  // FE-419 — foco, Escape y vuelta del foco. Con el PUT en vuelo Escape no
  // cierra, igual que Cancelar está deshabilitado.
  const { ref: refDialogo, idTitulo } = useDialogo({ onCerrar: onClose, bloqueado: saving });

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await authFetch(`/api/users/${user.id}/apps`);
        if (!res.ok) {
          notify('No se pudieron cargar las apps del usuario.', 'error');
          if (active) setLoadError(true);
          return;
        }
        const data = await res.json();
        // Una respuesta sin la lista es otra forma de no saber qué tenía: no
        // se convierte en «ninguna app».
        if (!Array.isArray(data?.apps)) {
          notify('No se pudieron cargar las apps del usuario.', 'error');
          if (active) setLoadError(true);
          return;
        }
        if (active) setSelected(new Set(data.apps));
      } catch {
        notify('No se pudo conectar con el servidor.', 'error');
        if (active) setLoadError(true);
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
      <div
        ref={refDialogo}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className="bg-white rounded-xl shadow-xl w-full max-w-md focus:outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 id={idTitulo} className="text-lg font-bold text-gray-900">Asignar aplicaciones</h2>
          <p className="text-sm text-gray-500">
            {user.full_name} · {user.email}
          </p>
        </div>

        <div className="px-6 py-4 max-h-80 overflow-y-auto">
          {loading ? (
            <p className="text-gray-400 py-6 text-center">Cargando…</p>
          ) : loadError ? (
            <p className="text-red-600 py-6 text-center text-sm">
              No se pudieron cargar las apps actuales del usuario. Cierra y vuelve a intentarlo.
            </p>
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
            disabled={saving || loading || loadError}
            className="px-4 py-2 text-sm rounded-lg bg-cyan-500 text-white font-semibold hover:bg-cyan-600 disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
