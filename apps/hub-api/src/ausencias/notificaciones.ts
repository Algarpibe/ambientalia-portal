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
  ETIQUETA_TIPO,
  type CorreoEvento,
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

/** El evento *all-day* del calendario «Ambientalia Staff». */
function calendario(s: Solicitud) {
  return {
    calendarId: CALENDARIO_STAFF,
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
 *  - `modificacion_aprobada`   → nada más. **Ni calendario ni hoja**, aunque la
 *                     original ya estuviera en Google: el evento viejo habría
 *                     que CORREGIRLO, y emitir `calendario` aquí crearía uno
 *                     nuevo duplicado en vez de arreglar nada. El correo lleva
 *                     el aviso de ajustarlo a mano.
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

/**
 * Los eventos de modificación que esta fase sabe redactar. Los otros dos
 * (`modificacion_aprobada` y `modificacion_rechazada`) llegan con la decisión,
 * y hasta entonces el tipo de `evento` no los admite: así no hay forma de
 * encolar un evento sin correo que n8n serviría vacío.
 */
const CORREO_MODIFICACION_DE = {
  modificacion_solicitada: avisoModificacion,
  // `satisfies Partial<...>` y no una anotación: comprueba que la clave existe
  // en `EventoModificacion` —una errata no compila— pero deja que el tipo
  // inferido conserve la clave literal, que es lo que hace que el `evento` de
  // `construirPayloadModificacion` admita exactamente lo que hay redactado.
} satisfies Partial<Record<EventoModificacion, (s: Solicitud, m: Modificacion) => CorreoEvento>>;

/**
 * El payload de un aviso de modificación.
 *
 * `calendario` y `hoja` van a `null` SIEMPRE, y eso es lo que hace que n8n
 * recorra la rama de solo-correo que ya usan `creada` y `aprobacion` sin tocar
 * el workflow. No se añade ningún campo nuevo a `PayloadEvento` para esto: el IF
 * de n8n compara contra `null`, y un campo ausente es `undefined`, que
 * `!== null` es `true` y activaría la rama para TODOS los eventos (ver el aviso
 * del `drive` en `construirPayload`).
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
    calendario: null,
    hoja: null,
  };
}

/** Los eventos que dispara el alta de una solicitud, en orden de envío. */
export function eventosDeAlta(tipo: Solicitud['tipo']): EventoSolicitud[] {
  // La incapacidad se informa y ya: no hay a quién avisar para que apruebe.
  return tipo === 'incapacidad' ? ['registrada'] : ['creada', 'aprobacion'];
}
