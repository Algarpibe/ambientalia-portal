// Tipos de la app «Vacaciones y Permisos». Los cuatro tipos de solicitud son
// los mismos que ofrecía el formulario de n8n; los nombres se pasan a singular
// y sin tildes para usarlos como identificadores.

export const TIPOS = ['vacaciones', 'permiso', 'compensatorio', 'incapacidad'] as const;
export type TipoSolicitud = (typeof TIPOS)[number];

/**
 * Las incapacidades se INFORMAN (terminan en `registrada`); el resto se aprueban.
 *
 * `pendiente_2` es la segunda firma: el jefe inmediato ya dio el visto bueno y
 * falta su superior. Se llama así, y no `aprobada_1` o `preaprobada`, para que un
 * grep de «pendiente» siga encontrando los dos y para que NO contenga la
 * subcadena «aprobada»: un filtro descuidado contaría media firma como firma
 * entera, y en el saldo eso son días descontados que no han ocurrido.
 */
export const ESTADOS = ['pendiente', 'pendiente_2', 'aprobada', 'rechazada', 'registrada'] as const;
export type EstadoSolicitud = (typeof ESTADOS)[number];

/** Los dos estados en los que alguien todavía tiene que firmar. */
export const ESTADOS_EN_TRAMITE: readonly EstadoSolicitud[] = ['pendiente', 'pendiente_2'];

/**
 * Cada evento de la cola es **exactamente un correo** más, opcionalmente, un
 * evento de calendario y una fila de hoja. Partir el aviso
 * al aprobador (`aprobacion`) del acuse al solicitante (`creada`) es lo que
 * permite que el flujo de n8n sea una cadena lineal en vez de un árbol.
 *
 * `aprobacion_2` es el aviso al segundo aprobador, y tiene nombre propio porque
 * su TEXTO es distinto: `avisoSegundoAprobador` dice que la solicitud ya cuenta
 * con el visto bueno del jefe inmediato y lleva su propio asunto. `CORREO_DE`
 * necesita una clave por texto, así que fundirlo con `aprobacion` mandaría el
 * correo equivocado. (Nació además para no duplicar la subida a Drive; esa razón
 * desapareció al retirar Drive, pero la de arriba sigue en pie.)
 */
export const EVENTOS = ['creada', 'aprobacion', 'aprobacion_2', 'aprobada', 'rechazada', 'registrada'] as const;
export type EventoOutbox = (typeof EVENTOS)[number];

/** True si el tipo necesita aprobación de alguien. Solo las incapacidades no. */
export function requiereAprobacion(tipo: TipoSolicitud): boolean {
  return tipo !== 'incapacidad';
}

/** A quién le toca firmar AHORA. `null` si el estado ya no admite firma. */
export function correoDelTurno(s: Pick<Solicitud, 'estado' | 'aprobadorCorreo' | 'segundoAprobadorCorreo'>): string | null {
  if (s.estado === 'pendiente') return s.aprobadorCorreo;
  if (s.estado === 'pendiente_2') return s.segundoAprobadorCorreo;
  return null;
}

export interface Transicion {
  estado: EstadoSolicitud;
  evento: EventoOutbox;
  /** Firma del jefe inmediato: sella `primera_firma_at`. */
  esPrimeraFirma: boolean;
  /** Cierra la solicitud: sella `decidida_at` y el aprobador final. */
  esDecisionFinal: boolean;
}

/**
 * La máquina de estados de la decisión, entera y en un solo sitio.
 *
 * Se calcula en TypeScript y no en el SQL a propósito: el UPDATE solo escribe si
 * nadie se ha adelantado, y así la transición se puede probar sin base de datos.
 *
 * Un rechazo en el primer nivel también sella la primera firma: el jefe actuó.
 * Cuando la cadena tiene una sola firma se sellan las dos parejas de columnas,
 * para que ninguna consulta de auditoría necesite un COALESCE.
 *
 * `null` = el estado no admite firma; el servicio lo traduce a 409.
 */
export function transicionAlDecidir(
  s: Pick<Solicitud, 'estado' | 'segundoAprobadorCorreo'>,
  aprueba: boolean,
): Transicion | null {
  if (s.estado === 'pendiente') {
    if (!aprueba) return { estado: 'rechazada', evento: 'rechazada', esPrimeraFirma: true, esDecisionFinal: true };
    // Sin segundo aprobador el árbol se acaba aquí: una sola firma la deja firme,
    // que es exactamente el comportamiento anterior a la cascada.
    return s.segundoAprobadorCorreo
      ? { estado: 'pendiente_2', evento: 'aprobacion_2', esPrimeraFirma: true, esDecisionFinal: false }
      : { estado: 'aprobada', evento: 'aprobada', esPrimeraFirma: true, esDecisionFinal: true };
  }
  if (s.estado === 'pendiente_2') {
    return aprueba
      ? { estado: 'aprobada', evento: 'aprobada', esPrimeraFirma: false, esDecisionFinal: true }
      : { estado: 'rechazada', evento: 'rechazada', esPrimeraFirma: false, esDecisionFinal: true };
  }
  return null;
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
  /** Quien firma PRIMERO, congelado en el alta. No rota al avanzar de nivel. */
  aprobadorCorreo: string | null;
  /**
   * Quien firma DESPUÉS, congelado en el alta. `null` = una sola firma, porque
   * el árbol se acaba ahí (raíz, jefe sin ficha activa, o ciclo).
   */
  segundoAprobadorCorreo: string | null;
  /** Cuándo firmó el jefe inmediato. Con una sola firma coincide con `decididaAt`. */
  primeraFirmaAt: string | null;
  /** La decisión FINAL: la que dejó la solicitud en `aprobada` o `rechazada`. */
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


/** Un evento listo para que n8n lo ejecute. `payload` lleva todo lo que los
 *  nodos de Gmail/Calendar/Sheets necesitan, ya resuelto por hub-api. */
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

/**
 * Lo que n8n ejecuta para un evento. Los dos campos opcionales son `null` cuando
 * ese paso no aplica, para que el flujo pueda decidirlo con un simple IF sin
 * conocer ninguna regla de negocio.
 *
 * Aquí hubo un tercero, `drive`, con la subida del PDF a Google Drive. Se retiró
 * junto con los nodos que lo leían. Si algún día vuelve un campo así, el IF de
 * n8n tiene que existir ANTES de que hub-api empiece a emitirlo, nunca después:
 * un `undefined !== null` es `true` y activaría la rama para todos los eventos.
 */
export interface PayloadEvento {
  tipo: TipoSolicitud;
  tipoEtiqueta: string;
  estado: EstadoSolicitud;
  empleadoNombre: string;
  correo: CorreoEvento;
  calendario: EventoCalendario | null;
  hoja: FilaHoja | null;
}
