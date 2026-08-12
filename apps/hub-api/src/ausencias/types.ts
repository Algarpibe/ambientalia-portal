// Tipos de la app «Vacaciones y Permisos». Los cuatro tipos de solicitud son
// los mismos que ofrecía el formulario de n8n; los nombres se pasan a singular
// y sin tildes para usarlos como identificadores.

export const TIPOS = ['vacaciones', 'permiso', 'compensatorio', 'incapacidad'] as const;
export type TipoSolicitud = (typeof TIPOS)[number];

/** Las incapacidades se INFORMAN (terminan en `registrada`); el resto se aprueban. */
export const ESTADOS = ['pendiente', 'aprobada', 'rechazada', 'registrada'] as const;
export type EstadoSolicitud = (typeof ESTADOS)[number];

export const EVENTOS = ['creada', 'aprobada', 'rechazada', 'registrada'] as const;
export type EventoOutbox = (typeof EVENTOS)[number];

/** True si el tipo necesita aprobación de alguien. Solo las incapacidades no. */
export function requiereAprobacion(tipo: TipoSolicitud): boolean {
  return tipo !== 'incapacidad';
}

/** Etiqueta legible, la que va en los correos y en la columna «Tipo» de la hoja. */
export const ETIQUETA_TIPO: Record<TipoSolicitud, string> = {
  vacaciones: 'Vacaciones',
  permiso: 'Permisos',
  compensatorio: 'Compensatorios',
  incapacidad: 'Incapacidades',
};

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

/** Lo que el cliente manda al crear. `empleadoId` NO viaja: sale de la sesión. */
export interface NuevaSolicitud {
  tipo: TipoSolicitud;
  fechaInicio: string;
  fechaFin: string;
  comentarios?: string;
  adjunto?: { nombreArchivo: string; mime: string; contenidoBase64: string };
}

/** Una fila de la pestaña `consolidado` de la hoja de Google, tal como se pega. */
export interface FilaEmpleado {
  nombreCompleto: string;
  correo: string;
  cargo?: string;
  credencial?: number | null;
  aprobadorCorreo?: string;
}

/** Un evento listo para que n8n lo ejecute. `payload` lleva todo lo que los
 *  nodos de Gmail/Calendar/Sheets/Drive necesitan, ya resuelto por hub-api. */
export interface EventoPendiente {
  id: number;
  evento: EventoOutbox;
  solicitudId: string;
  intentos: number;
  payload: PayloadEvento;
}

export interface PayloadEvento {
  tipo: TipoSolicitud;
  tipoEtiqueta: string;
  estado: EstadoSolicitud;
  empleado: { nombre: string; correo: string; cargo: string | null };
  aprobadorCorreo: string | null;
  fechaInicio: string;
  fechaFin: string;
  /** Fin exclusivo para eventos all-day de Google Calendar (fechaFin + 1 día). */
  fechaFinCalendario: string;
  diasHabiles: number;
  comentarios: string;
  motivoRechazo: string;
  /** «Sí» / «No» / «» — el valor exacto que espera la columna «Aprobado?». */
  aprobado: string;
  adjunto: { id: string; nombreArchivo: string } | null;
  urlPortal: string;
}
