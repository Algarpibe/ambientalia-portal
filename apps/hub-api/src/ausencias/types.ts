// Tipos de la app «Vacaciones y Permisos». Los cuatro tipos de solicitud son
// los mismos que ofrecía el formulario de n8n; los nombres se pasan a singular
// y sin tildes para usarlos como identificadores.

export const TIPOS = ['vacaciones', 'permiso', 'compensatorio', 'incapacidad'] as const;
export type TipoSolicitud = (typeof TIPOS)[number];

/** Las incapacidades se INFORMAN (terminan en `registrada`); el resto se aprueban. */
export const ESTADOS = ['pendiente', 'aprobada', 'rechazada', 'registrada'] as const;
export type EstadoSolicitud = (typeof ESTADOS)[number];

/**
 * Cada evento de la cola es **exactamente un correo** más, opcionalmente, un
 * evento de calendario, una fila de hoja y una subida a Drive. Partir el aviso
 * al aprobador (`aprobacion`) del acuse al solicitante (`creada`) es lo que
 * permite que el flujo de n8n sea una cadena lineal en vez de un árbol.
 */
export const EVENTOS = ['creada', 'aprobacion', 'aprobada', 'rechazada', 'registrada'] as const;
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
  /** Decimal: el histórico de la hoja trae medios días (6,5) y son dato real. */
  diasHabiles: number;
  comentarios: string | null;
  /** Notas al margen que traía la hoja, y el PDF de las incapacidades antiguas. */
  observaciones: string | null;
  /** `hoja` = importada del histórico; `portal` = nacida en la app. */
  origen: 'portal' | 'hoja';
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

/** El correo, ya redactado. n8n solo lo pasa al nodo de Gmail. */
export interface CorreoEvento {
  /** Destinatarios separados por coma, como espera el campo `sendTo` de Gmail. */
  para: string;
  asunto: string;
  cuerpo: string;
}

/** Evento *all-day* de Google Calendar. `fin` ya viene sumado un día. */
export interface EventoCalendario {
  calendarId: string;
  resumen: string;
  inicio: string;
  /** Fin EXCLUSIVO: Google no pinta el último día si no se le suma uno. */
  fin: string;
}

/** Una fila para `append` en una pestaña del libro `consulta_vacaciones`. */
export interface FilaHoja {
  documentId: string;
  pestana: string;
  /** Las claves son los encabezados literales de la hoja. */
  columnas: Record<string, string | number>;
}

/** El PDF a subir: n8n lo descarga de hub-api y lo deja en la carpeta. */
export interface SubidaDrive {
  adjuntoId: string;
  nombreArchivo: string;
  driveId: string;
  carpetaId: string;
}

/**
 * Lo que n8n ejecuta para un evento. Los cuatro campos opcionales son
 * `null` cuando ese paso no aplica, para que el flujo pueda decidirlo con un
 * simple IF sin conocer ninguna regla de negocio.
 */
export interface PayloadEvento {
  tipo: TipoSolicitud;
  tipoEtiqueta: string;
  estado: EstadoSolicitud;
  empleadoNombre: string;
  correo: CorreoEvento;
  calendario: EventoCalendario | null;
  hoja: FilaHoja | null;
  drive: SubidaDrive | null;
}
