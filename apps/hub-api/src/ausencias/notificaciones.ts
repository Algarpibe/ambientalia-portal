import { sumarDias } from './festivos.js';
import {
  CALENDARIO_STAFF,
  COPIA_INCAPACIDADES,
  FIRMA_EMPRESA,
  FIRMA_GERENCIA,
  HOJA_ID,
  PESTANA,
  urlPortal,
} from './config.js';
import {
  ESTADOS_EN_TRAMITE,
  ETIQUETA_TIPO,
  type CorreoEvento,
  type EstadoSolicitud,
  type EventoCalendario,
  type EventoModificacion,
  type EventoSolicitud,
  type FilaHoja,
  type Modificacion,
  type PayloadEvento,
  type Solicitud,
} from './types.js';

// Los correos, eventos de calendario y filas de hoja que antes vivían dentro de
// los nodos de n8n. Aquí son funciones puras con tests: cambiar un texto ya no
// obliga a abrir n8n, y una interpolación rota se ve en el test, no en el buzón
// de un empleado.
//
// Cada evento de la cola produce EXACTAMENTE UN correo. Por eso el alta de una
// solicitud genera dos eventos (`creada` = acuse al solicitante, `aprobacion` =
// aviso a quien aprueba): así el flujo de n8n es una cadena lineal.

/** Nombre del periodo tal como lo escribían los formularios del flujo viejo. */
const PERIODO: Record<Solicitud['tipo'], string> = {
  vacaciones: 'de vacaciones',
  permiso: 'de permiso',
  compensatorio: 'de compensatorio',
  incapacidad: 'de incapacidad',
};

/** «día» / «días», para no escribir «1 días hábiles» en un correo. */
function dias(n: number): string {
  return `${n} ${n === 1 ? 'día hábil' : 'días hábiles'}`;
}

function bloqueFechas(s: Solicitud): string {
  const p = PERIODO[s.tipo];
  return [
    `📅 Fecha primer día ${p}: ${s.fechaInicio}`,
    `📅 Fecha último día ${p}: ${s.fechaFin}`,
    '',
    `📊 Total solicitado: ${dias(s.diasHabiles)}`,
  ].join('\n');
}

function bloqueComentarios(s: Solicitud): string {
  return s.comentarios ? `\nComentarios: ${s.comentarios}\n` : '\n';
}

/** El adjunto se menciona solo si existe: el flujo viejo escribía «undefined». */
function bloqueAdjunto(s: Solicitud): string {
  return s.adjunto ? `\n📎 Documento adjunto: ${s.adjunto.nombreArchivo}\n` : '';
}

// ── Los seis correos ───────────────────────────────────────────────────────

function acuseSolicitante(s: Solicitud) {
  const esInc = s.tipo === 'incapacidad';
  // No hay correo de avance intermedio: el empleado recibe este acuse y el
  // veredicto, dos correos. Por eso el acuse anuncia el circuito de dos firmas
  // cuando lo hay, para que la espera no sorprenda.
  const cierre = esInc
    ? 'Muchas gracias por reportar tu incapacidad. Esperamos tu pronta recuperación.'
    : s.segundoAprobadorCorreo
      ? 'Tu solicitud pasa por dos aprobaciones: primero tu jefe inmediato y después su superior. Te informaremos por este medio del resultado final.'
      : 'Te informaremos por este medio del estado de aprobación de la solicitud.';
  return {
    para: esInc ? destinatarios(s.solicitanteEmail, COPIA_INCAPACIDADES, s.copiaCorreo) : s.solicitanteEmail,
    asunto: esInc
      ? '¡Reporte de incapacidad registrado exitosamente!'
      : `¡Solicitud ${PERIODO[s.tipo]} registrada exitosamente!`,
    cuerpo: [
      `¡Hola ${s.empleadoNombre}!`,
      '',
      esInc
        ? 'Tu reporte de incapacidad ha quedado registrado. Este es el resumen:'
        : `Tu solicitud ${PERIODO[s.tipo]} ha sido registrada. Este es el resumen:`,
      '',
      bloqueFechas(s),
      bloqueComentarios(s) + bloqueAdjunto(s),
      cierre,
      '',
      'Saludos,',
      FIRMA_EMPRESA,
    ].join('\n'),
  };
}

