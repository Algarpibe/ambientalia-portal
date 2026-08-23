// Auth del portal (SEC-001/SEC-003). El token JWT lo emite hub-api en /api/login.
// Se guarda en localStorage (mismo origen que las sub-apps → lo comparten).
const TOKEN_KEY = 'ambientalia_token';

export const API_BASE = import.meta.env.VITE_HUB_API_URL as string | undefined;

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string): void => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

/**
 * Cierra la sesión de verdad (SEC-220): avisa al backend, que invalida TODOS
 * los tokens vivos del usuario, y después borra el local.
 *
 * El borrado local va en `finally` a propósito. Si la llamada falla —sin red,
 * backend caído, token ya expirado— el usuario TIENE que salir igual: dejarlo
 * dentro porque el servidor no contesta sería la peor manera de fallar. Lo que
 * se pierde en ese caso es la invalidación remota, no la salida.
 *
 * No se usa en el manejador de 401 de AdminUsers: allí el token ya no vale y
 * llamar al endpoint solo añadiría otro 401.
 */
export async function logout(): Promise<void> {
  try {
    const token = getToken();
    if (API_BASE && token) {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch {
    // Silencioso: ver el porqué en el JSDoc.
  } finally {
    clearToken();
  }
}

/** True si hay token y no está expirado (lectura del `exp` del JWT, sin verificar firma — solo para gating de UX). */
export function isAuthenticated(): boolean {
  const t = getToken();
  if (!t) return false;
  try {
    const payload = JSON.parse(atob(t.split('.')[1] || ''));
    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}
