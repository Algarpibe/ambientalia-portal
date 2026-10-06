/** Cliente HTTP de la API de Trazabilidad (hub-api, `/api/trazabilidad/*`). */
import { authHeaders } from '@suite/auth-client';
import type { EquipoVista, FilaImportada, PlazoServicio, ResumenImportacion, Seguimiento, ServicioVista } from './dominio';
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

/** Tickets de Desk sin cerrar, con su plazo calculado en el servidor. */
export interface Servicios {
  hoy: string;
  servicios: ServicioVista[];
  /** Festivos del tramo que puede pintar el calendario de barras. */
  festivos: string[];
}

export const api = {
  inventario: () => request<Inventario>('GET', '/equipos'),
  servicios: () => request<Servicios>('GET', '/servicios'),
  plazos: () => request<{ plazos: PlazoServicio[] }>('GET', '/plazos'),
  guardarPlazo: (tipo: string, dias: number | null) => request<{ plazos: PlazoServicio[] }>('PUT', '/plazos', { tipo, dias }),
  simularImportacion: (archivo: string, filas: FilaImportada[]) =>
    request<ResumenImportacion>('POST', '/importaciones?simular=1', { archivo, filas }),
  importar: (archivo: string, filas: FilaImportada[]) => request<ResumenImportacion>('POST', '/importaciones', { archivo, filas }),
  guardarSeguimiento: (clave: string, s: Seguimiento) =>
    request<{ ok: true }>('PUT', `/seguimiento/${encodeURIComponent(clave)}`, s),
  registrarAvisos: (claves: string[], fecha: string) => request<{ actualizados: number }>('POST', '/avisos', { claves, fecha }),
};