function avisoAprobador(s: Solicitud) {
  return {
    para: s.aprobadorCorreo ?? '',
    asunto: `Solicitud ${PERIODO[s.tipo]} de ${s.empleadoNombre}`,
    cuerpo: [
      '¡Hola!',
      '',
      `Has recibido una solicitud ${PERIODO[s.tipo]} de ${s.empleadoNombre}${s.empleadoCargo ? ` (${s.empleadoCargo})` : ''}.`,
      '',
      bloqueFechas(s),
      bloqueComentarios(s) + bloqueAdjunto(s),
      // El cambio de fondo frente al flujo viejo: en vez de un formulario
      // incrustado en el correo que dejaba la ejecución de n8n colgada
      // esperando, se aprueba en el portal, donde queda rastro de quién y cuándo.
      `Puedes aprobarla o rechazarla aquí: ${urlPortal()}/ausencias`,
      '',
      'Saludos,',
      FIRMA_EMPRESA,
    ].join('\n'),
  };
}

/**
 * El aviso al segundo aprobador. Lee `segundoAprobadorCorreo` DIRECTAMENTE, y no
 * «a quien le toque según el estado»: hacerlo polimórfico ataría el correo al
 * estado de la fila en el momento de construir el payload, que es una dependencia
 * sutil y evitable.
 *
 * Sin copia a administración, a diferencia de los correos de decisión: esto es un
 * trámite interno, no un veredicto. Y no se nombra al primer firmante — los
 * correos de esta app no nombran a nadie, y un campo que puede faltar acaba
 * escribiendo «undefined» en el buzón de alguien.
 */
function avisoSegundoAprobador(s: Solicitud) {
  return {
    para: s.segundoAprobadorCorreo ?? '',
    asunto: `Segunda aprobación: solicitud ${PERIODO[s.tipo]} de ${s.empleadoNombre}`,
    cuerpo: [
      '¡Hola!',
      '',
      `Tienes pendiente la segunda aprobación de una solicitud ${PERIODO[s.tipo]} de ${s.empleadoNombre}${s.empleadoCargo ? ` (${s.empleadoCargo})` : ''}.`,
      '',
      'Esta solicitud ya cuenta con el visto bueno de su jefe inmediato. Falta tu aprobación para que quede en firme.',
      '',
      bloqueFechas(s),
      bloqueComentarios(s) + bloqueAdjunto(s),
      `Puedes aprobarla o rechazarla aquí: ${urlPortal()}/ausencias`,
      '',
      'Saludos,',
      FIRMA_EMPRESA,
    ].join('\n'),
  };
}

/**
 * La lista de destinatarios, sin repetidos y en el orden en que se pasan.
 *
 * Deduplicar no es cosmético: los dos firmantes de la cadena y la copia a
 * administración se solapan a menudo —hoy media plantilla cuelga del mismo buzón
 * que ya va en copia—, y sin esto el mismo correo aparecería dos veces en el
 * `sendTo` de Gmail. Compara en minúsculas pero conserva la grafía original.
 */
function destinatarios(...correos: (string | null | undefined)[]): string {
  const vistos = new Set<string>();
  const lista: string[] = [];
  for (const c of correos) {
    if (!c) continue;
    const clave = c.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    lista.push(c);
  }
  return lista.join(', ');
}

/**
 * Quiénes se enteran de una decisión: el solicitante, **toda la cadena que la
 * firmó**, quien debía enterarse sin firmar, y administración.
 *
 * Los dos aprobadores van incluidos a propósito. El segundo suele coincidir con
 * la copia a administración y por eso parecía que ya funcionaba, pero el jefe
 * inmediato —que dio el primer visto bueno— no recibía nada: daba su firma y no
 * volvía a saber en qué acabó.
 *
 * `informadoCorreo` es el de segundo nivel cuando su ficha no exige segunda
 * firma. Nunca coexiste con `segundoAprobadorCorreo`, así que esto no manda dos
 * correos a nadie: uno de los dos es siempre `null` y `destinatarios` lo filtra.
 *
 * Esa exclusión la garantiza `aprobadoresDe` (jerarquia.ts), que deriva los dos
 * campos juntos, y `crearSolicitud`, que los congela de esa misma llamada. NO la
 * fuerza ni el tipo ni la base de datos —la 023 no lleva ningún CHECK—, así que
 * cualquier vía nueva que escriba estos dos campos tiene que respetarla a mano.
 */
const cadenaDeDecision = (s: Solicitud) =>
  destinatarios(
    s.solicitanteEmail,
    s.aprobadorCorreo,
    s.segundoAprobadorCorreo,
    s.informadoCorreo,
    s.copiaCorreo,
  );

