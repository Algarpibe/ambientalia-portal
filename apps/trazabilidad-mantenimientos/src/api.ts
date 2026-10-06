/** Cliente HTTP de la API de Trazabilidad (hub-api, `/api/trazabilidad/*`). */
import { authHeaders } from '@suite/auth-client';
import type { ContactoCliente, EquipoVista, EstadoDesk, FilaImportada, PlazoServicio, ResumenImportacion, RolEstado, Seguimiento, ServicioVista, TipoServicioOpcion } from './dominio';
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
  /** Los contactos puestos a mano a clientes: ganan al contacto de Desk de sus equipos. */
  contactos: ContactoCliente[];
}

/** Tickets de Desk sin cerrar, con su plazo calculado en el servidor (pausas de standby y trabajo terminado incluidos). */
export interface Servicios {
  hoy: string;
  servicios: ServicioVista[];
  /** Festivos del tramo que puede pintar el calendario de barras. */
  festivos: string[];
  /** Los tipos de servicio que se pueden elegir a mano para un ticket, en el orden de Configuracion. */
  tipos: TipoServicioOpcion[];
}

export const api = {
  inventario: () => request<Inventario>('GET', '/equipos'),
  /**
   * Pone a mano el contacto de un cliente (`emails` vacío = quitarlo y volver al de Desk). Devuelve el inventario ya
   * actualizado. Sólo guarda a quién se le escribiría: la app no envía correos (el aviso automático es una simulación).
   */
  guardarContacto: (cliente: string, emails: string[], nombre: string) => request<Inventario>('PUT', '/contactos', { cliente, emails, nombre }),
  servicios: () => request<Servicios>('GET', '/servicios'),
  /** Pone a mano el tipo de servicio de un ticket (null = quitarlo). Devuelve los servicios ya recalculados. */
  fijarTipoServicio: (numero: number, tipo: string | null) => request<Servicios>('PUT', `/servicios/${numero}/tipo`, { tipo }),
  plazos: () => request<{ plazos: PlazoServicio[] }>('GET', '/plazos'),
  guardarPlazo: (tipo: string, dias: number | null) => request<{ plazos: PlazoServicio[] }>('PUT', '/plazos', { tipo, dias }),
  /** Los estados de Desk con su rol en el reloj del plazo (bloque «Estados de Desk» de Configuracion). */
  estados: () => request<{ estados: EstadoDesk[] }>('GET', '/estados'),
  /** Elige el rol de un estado de Desk: cuenta, standby (reloj en pausa) o terminado (reloj parado). Devuelve la lista entera ya actualizada. */
  guardarEstado: (estado: string, rol: RolEstado) => request<{ estados: EstadoDesk[] }>('PUT', '/estados', { estado, rol }),
  simularImportacion: (archivo: string, filas: FilaImportada[]) =>
    request<ResumenImportacion>('POST', '/importaciones?simular=1', { archivo, filas }),
  importar: (archivo: string, filas: FilaImportada[]) => request<ResumenImportacion>('POST', '/importaciones', { archivo, filas }),
  guardarSeguimiento: (clave: string, s: Seguimiento) =>
    request<{ ok: true }>('PUT', `/seguimiento/${encodeURIComponent(clave)}`, s),
  registrarAvisos: (claves: string[], fecha: string) => request<{ actualizados: number }>('POST', '/avisos', { claves, fecha }),
};
