import { authHeaders } from '@suite/auth-client';
import { mensajeDeError } from '@suite/http';
import { API_BASE, get, patch, post } from './http';
import type { CambioNota, Nota, NotaNueva } from './tipos';

// Las notas personales del administrador. Las cinco rutas contestan 403 a quien
// no lo sea, y ese 403 es el candado de verdad (requireAdmin en hub-api).

const ruta = (id: string) => `/api/ausencias/notas/${encodeURIComponent(id)}`;

export const fetchNotas = () => get<{ notas: Nota[] }>('/api/ausencias/notas').then((d) => d.notas);

export const crearNota = (n: NotaNueva) => post<Nota>('/api/ausencias/notas', n);

export const editarNota = (id: string, c: CambioNota) => patch<Nota>(ruta(id), c);

export async function borrarNota(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}${ruta(id)}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}

/**
 * La imagen como URL de objeto, lista para un `<img>`. La ruta pide el token, así
 * que no vale un `src` directo. Quien la pide tiene que revocarla al soltarla.
 */
export async function urlDeImagenDeNota(id: string): Promise<string> {
  const res = await fetch(`${API_BASE}${ruta(id)}/imagen`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return URL.createObjectURL(await res.blob());
}