function correoAprobada(s: Solicitud) {
  const disfruta = s.tipo === 'vacaciones' ? '\n¡Disfrútalas!\n' : '';
  return {
    para: cadenaDeDecision(s),
    asunto: `✅ Tu solicitud ${PERIODO[s.tipo]} ha sido aprobada`,
    cuerpo: [
      `¡Hola ${s.empleadoNombre}!`,
      '',
      `Tu solicitud ${PERIODO[s.tipo]} ha sido ✅ *aprobada*.`,
      '',
      bloqueFechas(s),
      disfruta,
      'Saludos,',
      FIRMA_GERENCIA,
    ].join('\n'),
  };
}

function correoRechazada(s: Solicitud) {
  return {
    // Misma cadena que en la aprobación, y aquí importa más: si el segundo
    // superior tumba algo que el jefe inmediato ya había avalado, el jefe tiene
    // que enterarse — es quien va a tener que reorganizar el trabajo.
    para: cadenaDeDecision(s),
    asunto: `❌ Tu solicitud ${PERIODO[s.tipo]} ha sido rechazada`,
    cuerpo: [
      `Hola ${s.empleadoNombre}:`,
      '',
      `Tu solicitud ${PERIODO[s.tipo]} (${s.fechaInicio} a ${s.fechaFin}) ha sido ❌ *rechazada*.`,
      // El motivo es la mejora que pedía el flujo viejo: antes el correo de
      // rechazo no decía por qué y obligaba a preguntar.
      s.motivoRechazo ? `\nMotivo: ${s.motivoRechazo}\n` : '',
      'Si tienes dudas, por favor comunícate conmigo.',
      '',
      'Saludos,',
      FIRMA_GERENCIA,
    ].join('\n'),
  };
}

// ── Efectos en Google ──────────────────────────────────────────────────────

/**
 * El id que le IMPONEMOS al evento de Google, derivado del uuid de la solicitud.
 *
 * Google deja que quien crea un evento le fije el id, y esa es la única razón
 * por la que una anulación puede borrarlo después. La alternativa —buscarlo por
 * título y fechas— se cae sola: el título es «Vacaciones <nombre>», así que dos
 * ausencias solapadas de la misma persona bastan para borrar la que no era.
 *
 * El formato lo exige Google: base32hex, de 5 a 1024 caracteres de [0-9a-v]. Un
 * uuid sin guiones son 32 caracteres de [0-9a-f], que cae dentro. Hay un candado
 * en los tests sobre ese alfabeto, y no es decorativo: una derivación que se
 * salga de él no falla aquí, falla contra Google y solo en producción.
 */
export const idDeEventoCalendario = (solicitudId: string): string => solicitudId.replaceAll('-', '');

/** El evento *all-day* del calendario «Ambientalia Staff», recién creado. */
function calendario(s: Solicitud): EventoCalendario {
  return {
    calendarId: CALENDARIO_STAFF,
    eventId: idDeEventoCalendario(s.id),
    accion: 'crear',
    resumen: `${ETIQUETA_TIPO[s.tipo]} ${s.empleadoNombre}`,
    inicio: s.fechaInicio,
    // Google trata el `end` de un evento all-day como EXCLUSIVO: sin este +1 el
    // último día de la ausencia no se pinta.
    fin: sumarDias(s.fechaFin, 1),
  };
}

/** La fila para la pestaña correspondiente, con los encabezados de siempre. */
function hoja(s: Solicitud): FilaHoja {
  const columnas: Record<string, string | number> = {
    'Nombre y Apellidos': s.empleadoNombre,
    'Fecha Inicio': s.fechaInicio,
    'Fecha Fin': s.fechaFin,
    Días: s.diasHabiles,
    Tipo: ETIQUETA_TIPO[s.tipo],
  };
  // Las incapacidades no se aprueban, así que su pestaña no tiene «Aprobado?»
  // sino «Adjunto?». Es el esquema real de la hoja, no una simplificación.
  if (s.tipo === 'incapacidad') {
    columnas['Adjunto?'] = s.adjunto ? s.adjunto.nombreArchivo : 'No';
  } else {
    columnas.Comentarios = s.comentarios ?? '';
    columnas['Aprobado?'] = s.estado === 'aprobada' ? 'Sí' : s.estado === 'rechazada' ? 'No' : '';
  }
  return { documentId: HOJA_ID, pestana: PESTANA[s.tipo], columnas };
}

