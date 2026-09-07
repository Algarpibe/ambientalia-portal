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
  /**
   * El dueño retira su propia solicitud antes de que nadie la firme. Avisa al
   * jefe, que la tenía en la bandeja y va a verla desaparecer.
   *
   * NO produce efectos en Google, y no hay que añadirle ninguno: una solicitud
   * `pendiente` nunca llegó al calendario ni a la hoja —solo escriben `aprobada`,
   * `rechazada` y `registrada`—, así que `construirPayload` la deja fuera de los
   * dos por omisión. Si algún día se permitiera retirar una ya aprobada, esto
   * habría que mirarlo: ahí sí habría un evento que borrar.
   */
  'retirada',
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
  /**
   * Su petición de cambio se quedó sin efecto porque la solicitud se decidió
   * antes. Va al TRABAJADOR: es el único que no se entera por ningún otro lado
   * —el jefe ya ve el aviso ámbar en su bandeja— y sin esto su petición
   * desaparecía de la pantalla sin explicación.
   */
  'modificacion_caducada',
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
 * las mismas filas. `ocupaAgenda` contesta a la regla de solapamiento; esta
 * contesta a qué hay en Google. Desde el 2026-08-21 las dos cuentan la
 * incapacidad —aquélla dejó de eximirla, y el porqué está allí—, y eso NO las ha
 * acercado: siguen discrepando en las dos direcciones, porque una `pendiente`
 * ocupa agenda y todavía no tiene evento, y un otorgamiento `aprobada` tiene
 * evento y no ocupa agenda. Son dos preguntas distintas sobre la misma fila, y
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
 * El evento enseña que existe, sus fechas, su `resumen`
 * —`${ETIQUETA_TIPO[tipo]} ${empleadoNombre}`, ver `calendario()` en
 * `notificaciones.ts`— y, desde que un permiso de un día puede llevar hora, su
 * franja horaria. Esa última NO se compara aquí: el porqué, y qué hay que hacer
 * el día que deje de ser inofensivo, en el ⚠️ de dentro de la función.
 *
 * `dias`, `comentarios` y `observaciones` quedan fuera, y no por descuido:
 * corregir el recuento de días de una aprobada —el caso más corriente del
 * histórico importado, donde el Excel anotó recuentos que no cuadran— mandaría a
 * Google un `actualizar` idéntico al evento que ya hay, y con él un correo
 * diciendo que algo se corrigió solo. Un ⚠️ que avisa de lo que no ha pasado es
 * cómo se enseña a la gente a no leerlos.
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
  // ⚠️ Las HORAS no se comparan, y el evento SÍ las enseña: desde la 036 un
  // permiso de un día puede llevar franja, y `calendario()` la convierte en un
  // bloque horario con el desfase de Colombia en vez del evento de día completo.
  //
  // Hoy eso no es explotable, y por eso se deja así en lugar de añadir una regla
  // que ningún test podría matar. Las horas solo se escriben en el ALTA
  // —`validarHoras`, en service.ts—, y el PATCH del Registro general no las
  // acepta. Lo único que las toca después son los dos `CASE` de repo.ts, y solo
  // para BORRARLAS: mantienen la franja mientras el estado NUEVO siga cumpliendo
  // `tipo = 'permiso' AND fechaInicio = fechaFin`, y la anulan en cuanto deja de
  // cumplirse.
  //
  // Y ahí está el porqué: si la solicitud tenía horas, ese predicado se cumplía
  // ANTES, así que para que un `CASE` las borre tiene que haber cambiado el tipo
  // o alguna de las dos fechas — y esta función compara las tres. Ojo: no basta
  // con mirar las fechas. El `CASE` de `actualizarSolicitud` mira TAMBIÉN el
  // tipo (su propio comentario lo explica), así que un PATCH de `permiso` a
  // `vacaciones` con las fechas intactas borra las horas sin tocar ni una fecha;
  // ese camino lo detecta `previa.tipo !== actual.tipo`, no la comparación de
  // fechas.
  //
  // El día que alguien abra la edición de la hora SIN cambiar el tipo ni las
  // fechas, esta comparación hay que ampliarla EN EL MISMO COMMIT. Sin eso,
  // `situacionDelCalendario` (notificaciones.ts) devolvería `no_cambia`: no se
  // emitiría ningún `actualizar`, el evento se quedaría en Google con la franja
  // vieja, y encima el correo afirmaría que «el evento del calendario no cambia
  // con esta corrección». Un ⚠️ que NIEGA lo que sí ha pasado es la misma forma
  // de fallo que el `Record` de avisos —`AVISO_DE`— existe para evitar, y la
  // misma que documenta el párrafo de `dias` de aquí arriba.
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
/**
 * `caducada` la cierra el SISTEMA, no una persona: cuando el jefe decide la
 * solicitud, cualquier propuesta viva sobre ella deja de poder aplicarse —el
 * testigo triple de `decidirModificacion` compara el estado y ya no casa—, así
 * que se cierra en la misma transacción.
 *
 * Estado propio y no reutilizar `retirada` ni `rechazada`: la primera diría que
 * se echó atrás el trabajador y la segunda que la tumbó el jefe, y ninguno de
 * los dos hizo nada. Es la misma clase de mentira que costó cuatro intentos en
 * la columna «Decidida por» del registro, y por eso aquí se paga una migración
 * en vez de reciclar un literal que casi encaja.
 *
 * Sale del índice único parcial —que solo cuenta las `pendiente`—, y eso es lo
 * que desbloquea a quien quiera pedir otro cambio sobre esa misma solicitud.
 */
