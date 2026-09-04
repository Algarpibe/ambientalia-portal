// @suite/auth-client — lectura de la sesión del portal desde las sub-apps
// (cierra AI-610 y AI-612). El portal (apps/portal/src/auth.ts) es quien ESCRIBE
// el token en localStorage; las sub-apps solo lo LEEN para autenticar sus
// llamadas al hub-api. Antes cada app reescribía authHeaders()/esAdmin().

/** Clave del JWT en localStorage. Debe coincidir con apps/portal/src/auth.ts. */
export const TOKEN_KEY = 'ambientalia_token';

/** JWT actual del portal, o null si no hay sesión. */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** Cabecera `Authorization: Bearer <jwt>` para fetch al hub-api. `{}` si no hay token. */
export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * True si el JWT actual tiene `role === 'admin'`. Decodifica el payload SIN
 * verificar la firma: es solo para UX (mostrar/ocultar controles de admin). La
 * autorización real la impone el backend (requireAdmin/requireApp).
 */
export function esAdmin(): boolean {
  const t = getToken();
  if (!t) return false;
  try {
    return (JSON.parse(atob(t.split('.')[1] || '')) as { role?: string }).role === 'admin';
  } catch {
    return false;
  }
}

/**
 * `user_id` del JWT actual, o null si no hay sesión. Decodifica el payload SIN
 * verificar la firma: sirve para acotar preferencias de UI por usuario (p. ej. la
 * clave de localStorage donde cada uno guarda su configuración de columnas), NO
 * para autorizar nada — eso lo impone el backend.
 */
export function getUserId(): string | null {
  const t = getToken();
  if (!t) return null;
  try {
    const p = JSON.parse(atob(t.split('.')[1] || '')) as { user_id?: unknown };
    return p.user_id != null ? String(p.user_id) : null;
  } catch {
    return null;
  }
}