// ── Ensamblado ─────────────────────────────────────────────────────────────

const CORREO_DE: Record<EventoSolicitud, (s: Solicitud) => CorreoEvento> = {
  creada: acuseSolicitante,
  aprobacion: avisoAprobador,
  aprobacion_2: avisoSegundoAprobador,
  aprobada: correoAprobada,
  rechazada: correoRechazada,
  registrada: acuseSolicitante,
};

/**
 * El payload de un evento: un correo, y los efectos en Google que le tocan.
 *
 * Reparto de los efectos, para que ninguno se duplique ni se pierda:
 *  - `creada`       → nada más (la solicitud aún no es firme).
 *  - `aprobacion`   → nada más. Quien aprueba abre el PDF desde el portal.
 *  - `aprobacion_2` → nada más, por lo mismo.
 *  - `aprobada`     → calendario + fila en la hoja.
 *  - `rechazada`    → fila en la hoja (sin calendario: no hay ausencia).
 *  - `registrada`   → calendario + hoja de una vez (la incapacidad no pasa por
 *                     aprobación, así que es su único evento).
 *
 * Y los tres de la modificación, que salen por `construirPayloadModificacion`:
 *  - `modificacion_solicitada` → nada más. Solo correo, al decisor.
 *  - `modificacion_aprobada`   → **calendario cuando se puede** —un `actualizar`
 *                     o un `borrar` sobre el evento que creó la `aprobada`, ver
 *                     `correccionDeCalendario`— y **hoja nunca**: a la fila no
 *                     se puede volver, porque n8n hace `append` y no queda
 *                     constancia de dónde cayó. Por eso el correo sigue pidiendo
 *                     el ajuste a mano, pero ya solo el de la hoja.
 *  - `modificacion_rechazada`  → nada más. La solicitud queda igual que estaba.
 *
 * Ya no hay campo `drive`: la copia de los adjuntos a Google Drive se retiró, y
 * el workflow de n8n perdió los tres nodos que la hacían. **No reintroducirlo sin
 * volver a montarlos**, y menos «por compatibilidad»: el IF que lo leía comparaba
 * `payload.drive !== null`, y con el campo ausente eso es `undefined !== null`,
 * o sea `true` para TODOS los eventos.
 */
export function construirPayload(s: Solicitud, evento: EventoSolicitud): PayloadEvento {
  const conCalendario = evento === 'aprobada' || evento === 'registrada';
  const conHoja = evento === 'aprobada' || evento === 'rechazada' || evento === 'registrada';

  return {
    tipo: s.tipo,
    tipoEtiqueta: ETIQUETA_TIPO[s.tipo],
    estado: s.estado,
    empleadoNombre: s.empleadoNombre,
    correo: CORREO_DE[evento](s),
    calendario: conCalendario ? calendario(s) : null,
    hoja: conHoja ? hoja(s) : null,
  };
}

// ── La modificación de una solicitud ya enviada ────────────────────────────

/** Las fechas de la solicitud tal como estaban al pedir el cambio. */
function bloqueFechasPrevias(m: Modificacion): string {
  return `📅 Fechas actuales: ${m.fechaInicioPrevia} a ${m.fechaFinPrevia} (${dias(m.diasHabilesPrevios)})`;
}

/**
 * Lo que se pide. Se escribe entero aquí y no se deja para el portal porque
 * quien recibe esto tiene que poder decidir leyendo el correo: si solo dijera
 * «hay un cambio pendiente», el aviso no aportaría nada sobre el enlace.
 *
 * Los campos nulos se guardan detrás de la clase, nunca se interpolan a pelo:
 * una anulación los trae los tres en `null` y el flujo viejo ya escribió
 * «undefined» en el buzón de alguien por hacer justo eso.
 */
function bloqueCambio(m: Modificacion): string {
  if (m.clase === 'anulacion') {
    return 'Pide ANULAR la solicitud: esos días dejarían de estar reservados.';
  }
  const nuevas = `${m.fechaInicioNueva} a ${m.fechaFinNueva}`;
  const cuenta = m.diasHabilesNuevos === null ? '' : ` (${dias(m.diasHabilesNuevos)})`;
  return `📅 Fechas propuestas: ${nuevas}${cuenta}`;
}

