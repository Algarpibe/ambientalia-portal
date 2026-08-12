import { authHeaders, esAdmin } from '@suite/auth-client';
import { mensajeDeError } from '@suite/http';

export { esAdmin };

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

// Espejo de apps/hub-api/src/ausencias/types.ts. Si cambia allí, cambia aquí.

export type TipoSolicitud = 'vacaciones' | 'permiso' | 'compensatorio' | 'incapacidad';
export type EstadoSolicitud = 'pendiente' | 'aprobada' | 'rechazada' | 'registrada';

export interface Empleado {
  id: string;
  nombreCompleto: string;
  correo: string;
  cargo: string | null;
  credencial: number | null;
  aprobadorCorreo: string;
  userId: string | null;
  activo: boolean;
}

export interface Adjunto {
  id: string;
  nombreArchivo: string;
  mime: string;
  bytes: number;
  driveFileId: string | null;
}

export interface Solicitud {
  id: string;
  tipo: TipoSolicitud;
  empleadoId: string;
  empleadoNombre: string;
  empleadoCargo: string | null;
  solicitanteEmail: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  comentarios: string | null;
  estado: EstadoSolicitud;
  aprobadorCorreo: string | null;
  decididaAt: string | null;
  motivoRechazo: string | null;
  createdAt: string;
  adjunto: Adjunto | null;
}

export interface Contexto {
  empleado: Empleado | null;
  /** El correo de la sesión, para poder decir cuál hay que dar de alta. */
  email: string;
  esAdmin: boolean;
  esAprobador: boolean;
  /** Festivos del año en curso y los dos siguientes, para contar días sin ir al servidor. */
  festivos: string[];
}

export interface NuevaSolicitud {
  tipo: TipoSolicitud;
  fechaInicio: string;
  fechaFin: string;
  comentarios?: string;
  adjunto?: { nombreArchivo: string; mime: string; contenidoBase64: string };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as T;
}

export const fetchContexto = () => get<Contexto>('/api/ausencias/contexto');

export const fetchMisSolicitudes = () =>
  get<{ solicitudes: Solicitud[] }>('/api/ausencias/mis-solicitudes').then((d) => d.solicitudes);

export const fetchPendientes = () =>
  get<{ solicitudes: Solicitud[] }>('/api/ausencias/pendientes').then((d) => d.solicitudes);

export const crearSolicitud = (s: NuevaSolicitud) => post<Solicitud>('/api/ausencias/solicitudes', s);

export const decidirSolicitud = (id: string, aprueba: boolean, motivo?: string) =>
  post<Solicitud>(`/api/ausencias/solicitudes/${encodeURIComponent(id)}/decision`, { aprueba, motivo });

export const importarEmpleados = (empleados: unknown[]) =>
  post<{ importados: number }>('/api/ausencias/empleados/import', { empleados });

export const fetchEmpleados = () =>
  get<{ empleados: Empleado[] }>('/api/ausencias/empleados').then((d) => d.empleados);

/**
 * Descarga el PDF de una solicitud. Va por fetch y no por `<a href>` porque el
 * endpoint exige la cabecera Authorization, que un enlace no puede mandar.
 */
export async function descargarAdjunto(adjunto: Adjunto): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ausencias/adjuntos/${encodeURIComponent(adjunto.id)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = adjunto.nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}

/** Lee un File como base64 sin la cabecera `data:...;base64,`. */
export function leerComoBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    lector.onload = () => {
      const r = String(lector.result);
      const coma = r.indexOf(',');
      resolve(coma >= 0 ? r.slice(coma + 1) : r);
    };
    lector.readAsDataURL(file);
  });
}
