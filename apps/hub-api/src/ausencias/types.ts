// Tipos de la app «Vacaciones y Permisos». Los cuatro primeros son los mismos
// que ofrecía el formulario de n8n; los nombres se pasan a singular y sin tildes
// para usarlos como identificadores.

export const TIPOS = ['vacaciones', 'permiso', 'compensatorio', 'incapacidad', 'otorgamiento'] as const;
export type TipoSolicitud = (typeof TIPOS)[number];

/**
 * El otorgamiento NO es una ausencia, y es el único de la lista que no lo es.
 *
 * Los otros cuatro dicen «no voy a estar»; este dice «trabajé el sábado,
 * concédeme un día». Sus columnas se leen distinto —`dias_habiles` son días
 * CONCEDIDOS y `fecha_inicio` es el día del trabajo extra, en el pasado— y de
 * ahí salen sus cuatro diferencias, cada una impuesta a mano porque el código
 * anterior no las deduce:
 *
 *  - No ocupa agenda (`ocupaAgenda`, en repo.ts).
 *  - No va al Google Calendar ni a la hoja de nómina (`construirPayload`).
 *  - No sale en el calendario del portal (`ausenciasEntre`).
 *  - Suma al saldo en vez de restar (`sumarDesdeElCorte`).
 *
 * Este predicado existe para que esas cuatro no se escriban como cuatro
 * comparaciones sueltas contra el literal: cada una que se responda a mano se
 * puede desviar sin que nada avise, que es exactamente lo que le pasó a
 * `ocupaAgenda` cuando el PATCH copió media regla.
 */
export function esOtorgamiento(tipo: TipoSolicitud): boolean {
  return tipo === 'otorgamiento';
}

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

/**
 * La corrección de una solicitud desde *Registro general*.
 *
 * Grupo propio y no un `EVENTO_SOLICITUD` más, por lo mismo que los de
 * modificación están aparte: su payload se construye a partir de DOS
 * solicitudes —la de antes del `PATCH` y la de después—, y los constructores de
 * eventos de solicitud solo reciben una. Uno solo por ahora; si aparece un
 * segundo, se añade aquí.
 *
 * ⚠️ El valor viaja al CHECK `outbox_evento_check`, que amplía la migración 027.
 * Añadir uno nuevo aquí sin ampliar el CHECK revienta DENTRO de la transacción
 * que lo encola, y el ROLLBACK se lleva por delante el trabajo del usuario. La
 * otra mitad de esa lección —el ancho de la columna— la pagó la 024 y la arregló
 * la 025.
 */
export const EVENTOS_CORRECCION = ['correccion_admin'] as const;
export type EventoCorreccion = (typeof EVENTOS_CORRECCION)[number];

/**
 * El borrado de una solicitud desde *Registro general*.
 *
 * Grupo propio y no un `EVENTO_CORRECCION` más, por el mismo criterio que separa
 * a los de modificación de los de solicitud: su constructor de payload recibe UNA
 * solicitud —la que se va a borrar—, mientras que el de corrección recibe dos, la
 * de antes y la de después. Firmas distintas, grupos distintos.
 *
 * ⚠️ El valor viaja al CHECK `outbox_evento_check`, que amplía la migración 028.
 */
export const EVENTOS_BORRADO = ['borrado_admin'] as const;
export type EventoBorrado = (typeof EVENTOS_BORRADO)[number];

export const EVENTOS = [
  ...EVENTOS_SOLICITUD,
  ...EVENTOS_MODIFICACION,
  ...EVENTOS_CORRECCION,
  ...EVENTOS_BORRADO,
] as const;
export type EventoOutbox = (typeof EVENTOS)[number];

/** True si el tipo necesita aprobación de alguien. Solo las incapacidades no. */
export function requiereAprobacion(tipo: TipoSolicitud): boolean {
  return tipo !== 'incapacidad';
}