/**
 * El aviso de que alguien pide cambiar una solicitud suya.
 *
 * Va SOLO al decisor, por el mismo criterio que `avisoSegundoAprobador`: es un
 * trámite interno, no un veredicto. Ni `cadenaDeDecision` ni `copiaCorreo`.
 *
 * El destinatario sale de la MODIFICACIÓN (`m.aprobadorCorreo`), que es la copia
 * congelada de la solicitud, y no de recalcular el turno sobre `s`: si la
 * solicitud avanzara de nivel entre el alta de la propuesta y el envío del
 * correo, el aviso se iría a alguien distinto del que va a poder decidirla.
 */
function avisoModificacion(s: Solicitud, m: Modificacion): CorreoEvento {
  const que = m.clase === 'anulacion' ? 'anular' : 'cambiar las fechas de';
  return {
    para: m.aprobadorCorreo,
    asunto: `Cambio pedido: solicitud ${PERIODO[s.tipo]} de ${s.empleadoNombre}`,
    cuerpo: [
      '¡Hola!',
      '',
      `${s.empleadoNombre}${s.empleadoCargo ? ` (${s.empleadoCargo})` : ''} pide ${que} una solicitud ${PERIODO[s.tipo]} que ya te envió.`,
      '',
      bloqueFechasPrevias(m),
      bloqueCambio(m),
      m.motivo ? `\nMotivo: ${m.motivo}\n` : '',
      // Mientras no lo decidas, la solicitud sigue como estaba: es la frase que
      // evita la llamada de «¿entonces se ha cambiado ya o no?».
      'La solicitud NO cambia hasta que apruebes o rechaces esta petición.',
      '',
      `Puedes aprobarla o rechazarla aquí: ${urlPortal()}/ausencias`,
      '',
      'Saludos,',
      FIRMA_EMPRESA,
    ].join('\n'),
  };
}

// ── La decisión de la propuesta ────────────────────────────────────────────

/**
 * Si el cambio toca algo que **ya está en Google**.
 *
 * Función pura y con nombre propio porque de ella depende que el ⚠️ signifique
 * algo. Si la original seguía `pendiente`, nunca se mandó nada al calendario ni
 * a la hoja, y el aviso sería una alarma falsa: entrenar a la gente a ignorar
 * el ⚠️ es la forma segura de que el día que importe no lo lean.
 *
 * ⚠️ NO añadir `registrada` aquí, aunque sea el otro evento que lleva efectos
 * de Google (`construirPayload`). Una incapacidad no admite modificación
 * —`decisorDeModificacion` devuelve `null` y `estadoAdmiteModificacion` lo
 * exige—, así que `registrada` no puede ser nunca un `estadoPrevio`: la rama
 * sería código muerto que además haría creer que el caso está contemplado.
 */
const tocaGoogle = (estadoPrevio: EstadoSolicitud): boolean => estadoPrevio === 'aprobada';

/**
 * La corrección que hay que hacerle al evento del calendario, o `null` si no
 * hay ninguna que hacer.
 *
 * Devuelve `null` por dos motivos que no hay que confundir:
 *
 *  - `tocaGoogle` dice que no: la solicitud nunca estuvo aprobada, así que
 *    nunca se mandó nada al calendario y no hay evento que tocar.
 *  - No hay `eventoCalendarioId`: la solicitud se aprobó ANTES de que
 *    empezáramos a imponer el id, y su evento lleva el que Google inventó, que
 *    nadie apuntó. Existe, pero no se puede localizar. Esas se van vaciando
 *    solas y hasta entonces siguen con el aviso manual.
 *
 * Es la ÚNICA fuente de esta decisión: el correo pregunta por aquí y el payload
 * se construye desde aquí, así que el texto que lee administración y lo que n8n
 * hace de verdad no pueden discrepar. Un ⚠️ que pide ajustar a mano algo que ya
 * se ajustó solo es la forma segura de que dejen de leerlos.
 */
function correccionDeCalendario(s: Solicitud, m: Modificacion): EventoCalendario | null {
  if (!tocaGoogle(m.estadoPrevio) || s.eventoCalendarioId === null) return null;
  return {
    // Las fechas salen de la solicitud YA aplicada, que es lo que se quiere en
    // los dos casos: en un cambio de fechas son las nuevas, y en una anulación
    // `aplicarALaSolicitud` no las tocó, así que describen el evento que se va
    // a borrar.
    ...calendario(s),
    eventId: s.eventoCalendarioId,
    accion: m.clase === 'anulacion' ? 'borrar' : 'actualizar',
  };
}

