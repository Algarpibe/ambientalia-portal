// Preferencias de UI guardadas en el PERFIL del usuario (hub-api), no en el
// navegador: así el orden y la visibilidad de las columnas siguen al usuario entre
// navegadores y equipos.
//
// El localStorage se mantiene como caché local para pintar al instante sin esperar
// a la red (y para no perder nada si el hub no responde), pero la fuente de verdad
// es el servidor: cuando su respuesta llega, manda ella.

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;
const PREF_KEY = 'inventoryColumns'; // clave propia dentro del blob del perfil

const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

/** Config de columnas del análisis: orden y visibilidad, por pestaña. */
export interface ColumnPrefs {
  order?: Record<string, { key: string; label: string }[]>;
  visibility?: Record<string, string[]>;
}

/**
 * Lee las preferencias del perfil. Devuelve null si no hay ninguna guardada o si
 * el hub no responde — el llamante se queda entonces con la caché local.
 */
export async function fetchColumnPrefs(): Promise<ColumnPrefs | null> {
  if (!API_BASE) return null;
  try {
    const res = await fetch(`${API_BASE}/api/users/me/preferences`, { headers: authHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    const prefs = data?.preferences?.[PREF_KEY];
    return prefs && typeof prefs === 'object' ? (prefs as ColumnPrefs) : null;
  } catch {
    return null; // sin conexión con el hub: se sigue con lo local
  }
}

/**
 * Guarda las preferencias en el perfil. Es un PATCH que fusiona, así que solo pisa
 * la clave de esta app. Los errores no se propagan: perder la sincronización no
 * debe romper la tabla (la caché local ya tiene el cambio).
 */
export async function saveColumnPrefs(prefs: ColumnPrefs): Promise<void> {
  if (!API_BASE) return;
  try {
    await fetch(`${API_BASE}/api/users/me/preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ [PREF_KEY]: prefs }),
    });
  } catch {
    // idem: silencioso a propósito
  }
}