/**
 * Si una fila con este estado tiene un evento en el calendario de Google.
 *
 * ⚠️ **NO es `ocupaAgenda`** (`repo.ts`), aunque las dos digan «sí» sobre casi
 * las mismas filas. `ocupaAgenda` contesta a la regla de solapamiento y
 * **excluye las incapacidades**; esta contesta a qué hay en Google, y una
 * incapacidad `registrada` **sí** tiene evento —`construirPayload` le da
 * `calendario` y `hoja`—. Son dos preguntas distintas sobre la misma fila, y
 * contestar una con la otra es la forma exacta que tuvo el bug de la cuarta
 * puerta del solapamiento. La advertencia va repetida en `ocupaAgenda` porque
 * las dos funciones no son vecinas: nadie las va a ver juntas por casualidad.
 *
 * Va por ESTADO y no por tipo porque el estado es lo que la fila conserva:
 * `aprobada` y `registrada` son justo los dos estados que dejan los dos únicos
 * eventos que emiten una acción `crear`.
 *
 * `registrada` está aquí desde el 2026-08-19 y ya no es una rama muerta. Antes
 * esta pregunta la hacía `tocaGoogle` en `notificaciones.ts`, que lo excluía a
 * propósito: por el flujo de modificaciones es inalcanzable
 * (`estadoAdmiteModificacion` lo impide), así que contemplarlo habría hecho
 * creer que el caso estaba cubierto. **El `PATCH` del registro general sí lo
 * alcanza** —admite cualquier tipo con cualquier estado—, y una incapacidad
 * editada por un admin tiene evento en Google. Para el flujo de modificaciones
 * el comportamiento no cambia: allí `registrada` sigue sin poder darse.
 */
export function estaEnElCalendario(estado: EstadoSolicitud): boolean {
  return estado === 'aprobada' || estado === 'registrada';
}

/**
 * Si una corrección cambia algo que el EVENTO del calendario enseña.
 *
 * El evento solo enseña tres cosas: que existe, sus fechas y su `resumen`
 * —`${ETIQUETA_TIPO[tipo]} ${empleadoNombre}`, ver `calendario()` en
 * `notificaciones.ts`—. Por eso `dias`, `comentarios` y `observaciones` quedan
 * fuera, y no por descuido: corregir el recuento de días de una aprobada —el
 * caso más corriente del histórico importado, donde el Excel anotó recuentos
 * que no cuadran— mandaría a Google un `actualizar` idéntico al evento que ya
 * hay, y con él un correo diciendo que algo se corrigió solo. Un ⚠️ que avisa
 * de lo que no ha pasado es cómo se enseña a la gente a no leerlos.
 *
 * El empleado va por `empleadoId` y no por `empleadoNombre`: el nombre es un
 * campo desnormalizado que viene del JOIN, y reasignar la solicitud a otra
 * persona es justo lo que hay que detectar.
 */
export function cambiaElCalendario(previa: Solicitud, actual: Solicitud): boolean {
  // Un otorgamiento no tiene evento que mover: nunca llegó al calendario.
  //
  // ⚠️ La guarda mira los DOS lados, y no solo `actual`. Si un admin cambia por
  // PATCH una vacación aprobada a otorgamiento, el evento viejo SIGUE en Google
  // y hay que borrarlo — mirar solo `actual` devolvería `false` y lo dejaría ahí
  // para siempre, sin avisar a nadie. Es la misma forma de fallo que documenta
  // el orden de ramas de `cambiaLaHoja`, un poco más abajo.
  if (esOtorgamiento(previa.tipo) && esOtorgamiento(actual.tipo)) return false;
  return (
    estaEnElCalendario(previa.estado) !== estaEnElCalendario(actual.estado) ||
    previa.fechaInicio !== actual.fechaInicio ||
    previa.fechaFin !== actual.fechaFin ||
    previa.tipo !== actual.tipo ||
    previa.empleadoId !== actual.empleadoId
  );
}