/**
 * Las CUATRO fechas y los dos recuentos, que es lo único que permite ajustar el
 * calendario a mano.
 *
 * Se redacta desde la PROPUESTA y no desde la solicitud ya actualizada —que es
 * el objeto que se tiene más a mano al notificar—: desde la solicitud el correo
 * diría «cambiada a 6-8 jul» sin decir desde qué, y ese «desde qué» es
 * justamente lo que hay que buscar en el calendario para corregirlo.
 */
function bloqueAntesYDespues(m: Modificacion): string {
  // El recuento nuevo se guarda detrás del null, como en `bloqueCambio`: aquí
  // no puede faltar (esto solo se llama con `clase = 'fechas'`, y el CHECK de la
  // 024 lo exige), pero interpolarlo a pelo es cómo se escribe «undefined» en el
  // buzón de alguien el día que una clase nueva pase por aquí.
  const cuenta = m.diasHabilesNuevos === null ? '' : ` (${dias(m.diasHabilesNuevos)})`;
  return [
    `📅 Antes: ${m.fechaInicioPrevia} a ${m.fechaFinPrevia} (${dias(m.diasHabilesPrevios)})`,
    `📅 Ahora: ${m.fechaInicioNueva} a ${m.fechaFinNueva}${cuenta}`,
  ].join('\n');
}

/**
 * El párrafo de «esto que queda no se corrige solo».
 *
 * La hoja siempre está aquí: n8n hace `append` y no se guarda en qué fila cayó,
 * así que a esa fila no se puede volver. El calendario solo cuando no se ha
 * podido corregir —ver `correccionDeCalendario`—, y entonces el párrafo vuelve
 * a ser el de siempre.
 */
function avisoDeAjustarGoogle(s: Solicitud, m: Modificacion): string {
  // Se nombra a quien tiene que actuar. Sin el «Administración:», el párrafo se
  // lee como una tarea para el trabajador —el correo está escrito en segunda
  // persona hacia él— y acaba sin hacerla nadie.
  const anula = m.clase === 'anulacion';
  if (correccionDeCalendario(s, m) !== null) {
    // Se dice que el calendario ya está hecho, y no se calla: quien lee esto
    // llevaba meses yendo a Google, y sin la frase iría igual, a mirar un
    // evento que ya está bien.
    return anula
      ? '⚠️ Administración: el evento del calendario ya se ha borrado solo. La fila de la hoja no: hay que borrarla a mano.'
      : '⚠️ Administración: el evento del calendario ya se ha corregido solo. La fila de la hoja no: hay que ajustarla a mano a las fechas nuevas.';
  }
  return anula
    ? '⚠️ Administración: esta ausencia ya estaba en el calendario y en la hoja. NO se borran solas: hay que borrar a mano el evento del calendario y la fila de la hoja.'
    : '⚠️ Administración: esta ausencia ya estaba en el calendario y en la hoja. NO se corrigen solas: hay que ajustar a mano el evento del calendario y la fila de la hoja a las fechas nuevas.';
}

/**
 * El prefijo del asunto cuando queda algo que tocar a mano en Google.
 *
 * Sin esto el correo llega con un asunto indistinguible de cualquier otro «✅
 * aprobado», y quien tiene que actuar —administración, que va en
 * `copiaCorreo`— no vería la señal hasta abrirlo. La condición de que aparezca
 * sigue siendo `tocaGoogle` y solo esa; lo que cambia es QUÉ nombra, porque un
 * ⚠️ que pide ir al calendario cuando el calendario ya está corregido es
 * exactamente lo que enseña a no leerlos.
 */
const prefijoDeAsunto = (s: Solicitud, m: Modificacion): string => {
  if (!tocaGoogle(m.estadoPrevio)) return '';
  return correccionDeCalendario(s, m) !== null ? '⚠️ Ajustar la hoja — ' : '⚠️ Ajustar calendario y hoja — ';
};

/**
 * Bloque opcional: la línea en blanco viaja CON él.
 *
 * Los opcionales no pueden ser `''` sueltos dentro del array del cuerpo: el
 * `join('\n')` les pone su salto igualmente, y con dos opcionales ausentes
 * —sin motivo y sin aviso de Google— salían dos líneas en blanco de más justo
 * antes de la firma.
 */
const siHay = (condicion: boolean, ...lineas: string[]): string[] => (condicion ? ['', ...lineas] : []);