export const ESTADOS_MODIFICACION = ['pendiente', 'aprobada', 'rechazada', 'retirada', 'caducada'] as const;
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
   * Puede exportar el CSV del registro general: las incapacidades y los
   * permisos de la plantilla, con sus motivos —datos personales—. Se concede
   * ficha a ficha desde la pestaña Organigrama, igual que `veAdjuntos`.
   */
  exportaRegistro: boolean;
  /**
   * Ve el calendario y el registro de movimientos de TODA la compañía, sin ser
   * administrador: los dos recortes por privacidad que separan a un admin del
   * resto —la fila propia en el calendario y la rama de dos niveles en el
   * registro— dejan de aplicarle.
   *
   * NO abre nada más: editar, borrar e importar siguen detrás de `requireAdmin`
   * ruta por ruta, así que quien tiene esto mira, y solo mira. Se concede ficha
   * a ficha desde la pestaña Organigrama, igual que `veAdjuntos` y
   * `exportaRegistro`.
   */
  veTodaLaEmpresa: boolean;
  /**
   * Abre la pestaña de KPIs: el pasivo de vacaciones de la plantilla activa,
   * los tiempos de aprobación por aprobador y las pendientes por antigüedad.
   * Se concede ficha a ficha desde la pestaña Organigrama (migración 038).
   *
   * ⚠️ A DIFERENCIA de las tres de arriba, esta llave NO se pliega dentro de
   * `esAdmin`. Las otras se las da el rol de administrador; esta no, porque
   * quien la pidió ya es administrador y plegarla abriría el panel a todos los
   * administradores, que es exactamente lo que la llave viene a evitar. La
   * columna `ve_kpis` es la única fuente, y por eso la casilla del panel
   * Organigrama se pinta también en las filas de los administradores.
   */
  veKpis: boolean;
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
  /**
   * El último día que trabaja. `null` mientras no haya baja registrada.
   *
   * Puede estar en el futuro: una baja se puede dejar programada y la persona
   * sigue trabajando, pidiendo y firmando hasta ese día incluido.
   */
  fechaRetiro: string | null;
  /** Quién registró la baja. Constancia: el saldo congelado es lo que se paga. */
  retiradoPor: string | null;
  retiradoAt: string | null;
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
  /**
   * La franja del día, solo en un PERMISO de un solo día. `null` = día completo,
   * que es lo que era todo antes de esto.
   *
   * `HH:MM`, sin segundos y sin zona: es la hora local de Colombia. Las dos van
   * siempre juntas — lo garantiza el CHECK `solicitudes_horas_coherentes`.
   *
   * Quien las traduce a lo que ve Google es `calendario()` (notificaciones.ts):
   * con hora arma un bloque horario con el desfase de Colombia explícito, y sin
   * ella el evento *all-day* de siempre.
   */
  horaInicio: string | null;
  horaFin: string | null;
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
  /**
   * La franja del día. SOLO en un permiso de un solo día, y las dos o ninguna.
   *
   * No es opcional con `?` sino `string | null`, al revés que `comentarios`: el
   * validador siempre las resuelve a un valor, y dejarlas opcionales obligaría a
   * cada llamante a decidir otra vez qué significa que falten.
   */
  horaInicio: string | null;
  horaFin: string | null;
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