/**
 * Si una corrección cambia algo que la FILA DE LA HOJA enseña.
 *
 * La hoja tiene DOS formas —ver `hoja()` en `notificaciones.ts`—, y no una:
 * una incapacidad lleva nombre, fechas, días, tipo y «Adjunto?»; el resto lleva
 * nombre, fechas, días, tipo, «Comentarios» y «Aprobado?». Por eso esta función
 * no es una lista fija de campos, sino `cambiaElCalendario` **más** `dias`
 * siempre, y «Comentarios»/«Aprobado?» solo cuando la fila NO es una
 * incapacidad —el adjunto no se mira porque `validarEdicionSolicitud` no admite
 * corregirlo desde el registro—. `observaciones` queda fuera de las dos formas:
 * es una nota interna que no viaja a ningún sitio.
 *
 * La celda «Aprobado?» tiene TRES valores —`'Sí'`, `'No'` y vacío para
 * cualquier otro estado, incluida `registrada`—, así que se mira por el ESTADO
 * ENTERO y no por `estaEnElCalendario`: aquel predicado solo distingue dos, y
 * `aprobada → registrada` cambia la celda de `'Sí'` a vacío sin que
 * `estaEnElCalendario` note la diferencia.
 *
 * ⚠️ **La contención de `cambiaElCalendario` NO es emergente: la impone que su
 * delegación vaya en la PRIMERA línea, a propósito**, y reordenar las ramas
 * rompe la invariante EN SILENCIO —los 15 tests de `types.test.ts` seguían en
 * verde la primera vez que se comprobó—. No es cierto que «todo lo que mueve
 * el calendario mueva también la hoja»: una incapacidad `registrada →
 * rechazada` mueve el evento —hay que BORRARLO, `estaEnElCalendario` pasa de
 * `true` a `false`— y no cambia ni una celda de su pestaña, que no tiene
 * «Aprobado?» y por tanto no enseña el estado. Si el corte
 * `actual.tipo === 'incapacidad'` de abajo se evaluara ANTES que la
 * delegación, ese caso devolvería `false` y el evento viejo se quedaría en
 * Google para siempre, sin avisar a nadie. El candado de este caso —con una
 * corrección de fecha, no de estado— vive en `types.test.ts`, dentro del test
 * «contiene a `cambiaElCalendario`»: si algún día se reordena una rama o se le
 * quita un campo, hay que comprobar que ese caso lo sigue cazando.
 */