/**
 * El cambio se aprueba. Va a `cadenaDeDecision(s)` entera, no solo a quien lo
 * pidió: el primer firmante avaló unas fechas y tiene que enterarse de que ya
 * no son esas — es quien reorganiza el trabajo. Mismo argumento que
 * `correoRechazada`.
 */
function correoModificacionAprobada(s: Solicitud, m: Modificacion): CorreoEvento {
  const anula = m.clase === 'anulacion';
  // ⚠️ La solicitud sigue SIN conceder: el ✅ es del cambio, no de las
  // vacaciones. Sin esta línea, quien viene del acuse del alta —que le prometió
  // informarle «del estado de aprobación»— lee un ✅ con sus fechas nuevas y
  // compra el vuelo. Es la simétrica de «La solicitud NO cambia hasta que
  // apruebes» del aviso al jefe.
  //
  // Solo para un cambio de FECHAS: una anulación aprobada sobre una `pendiente`
  // deja la solicitud `rechazada`, así que decirle que «sigue pendiente de
  // aprobación» sería falso justo al revés.
  const sigueEnTramite = !anula && ESTADOS_EN_TRAMITE.includes(m.estadoPrevio);
  return {
    para: cadenaDeDecision(s),
    asunto: anula
      ? `${prefijoDeAsunto(s, m)}✅ Anulada la solicitud ${PERIODO[s.tipo]} de ${s.empleadoNombre}`
      : `${prefijoDeAsunto(s, m)}✅ Cambio de fechas aprobado: solicitud ${PERIODO[s.tipo]} de ${s.empleadoNombre}`,
    cuerpo: [
      `Hola ${s.empleadoNombre}:`,
      '',
      anula
        ? `Se ha ✅ *aprobado* anular tu solicitud ${PERIODO[s.tipo]}. Esos días dejan de estar reservados.`
        : `Se ha ✅ *aprobado* el cambio de fechas de tu solicitud ${PERIODO[s.tipo]}.`,
      '',
      anula
        ? `📅 Fechas anuladas: ${m.fechaInicioPrevia} a ${m.fechaFinPrevia} (${dias(m.diasHabilesPrevios)})`
        : bloqueAntesYDespues(m),
      ...siHay(sigueEnTramite, 'Tu solicitud sigue pendiente de aprobación: esto solo cambia las fechas que se van a firmar.'),
      // «del cambio» y no «Motivo:» a secas: en el correo de rechazo la misma
      // palabra encabeza el motivo del JEFE, y los dos van a los mismos
      // destinatarios sobre el mismo objeto. Este es el que escribió QUIEN PIDIÓ
      // el cambio (`motivoRechazo` de la propuesta solo se llena al rechazarla).
      ...siHay(!!m.motivo, `Motivo del cambio: ${m.motivo}`),
      ...siHay(tocaGoogle(m.estadoPrevio), avisoDeAjustarGoogle(s, m)),
      '',
      'Saludos,',
      FIRMA_GERENCIA,
    ].join('\n'),
  };
}

/**
 * El cambio se rechaza. También a la cadena entera: el primer firmante tiene
 * que saber que las fechas que avaló siguen en pie.
 *
 * Sin el ⚠️ de Google en ningún caso, ni siquiera sobre una solicitud aprobada:
 * aquí no se ha tocado nada, así que no hay nada que ajustar. Un ⚠️ que no pide
 * ninguna acción es exactamente lo que enseña a no leerlos.
 */
