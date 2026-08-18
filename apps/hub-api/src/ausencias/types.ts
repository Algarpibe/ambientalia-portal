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
export const EVENTOS_SOLICITUD = [
  'creada',
  'aprobacion',
  'aprobacion_2',
  'aprobada',
  'rechazada',
  'registrada',
] as const;
export type EventoSolicitud = (typeof EVENTOS_SOLICITUD)[number];

/**
 * Los avisos de la propuesta de modificación. Van aparte de los de la solicitud
 * porque hablan de OTRA fila —la del satélite— y su correo necesita las dos
 * fotos de fechas, no solo la de la solicitud.
 *
 * Se declaran los tres aunque la Fase 2 solo emita el primero: el CHECK de
 * `evento` en la 024 ya admite los tres, y separarlos del tipo dejaría la BD
 * aceptando un valor que TypeScript no conoce (o al revés, que es peor: el
 * INSERT reventaría dentro de la transacción de la decisión).
 */
export const EVENTOS_MODIFICACION = [
  'modificacion_solicitada',
  'modificacion_aprobada',
  'modificacion_rechazada',
] as const;
export type EventoModificacion = (typeof EVENTOS_MODIFICACION)[number];

export const EVENTOS = [...EVENTOS_SOLICITUD, ...EVENTOS_MODIFICACION] as const;
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

// ── La propuesta de modificación ───────────────────────────────────────────

/** Qué se pide cambiar. Ni el tipo ni la persona: eso sigue siendo del admin. */
export const CLASES_MODIFICACION = ['fechas', 'anulacion'] as const;
export type ClaseModificacion = (typeof CLASES_MODIFICACION)[number];

/**
 * `retirada` es la que el propio solicitante quita antes de que nadie la mire.
 * No se borra la fila: la propuesta desaparece de la bandeja del jefe pero
 * queda el rastro de que se pidió y se echó atrás.
 */
export const ESTADOS_MODIFICACION = ['pendiente', 'aprobada', 'rechazada', 'retirada'] as const;
export type EstadoModificacion = (typeof ESTADOS_MODIFICACION)[number];

/**
 * Una propuesta de cambio sobre una solicitud ya enviada.
 *
 * Los campos `*Previos` son la FOTO del instante en que se pidió, no una copia
 * redundante: sostienen el «de estas fechas a estas otras» del correo —lo único
 * que permite ajustar el calendario a mano— y son el testigo de concurrencia al
 * aplicarla.
 */
export interface Modificacion {
  id: string;
  solicitudId: string;
  clase: ClaseModificacion;
  estadoPrevio: EstadoSolicitud;
  fechaInicioPrevia: string;
  fechaFinPrevia: string;
  diasHabilesPrevios: number;
  /** Los tres van `null` en una anulación; lo garantiza un CHECK de la 024. */
  fechaInicioNueva: string | null;
  fechaFinNueva: string | null;
  diasHabilesNuevos: number | null;
  motivo: string | null;
  estado: EstadoModificacion;
  /** Copiado de la SOLICITUD, nunca rederivado. Ver `decisorDeModificacion`. */
  aprobadorCorreo: string;
  solicitanteEmail: string;
  decididaAt: string | null;
  motivoRechazo: string | null;
  createdAt: string;
}

/**
 * Quién decide una modificación. Sale de la SOLICITUD, nunca del organigrama:
 * rederivar movería la decisión a alguien que no vio la original.
 */
export function decisorDeModificacion(
  s: Pick<Solicitud, 'estado' | 'aprobadorCorreo' | 'segundoAprobadorCorreo'>,
): string | null {
  return correoDelTurno(s) ?? s.aprobadorCorreo;
}

export interface Transicion {
  estado: EstadoSolicitud;
  /**
   * `EventoSolicitud` y no `EventoOutbox`: decidir una solicitud nunca puede
   * emitir un aviso de modificación, y dejarlo abierto obligaría a `CORREO_DE` a
   * tener una entrada para eventos que no sabe redactar.
   */
  evento: EventoSolicitud;
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
  /** A quién se pone en copia de sus correos. `null` = a nadie. */
  copiaCorreo: string | null;
  /** Puede abrir CUALQUIER adjunto de CUALQUIER persona. Llave maestra. */
  veAdjuntos: boolean;
  /**
   * Si sus solicitudes necesitan también la firma del jefe de su jefe, o basta
   * con la del jefe inmediato.
   *
   * Apagarlo NO deja a nadie sin enterarse: el de segundo nivel pasa de firmante
   * a informado y sigue recibiendo el correo del resultado. El valor por defecto
   * vive en el SQL (`DEFAULT TRUE`), no aquí — repetirlo en TypeScript daría dos
   * fuentes de verdad para el mismo default.
   */
  requiereSegundaFirma: boolean;
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
  /**
   * El de segundo nivel cuando NO firma, congelado en el alta igual que los
   * firmantes. Recibe el correo de la decisión final y nada más: ni firma, ni
   * abre el adjunto, ni la solicitud le cuenta como aprobación suya.
   *
   * Excluyente con `segundoAprobadorCorreo`: si uno tiene valor, el otro es
   * `null`. Se congela —al contrario que `copiaCorreo`— porque nace del ÁRBOL y
   * no de una preferencia de aviso: un cambio de organigrama a mitad de trámite
   * no debe reescribir a quién se le prometió el resultado.
   */
  informadoCorreo: string | null;
  /** Cuándo firmó el jefe inmediato. Con una sola firma coincide con `decididaAt`. */
  primeraFirmaAt: string | null;
  /** La decisión FINAL: la que dejó la solicitud en `aprobada` o `rechazada`. */
  decididaAt: string | null;
  motivoRechazo: string | null;
  createdAt: string;
  adjunto: Adjunto | null;
  /**
   * A quién se pone en copia, leído de la ficha del empleado AL CONSULTAR, no
   * congelado en el alta como los dos firmantes. La diferencia es deliberada: un
   * firmante decide quién PUEDE decidir —un permiso—, y la copia solo decide a
   * quién se avisa. Congelarla haría que corregir una copia mal puesta no
   * arreglara ninguna solicitud en curso.
   */
  copiaCorreo: string | null;
  /**
   * La propuesta de cambio viva, si la hay. Viaja con TODA solicitud porque el
   * `LEFT JOIN` está en `SELECT_SOLICITUD`: así ninguna pantalla puede olvidarse
   * de pedirla y enseñar unas fechas que están en discusión como si fueran
   * firmes. Como mucho hay una: lo garantiza el índice único parcial de la 024.
   */
  modificacionPendiente: Modificacion | null;
  /**
   * Cuándo se anuló. Anular NO estrena estado —la solicitud queda `rechazada`,
   * que ya hereda la semántica correcta en los seis filtros que miran el
   * estado—, así que esta marca es lo único que distingue «anulada» de
   * «rechazada por el jefe». La etiqueta se deriva al pintar, no se almacena.
   */
  anuladaAt: string | null;
}

/**
 * Lo que el cliente manda al pedir un cambio, ya validado. Ni `empleadoId` ni
 * `diasHabiles`: el primero sale de la sesión y el segundo lo cuenta el
 * servidor, igual que en `NuevaSolicitud`.
 */
export interface NuevaModificacion {
  clase: ClaseModificacion;
  /** `null` en una anulación; con valor en un cambio de fechas. */
  fechaInicio: string | null;
  fechaFin: string | null;
  motivo: string | null;
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
