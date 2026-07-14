import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../lib/api';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'reader';
  status: string;
  created_at: string;
  avatar: string | null;
}

// Evento global para que la barra superior refresque el avatar/nombre tras
// editarlos en la página de Configuración.
export const PROFILE_UPDATED = 'profile-updated';
export function notifyProfileUpdated(): void {
  window.dispatchEvent(new Event(PROFILE_UPDATED));
}

/** Carga el perfil propio (GET /api/users/me) y lo recarga ante PROFILE_UPDATED. */
export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await authFetch('/api/users/me');
      if (res.ok) setProfile(await res.json());
    } catch {
      /* silencioso: la barra usa iniciales si no hay perfil */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const onUpdate = () => reload();
    window.addEventListener(PROFILE_UPDATED, onUpdate);
    return () => window.removeEventListener(PROFILE_UPDATED, onUpdate);
  }, [reload]);

  return { profile, loading, reload };
}