function correoModificacionRechazada(s: Solicitud, m: Modificacion): CorreoEvento {
  const que = m.clase === 'anulacion' ? 'anular tu solicitud' : 'cambiar las fechas de tu solicitud';
  return {
    para: cadenaDeDecision(s),
    asunto: `❌ Cambio rechazado: solicitud ${PERIODO[s.tipo]} de ${s.empleadoNombre}`,
    cuerpo: [
      `Hola ${s.empleadoNombre}:`,
      '',
      `Tu petición de ${que} ${PERIODO[s.tipo]} ha sido ❌ *rechazada*.`,
      '',
      // QUÉ se pidió. Sin esto, el segundo firmante y administración leen un
      // rechazo sin saber qué se tumbó, y dos rechazos seguidos sobre la misma
      // solicitud producen correos idénticos byte a byte.
      //
      // Sale de la propuesta, y no choca con el párrafo de abajo: lo propuesto
      // es un dato inmutable de la petición —no puede quedar obsoleto—, mientras
      // que lo que queda en pie sí depende de la fila viva.
      //
      // Solo en un cambio de fechas: en una anulación, la primera línea ya dice
      // literalmente qué se pidió («tu petición de anular tu solicitud»).
      ...(m.clase === 'fechas' ? [bloqueCambio(m), ''] : []),
      // Estas fechas salen de la SOLICITUD y no de la foto de la propuesta, al
      // revés que en el correo de aprobación: al rechazar no se ha tocado la
      // fila, así que la fila es la verdad de lo que queda en pie —y si un admin
      // la corrigió por PATCH entre medias, la foto ya no lo sería.
      `📅 La solicitud sigue como estaba: ${s.fechaInicio} a ${s.fechaFin} (${dias(s.diasHabiles)})`,
      // El motivo del JEFE, que es la mejora que pedía el flujo viejo: un
      // rechazo sin explicación obliga a preguntar por privado. Etiquetado
      // «del rechazo» para no confundirlo con el «Motivo del cambio» del correo
      // de aprobación, que es del trabajador y va a los mismos buzones.
      ...siHay(!!m.motivoRechazo, `Motivo del rechazo: ${m.motivoRechazo}`),
      '',
      'Si tienes dudas, por favor comunícate conmigo.',
      '',
      'Saludos,',
      FIRMA_GERENCIA,
    ].join('\n'),
  };
}

/**
 * Los tres avisos de la modificación, cada uno con su texto.
 *
 * `satisfies Record<...>` completo y ya no `Partial`: los tres eventos que
 * admite el CHECK de la 024 tienen aquí quien los redacte, así que el mapa es
 * exhaustivo y un evento nuevo en `EVENTOS_MODIFICACION` no compila hasta que
 * se le escribe el correo. `satisfies` y no una anotación para que el tipo
 * inferido conserve las claves literales, que es lo que hace que el `evento` de
 * `construirPayloadModificacion` admita exactamente lo que hay redactado.
 */
const CORREO_MODIFICACION_DE = {
  modificacion_solicitada: avisoModificacion,
  modificacion_aprobada: correoModificacionAprobada,
  modificacion_rechazada: correoModificacionRechazada,
} satisfies Record<EventoModificacion, (s: Solicitud, m: Modificacion) => CorreoEvento>;

/**
 * El payload de un aviso de modificación.
 *
 * `hoja` va a `null` SIEMPRE: n8n hace `append` y no queda constancia de en qué
 * fila cayó, así que a esa fila no se puede volver. `calendario` va a `null`
 * salvo cuando el cambio se aprueba y hay un evento localizable que corregir
 * —ver `correccionDeCalendario`—, y entonces lleva la acción que toque.
 *
 * ⚠️ ORDEN DE DESPLIEGUE. Este es el punto exacto donde un `modificacion_*`
 * empieza a llevar `calendario` no nulo, y el IF de n8n solo mira si es `null`.
 * Con el workflow ANTERIOR, esto entra en el nodo de crear: una anulación
 * estrenaría un evento nuevo en el calendario para una ausencia que se acaba de
 * cancelar. El Switch por `accion` tiene que estar publicado en n8n ANTES de
 * desplegar esto, nunca después. Es la misma trampa que documenta el aviso del
 * `drive` en `construirPayload`, cobrada por el otro lado.
 */
export function construirPayloadModificacion(
  s: Solicitud,
  m: Modificacion,
  evento: keyof typeof CORREO_MODIFICACION_DE,
): PayloadEvento {
  return {
    tipo: s.tipo,
    tipoEtiqueta: ETIQUETA_TIPO[s.tipo],
    // El estado de la SOLICITUD, que no ha cambiado: la propuesta vive aparte.
    estado: s.estado,
    empleadoNombre: s.empleadoNombre,
    correo: CORREO_MODIFICACION_DE[evento](s, m),
    // Solo la aprobación toca Google. Pedir el cambio no cambia nada todavía, y
    // rechazarlo deja la solicitud exactamente como estaba.
    calendario: evento === 'modificacion_aprobada' ? correccionDeCalendario(s, m) : null,
    hoja: null,
  };
}

/** Los eventos que dispara el alta de una solicitud, en orden de envío. */
export function eventosDeAlta(tipo: Solicitud['tipo']): EventoSolicitud[] {
  // La incapacidad se informa y ya: no hay a quién avisar para que apruebe.
  return tipo === 'incapacidad' ? ['registrada'] : ['creada', 'aprobacion'];
}