export function cambiaLaHoja(previa: Solicitud, actual: Solicitud): boolean {
  // Un otorgamiento no tiene fila en ninguna pestaña: nunca llegó a la hoja.
  //
  // Va ANTES de la delegación y eso NO rompe la contención, que es lo que el ⚠️
  // de arriba protege: `cambiaElCalendario` devuelve `false` sobre exactamente
  // el mismo par de tipos —su guarda es la misma y también mira los dos lados—,
  // así que aquí `false` sigue conteniendo a `false`. La guarda de la
  // incapacidad, que sí rompería la contención si subiera, sigue donde estaba.
  if (esOtorgamiento(previa.tipo) && esOtorgamiento(actual.tipo)) return false;
  // Esta delegación va PRIMERA a propósito: es lo único que hace que esta
  // función CONTENGA a `cambiaElCalendario` (ver el ⚠️ del JSDoc). Moverla
  // después del corte de incapacidad de abajo rompe esa garantía en silencio.
  if (cambiaElCalendario(previa, actual) || previa.diasHabiles !== actual.diasHabiles) return true;
  // Las otras dos columnas solo existen en las pestañas que NO son de
  // incapacidad: la suya lleva «Adjunto?» en vez de «Comentarios» y
  // «Aprobado?» —ver `hoja()`—, y el adjunto no se puede corregir desde el
  // registro (`validarEdicionSolicitud` no lo admite), así que ahí no queda
  // nada más que mirar. Basta con el tipo de la fila corregida: si el tipo
  // CAMBIÓ, `cambiaElCalendario` ya ha dicho que sí más arriba.
  if (actual.tipo === 'incapacidad') return false;
  // El estado ENTERO y no `estaEnElCalendario`: la celda «Aprobado?» tiene
  // TRES valores («Sí», «No» y vacío) y aquel predicado solo distingue dos, así
  // que `aprobada → registrada` cambiaría la celda sin que nadie lo viera.
  return previa.comentarios !== actual.comentarios || previa.estado !== actual.estado;
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
  // En singular y no en plural como los otros cuatro: esos nombran una pestaña
  // de la hoja —que es de donde salen esas etiquetas— y este no tiene pestaña
  // ninguna, así que aquí solo nombra la cosa.
  otorgamiento: 'Compensatorio concedido',
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
  /**
   * El evento del calendario del que esta solicitud es dueña, o `null`.
   *
   * Responde una única pregunta: ¿hay AHORA MISMO un evento vivo en Google que
   * sepamos localizar? `null` es un «no», y hay tres formas distintas de llegar
   * a ese «no» —ninguna es la misma historia, aunque las tres acaben igual—:
   *
   *  1. La solicitud nunca llegó a aprobarse: no se mandó nada a Google.
   *  2. Se aprobó ANTES de que impusiéramos el id: el evento existe en Google,
   *     pero lleva el que Google inventó, que nadie apuntó, así que no se puede
   *     localizar.
   *  3. Tuvo un evento con id impuesto y lo perdió: una anulación aprobada lo
   *     borró de Google, y `anotarEventoDeCalendario` (repo.ts) vació esta
   *     columna con él. Aquí el evento sencillamente no existe.
   *
   * La conclusión operativa es la misma en los tres: nada que hacer por API, y
   * el correo tiene que seguir pidiendo el ajuste a mano.
   */
  eventoCalendarioId: string | null;
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
  /**
   * Días a conceder. SOLO en un otorgamiento, y ahí es obligatorio.
   *
   * En los demás tipos los cuenta el servidor con `contarDiasHabiles` y este
   * campo se rechaza: aceptarlo e ignorarlo dejaría creer que sirve para algo.
   * Aquí no se puede calcular — un compensatorio se gana por trabajar un sábado,
   * y un sábado da CERO días hábiles.
   */
  dias?: number;
}


/** Un evento listo para que n8n lo ejecute. `payload` lleva todo lo que los
 *  nodos de Gmail/Calendar/Sheets necesitan, ya resuelto por hub-api. */
export interface EventoPendiente {
  id: number;
  evento: EventoOutbox;
  /**
   * `null` cuando su solicitud ya se borró: desde la migración 028 la clave
   * ajena es `ON DELETE SET NULL`, para que el borrado de un evento del
   * calendario pueda sobrevivir a la solicitud que lo pidió.
   *
   * Es informativo y nada más. n8n no lo usa: entrega leyendo `payload`, que es
   * autocontenido —`eventosPendientes` ni siquiera hace `JOIN` con
   * `solicitudes_ausencia`— y confirma por el `id` de esta fila.
   */
  solicitudId: string | null;
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

/**
 * Qué hay que hacerle al evento del calendario.
 *
 * `crear` es lo de siempre. Los otros dos existen porque el evento se crea con
 * un id que decidimos nosotros —ver `idDeEventoCalendario`—, y tener ese id es
 * lo que permite volver a él: reprogramar una ausencia lo mueve y anularla lo
 * borra, en vez de pedirle a alguien que lo ajuste a mano.
 */
export type AccionCalendario = 'crear' | 'actualizar' | 'borrar';

/** Evento *all-day* de Google Calendar. `fin` ya viene sumado un día. */
export interface EventoCalendario {
  calendarId: string;
  /**
   * El id del evento DENTRO de ese calendario. Se impone al crearlo, y por eso
   * sirve también para localizarlo después.
   */
  eventId: string;
  accion: AccionCalendario;
  /**
   * Los tres de abajo viajan SIEMPRE, también en un `borrar`, donde describen
   * el evento tal como está justo antes de desaparecer. Dejarlos fuera cuando
   * no hacen falta sería reintroducir por la puerta de atrás el problema que
   * avisa `PayloadEvento`: al otro lado, un campo ausente es `undefined`, y
   * este contrato no distingue eso de un valor.
   */
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
