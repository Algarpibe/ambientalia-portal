import { useEffect, useState } from 'react';
import { getToken } from '../auth';

// Hook de sesión del Portal. Lee el JWT de localStorage (clave ambientalia_token
// vía getToken) y decodifica su payload SIN verificar la firma — solo para gating
// de UX (rol, apps asignadas). El backend siempre re-valida.

export type UserRole = 'admin' | 'reader';

export interface AuthState {
  isAuthenticated: boolean;
  user_id: string | null;
  email: string | null;
  role: UserRole | null;
  apps: string[];
}

const EMPTY: AuthState = { isAuthenticated: false, user_id: null, email: null, role: null, apps: [] };

/** Devuelve un array de strings; [] si el valor no es un array o trae no-strings (Req 4.6). */
function sanitizeApps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is string => typeof a === 'string');
}

/**
 * Decodifica el estado de sesión desde el JWT actual. Estado vacío
 * (isAuthenticated:false, apps:[]) si el token está ausente, expirado o
 * malformado. `apps` malformado → [].
 */
export function readAuthState(): AuthState {
  const token = getToken();
  if (!token) return EMPTY;
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || ''));
    // Coherente con auth.isAuthenticated: exige exp numérico y no expirado.
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return EMPTY;
    const role: UserRole | null = payload.role === 'admin' || payload.role === 'reader' ? payload.role : null;
    return {
      isAuthenticated: true,
      user_id: typeof payload.user_id === 'string' ? payload.user_id : null,
      email: typeof payload.sub === 'string' ? payload.sub : null,
      role,
      apps: sanitizeApps(payload.apps),
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Hook reactivo: recalcula el estado ante cambios de localStorage (p.ej. login
 * en otra pestaña). En la misma pestaña, el login navega/re-monta y el estado
 * se recomputa al inicializarse.
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(readAuthState);
  useEffect(() => {
    const update = () => setState(readAuthState());
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);
  return state;
}
