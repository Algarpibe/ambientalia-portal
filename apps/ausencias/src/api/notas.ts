import { authHeaders } from '@suite/auth-client';
import { API_BASE, conCuerpo, errorGenerico, get } from './http';
import type { CambioNota, Nota, NuevaNota } from './tipos';

// Las notas personales del administrador. Las cinco rutas contestan 403 a quien
// no lo sea, y ese 403 es el candado de verdad (requireAdmin en hub-api).

const ruta = (id: string) => `/api/ausencias/notas/${encodeURIComponent(id)}`;

/**
 * Como `errorGenerico`, pero un 404 conserva su código. `mensajeDeError`
 * (@suite/http) convierte todo 404 en «No se pudieron cargar los datos», y aquí
 * un 404 dice algo distinto según el caso (nota borrada desde otra pestaña,
 * ficha dada de baja, imagen ausente) que `textoDeErrorDeNota` sabe poner en
 * palabras. Cualquier otro fallo sale como siempre.
 */
async function errorDeNota(res: Response): Promise<Error> {
  if (res.status === 404) {
    const cuerpo = (await res
      .clone()
      .json()
      .catch(() => null)) as { error?: unknown } | null;
    if (typeof cuerpo?.error === 'string') return new Error(cuerpo.error);
  }
  return errorGenerico(res);
}

export const fetchNotas = () => get<{ notas: Nota[] }>('/api/ausencias/notas').then((d) => d.notas);

export const crearNota = (n: NuevaNota) => conCuerpo<Nota>('POST', '/api/ausencias/notas', n, errorDeNota);

export const editarNota = (id: string, c: CambioNota) => conCuerpo<Nota>('PATCH', ruta(id), c, errorDeNota);

export async function borrarNota(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}${ruta(id)}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw await errorDeNota(res);
}

/**
 * La imagen como URL de objeto, lista para un `<img>`. La ruta pide el token, así
 * que no vale un `src` directo. Quien la pide tiene que revocarla al soltarla.
 */
export async function urlDeImagenDeNota(id: string): Promise<string> {
  const res = await fetch(`${API_BASE}${ruta(id)}/imagen`, { headers: authHeaders() });
  if (!res.ok) throw await errorDeNota(res);
  return URL.createObjectURL(await res.blob());
}
