import { API_BASE, getToken } from '../auth';

// Helper de fetch autenticado hacia hub-api. Antepone API_BASE, añade el header
// Authorization: Bearer <jwt> y Content-Type JSON cuando hay body. El manejo de
// estados (401, errores) queda a cargo del llamante.
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!API_BASE) throw new Error('VITE_HUB_API_URL no configurado');
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}