/**
 * Un evento de Google Calendar. `todoElDia` decide de cuál de las dos formas se
 * leen `inicio` y `fin`, así que se lee ANTES que ellos.
 */
export interface EventoCalendario {
  calendarId: string;
  /**
   * El id del evento DENTRO de ese calendario. Se impone al crearlo, y por eso
   * sirve también para localizarlo después.
   */
  eventId: string;
  accion: AccionCalendario;
  // ⚠️ Los CUATRO campos de abajo —`todoElDia`, `resumen`, `inicio` y `fin`—
  // viajan SIEMPRE, también en un `borrar`, donde describen el evento tal como
  // está justo antes de desaparecer. Dejar alguno fuera cuando «no hace falta»
  // sería reintroducir por la puerta de atrás el problema que avisa
  // `PayloadEvento`: al otro lado, un campo ausente es `undefined`, y este
  // contrato no distingue eso de un valor.
  //
  // En `todoElDia` eso importa más que en ninguno, porque no es solo
  // descriptivo: la expresión que lo lee en n8n compara contra `false` y no por
  // veracidad, así que el `false` tiene que llegar EXPLÍCITO.
  //
  // Va en comentario de línea y no en JSDoc porque describe al GRUPO: como
  // bloque `/** */` se apilaría sobre el hover de `todoElDia` y parecería suyo.
  /** Si el evento ocupa el día entero o una franja horaria. */
  todoElDia: boolean;
  /** El título que se ve en Google: `${ETIQUETA_TIPO[tipo]} ${empleadoNombre}`. */
  resumen: string;
  /** `YYYY-MM-DD` si `todoElDia`; ISO con desfase (`...T09:00:00-05:00`) si no. */
  inicio: string;
  /**
   * Con `todoElDia`, fin EXCLUSIVO: Google no pinta el último día si no se le
   * suma uno. Con hora, el fin es el fin de verdad y NO se le suma nada.
   */
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

/**
 * Las clases de movimiento del registro. Las dos de modificación se llaman
 * EXACTAMENTE igual que en la base de datos (`CLASES_MODIFICACION`), y no con
 * sinónimos como `cambio`: una traducción de vocabulario entre la tabla y la
 * pantalla es una capa más que puede derivar en silencio, y no compra nada.
 */
export const CLASES_MOVIMIENTO = ['solicitud', 'fechas', 'anulacion'] as const;
export type ClaseMovimiento = (typeof CLASES_MOVIMIENTO)[number];

/**
 * Quién tomó la decisión.
 *
 * `aproximado` no es decorativo: en las sesiones con token legacy
 * `aprobador_user_id` es NULL, y entonces esto sale del `aprobador_correo`
 * congelado en el alta, que es *quién debía firmar* y no necesariamente quién
 * firmó —un admin pudo destrabarla en su lugar—. Enseñarlo sin marca sería
 * afirmar una autoría que no consta.
 */
export interface DecididaPor {
  nombre: string | null;
  correo: string;
  aproximado: boolean;
}

/**
 * Los campos comunes a toda fila del registro. `clase` y `estado` quedan
 * fuera: van en `Movimiento`, que los une para poder discriminar por `clase`.
 *
 * Plana y no una unión con objetos anidados, porque los filtros por tipo,
 * persona y año, los contadores y el CSV ya operan sobre una lista plana de
 * solicitudes y así siguen valiendo casi sin tocarlos.
 */
interface MovimientoBase {
  /** El de la solicitud o el de la modificación, según la clase. */
  id: string;
  /** Siempre el de la solicitud afectada, también en anulaciones y cambios. */
  solicitudId: string;
  empleadoNombre: string;
  empleadoCargo: string | null;
  solicitanteEmail: string;
  /** El tipo de la SOLICITUD afectada, para que el filtro por tipo siga valiendo. */
  tipo: TipoSolicitud;
  /**
   * Las fechas y días EFECTIVOS del movimiento. En una `anulacion` son las
   * PREVIAS: un CHECK de la 024 garantiza que las nuevas van a null. En un
   * `fechas` son las nuevas, que es lo que se propuso.
   */
  fechaInicio: string;
  fechaFin: string;
  /**
   * La franja del día, `HH:MM`. `null` en todo lo que no sea un permiso con
   * horario, y `null` SIEMPRE en una modificación: una anulación o un cambio de
   * fechas no tiene franja propia, así que su consulta ni siquiera selecciona
   * esas columnas y su mapeador las pone a `null` a mano.
   *
   * Van aquí y no solo en la rama de solicitud porque quien las pinta
   * —`fechasDeLaFila`, la misma función de las otras dos tablas— recibe la unión
   * entera, y una propiedad que existiera en una rama y no en la otra la
   * obligaría a discriminar por clase para algo que no lo necesita.
   */
  horaInicio: string | null;
  horaFin: string | null;
  /** Decimal: el histórico de la hoja trae medios días (6,5) y son dato real. */
  diasHabiles: number;
  decididaAt: string | null;
  /**
   * Regla para quien escriba la consulta de una tarea posterior: con
   * `estado === 'retirada'` esto va SIEMPRE a `null`. Una `retirada` la quita
   * el propio solicitante, no un aprobador —quién fue ya consta en
   * `solicitanteEmail`—, así que rellenarla con el `aprobador_correo`
   * congelado en el alta atribuiría el acto a alguien que nunca lo hizo.
   */
  decididaPor: DecididaPor | null;
  createdAt: string;
  /** `comentarios` en una solicitud; `motivo` en una anulación o un cambio. */
  motivo: string | null;
}

/**
 * Una fila del registro: una solicitud, o una anulación o cambio de fecha ya
 * cerrados.
 *
 * Unión discriminada por `clase`, y no un `estado: EstadoSolicitud |
 * EstadoModificacion` suelto: los dos enums comparten los literales
 * `'pendiente'`, `'aprobada'` y `'rechazada'`, así que sin el discriminante
 * TypeScript no puede afinar cuál de los dos describe la fila, y un `switch`
 * sobre `estado` en el front quedaría incompleto sin que el compilador se
 * quejara.
 */
export type Movimiento =
  | (MovimientoBase & {
      clase: 'solicitud';
      estado: EstadoSolicitud;
      /**
       * Cuándo se anuló la solicitud, o `null` si no se anuló.
       *
       * Va SOLO en esta rama y no en `MovimientoBase`: una unión discriminada
       * sirve justo para esto, y colgar aquí un campo que solo significa algo en
       * la clase `solicitud` ensuciaría la forma común de las tres —una
       * `fechas` o una `anulacion` no tienen un «¿se anuló ESTA fila?» que
       * contestar, son ellas mismas el movimiento de la anulación—.
       *
       * Hace falta porque una solicitud anulada y una rechazada por el jefe
       * comparten `estado: 'rechazada'`, y son cosas distintas: `chipDeSolicitud`
       * (`dominio.ts` del portal) usa este campo para no rotular «Rechazada» una
       * fila que el propio dueño anuló, con el motivo que ESE dueño escribió al
       * pedirlo — leído junto a «Rechazada» ese motivo se entendería como la
       * razón que dio el jefe para negarla.
       */
      anuladaAt: string | null;
      /**
       * Notas al margen del histórico importado de la hoja, o `null` si no
       * hay ninguna.
       *
       * Va SOLO en esta rama, por la misma razón que `anuladaAt`: es un dato
       * DE LA SOLICITUD, no del movimiento en general —una `fechas` o una
       * `anulacion` no tienen observaciones propias, son ellas mismas el
       * cambio que se anota—, y colgarlo en `MovimientoBase` ensuciaría la
       * forma común de las tres ramas con un campo que dos de ellas no usan.
       *
       * Hace falta porque el CSV que sustituye al Excel de nómina lleva esta
       * columna desde siempre —era la octava—, y perderla al pasar de
       * `Solicitud` a `Movimiento` cambia la forma de un fichero del que
       * depende nómina. Mantenerla fuera de `MovimientoBase` es además lo que
       * hace que exportar una `fechas` o una `anulacion` no compile: ninguna
       * de las dos ramas tiene `observaciones` que leer.
       */
      observaciones: string | null;
    })
  | (MovimientoBase & { clase: 'fechas' | 'anulacion'; estado: EstadoModificacion });
