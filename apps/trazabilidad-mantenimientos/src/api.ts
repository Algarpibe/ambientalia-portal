/** Cliente HTTP de la API de Trazabilidad (hub-api, `/api/trazabilidad/*`). */
import { authHeaders } from '@suite/auth-client';
import type { EquipoVista, FilaImportada, ResumenImportacion, Seguimiento } from './dominio';
import { errorFromResponse } from './lib/apiError';

const API_BASE = `${(import.meta.env.VITE_HUB_API_URL as string | undefined) ?? ''}/api/trazabilidad`;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...authHeaders() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw errorFromResponse(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

export interface Inventario {
  hoy: string;
  equipos: EquipoVista[];
  ultimaImportacion: ResumenImportacion | null;
}

export const api = {
  inventario: () => request<Inventario>('GET', '/equipos'),
  simularImportacion: (archivo: string, filas: FilaImportada[]) =>
    request<ResumenImportacion>('POST', '/importaciones?simular=1', { archivo, filas }),
  importar: (archivo: string, filas: FilaImportada[]) => request<ResumenImportacion>('POST', '/importaciones', { archivo, filas }),
  guardarSeguimiento: (clave: string, s: Seguimiento) =>
    request<{ ok: true }>('PUT', `/seguimiento/${encodeURIComponent(clave)}`, s),
  registrarAvisos: (claves: string[], fecha: string) => request<{ actualizados: number }>('POST', '/avisos', { claves, fecha }),
};
