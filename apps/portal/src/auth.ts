// Auth del portal (SEC-001/SEC-003). El token JWT lo emite hub-api en /api/login.
// Se guarda en localStorage (mismo origen que las sub-apps → lo comparten).
const TOKEN_KEY = 'ambientalia_token';

export const API_BASE = import.meta.env.VITE_HUB_API_URL as string | undefined;

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string): void => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

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
