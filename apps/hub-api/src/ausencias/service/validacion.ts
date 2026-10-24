import { esFechaValida, MAX_DIAS_RANGO } from '../dias-habiles.js';
import { AusenciaError } from '../errores.js';
import {
  CLASES_MODIFICACION,
  ETIQUETA_TIPO,
  TIPOS,
  esOtorgamiento,
  requiereAprobacion,
  type ClaseModificacion,
  type NuevaModificacion,
  type NuevaSolicitud,
  type Solicitud,
  type TipoSolicitud,
} from '../types.js';

// ARQ-612 — la validación de lo que llega del cliente, sacada de service.ts tal
// cual: los topes de longitud y del adjunto, la de una solicitud nueva (con sus
// horas, sus días concedidos y su PDF), la de una modificación y el nombre
// normalizado del PDF. Es pura: no toca la base ni la sesión. `MAX_MOTIVO` se
// exporta porque lo usan también las dos decisiones, que viven en otros
// trozos. service.ts lo reexporta (lo vigila barril.test.ts).

/** Tope del PDF adjunto. Una incapacidad escaneada rara vez pasa de 2-3 MB. */
export const MAX_ADJUNTO_BYTES = 8 * 1024 * 1024;
const MAX_COMENTARIOS = 2000;
export const MAX_MOTIVO = 1000;
/**
 * Más holgado que el motivo de un rechazo: quien pide un cambio tiene que
 * explicar un caso personal («me han adelantado la cita del especialista»), y no
 * solo justificar un no.
 */
const MAX_MOTIVO_MODIFICACION = 2000;
const MAX_NOMBRE_ARCHIVO = 200;

function esTipo(v: unknown): v is TipoSolicitud {
  return typeof v === 'string' && (TIPOS as readonly string[]).includes(v);
}

/**
 * `HH:MM` de 24 horas, y nada más.
 *
 * Estricto por lo mismo que `esFechaValida` con las fechas: esta cadena se
 * concatena dentro del ISO que se le manda a Google y se le pone de `value` a un
 * `<input type="time">`. Un `9:5` no lanzaría en ninguno de los dos sitios —
 * produciría un instante equivocado en uno y un campo vacío en el otro.
 */
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Resuelve la pareja de horas de una solicitud nueva.
 *
 * Dos códigos y no uno: cada uno se traduce a una frase distinta en la caja roja
 * de la app, y un código que significa dos cosas obliga a escribir un mensaje
 * que no dice ninguna.
 *
 *  - `hora_invalida`     → la pareja está mal (media, mal escrita, o del revés).
 *  - `hora_no_permitida` → la pareja está bien, pero no cabe en esta solicitud.
 */
function validarHoras(
  b: Record<string, unknown>,
  tipo: TipoSolicitud,
  fechaInicio: string,
  fechaFin: string,
): { horaInicio: string | null; horaFin: string | null } {
  const ini = typeof b.horaInicio === 'string' ? b.horaInicio.trim() : '';
  const fin = typeof b.horaFin === 'string' ? b.horaFin.trim() : '';
  if (ini === '' && fin === '') return { horaInicio: null, horaFin: null };

  // Media pareja no significa nada: «desde las 9:00» no dice cuánto dura, y un
  // rango a medias en el calendario es peor que no tener rango.
  if (!HORA.test(ini)) throw new AusenciaError('hora_invalida', 400, 'horaInicio');
  if (!HORA.test(fin)) throw new AusenciaError('hora_invalida', 400, 'horaFin');
  // Lexicográfico y no aritmético: con HH:MM de ancho fijo las dos comparaciones
  // dan lo mismo, y esta no necesita parsear nada.
  if (fin <= ini) throw new AusenciaError('hora_invalida', 400, 'horaFin');

  if (tipo !== 'permiso') throw new AusenciaError('hora_no_permitida', 400, 'tipo');
  // «Del lunes al viernes de 9:00 a 11:00» no tiene lectura única. El CHECK de
  // la 036 lo repite en la BD; aquí sale como un 400 y no como un 500 desde
  // dentro de una transacción.
  //
  // ⚠️ INALCANZABLE desde el 2026-08-25: llegados aquí el tipo ya es `permiso`, y
  // un permiso de varios días rebota antes con `permiso_de_un_solo_dia`, que va
  // mucho más arriba en `validarNuevaSolicitud`. Se conserva por si algún día
  // vuelven los permisos de varios días —sería la única red que le queda a la
  // franja horaria— y porque `validarHoras` se puede llamar desde otro sitio sin
  // que nadie se acuerde de esto. Cuesta una línea; el CHECK de la 036 dando un
  // 500 desde dentro de una transacción cuesta bastante más.
  if (fechaInicio !== fechaFin) throw new AusenciaError('hora_no_permitida', 400, 'fechaFin');

  return { horaInicio: ini, horaFin: fin };
}

/**
 * Valida y normaliza lo que llega del cliente. Nada de `empleadoId` ni de
 * `diasHabiles`: el primero sale de la sesión y el segundo se calcula aquí, así
 * que ni suplantar a otro ni inflar los días es posible desde el navegador.
 */
export function validarNuevaSolicitud(body: unknown, hoy: string): NuevaSolicitud {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!esTipo(b.tipo)) throw new AusenciaError('tipo_invalido', 400, 'tipo');
  const tipo = b.tipo;

  const fechaInicio = String(b.fechaInicio ?? '');
  const fechaFin = String(b.fechaFin ?? '');
  if (!esFechaValida(fechaInicio)) throw new AusenciaError('fecha_invalida', 400, 'fechaInicio');
  if (!esFechaValida(fechaFin)) throw new AusenciaError('fecha_invalida', 400, 'fechaFin');
  if (fechaInicio > fechaFin) throw new AusenciaError('rango_invertido', 400, 'fechaFin');

  // Un permiso ocupa UN día desde el 2026-08-25. Gemela exacta de la regla del
  // otorgamiento en `validarDiasConcedidos`, y por el mismo motivo que dice su
  // comentario: el formulario manda una sola fecha, pero **el servidor no puede
  // fiarse de eso** — `POST /solicitudes` está abierto y sin esto se cuela una
  // semana entera como «permiso».
  //
  // No es una precaución teórica. Sin esta línea, la API podía FABRICAR
  // registros que su propia API de modificación declara inválidos: un permiso de
  // cinco días creado por aquí recibe `permiso_de_un_solo_dia` en cuanto alguien
  // intenta tocarlo, y no hay forma de arreglarlo salvo encogerlo o anularlo.
  //
  // 400 aquí y 409 en la modificación, igual que el otorgamiento reparte sus dos
  // mitades (`otorgamiento_un_solo_dia` 400 en el alta,
  // `otorgamiento_solo_anulable` 409 al modificar): al crear, lo que llega está
  // MAL FORMADO para su tipo; al modificar, lo que llega es correcto y lo que no
  // encaja es con ESA solicitud.
  //
  // Mismo código en los dos sitios a propósito: es una sola regla, con una sola
  // frase que explicarle a quien la topa.
  if (tipo === 'permiso' && fechaInicio !== fechaFin) {
    throw new AusenciaError('permiso_de_un_solo_dia', 400, 'fechaFin');
  }

  // Nada que requiera aprobación puede empezar en el pasado: cuando llegara la
  // firma, los días ya se habrían disfrutado (o no) y el saldo ya no se podría
  // reservar. La incapacidad queda fuera, y es la razón de que la regla mire el
  // tipo: se INFORMA después de haber estado enfermo —uno va al médico, vuelve y
  // sube el soporte—, así que exigirle fecha de hoy en adelante haría imposible
  // el caso normal.
  //
  // `hoy` se inyecta y no se lee aquí del reloj, por lo mismo que en
  // `calcularSaldo`: para que la regla se pueda probar sin depender del día en
  // que se ejecuten los tests. Quien llama pasa `hoyEnColombia()`, que descuenta
  // UTC−5 ANTES de tomar la fecha — sin eso, entre las 19:00 y medianoche hora
  // local el servidor ya estaría en el día siguiente y rechazaría por «pasada»
  // una solicitud para mañana.
  //
  // El otorgamiento queda fuera por una razón distinta de la incapacidad: no es
  // una ausencia. Su fecha es el día que se TRABAJÓ de más, así que siempre está
  // en el pasado — se pide después de haber trabajado, no antes.
  if (requiereAprobacion(tipo) && !esOtorgamiento(tipo) && fechaInicio < hoy) {
    throw new AusenciaError('fecha_en_pasado', 400, 'fechaInicio');
  }

  // La incapacidad se queda fuera de la regla de arriba, y con motivo, pero eso
  // la dejaba sin límite en NINGUNA dirección: se podía informar una de hace
  // cinco años o una de dentro de un mes. Ventana propia y estrecha.
  if (tipo === 'incapacidad') {
    // Hacia adelante no: nadie sabe que va a enfermar. Se mira `fechaInicio` y
    // NO `fechaFin` a propósito — el médico firma hoy una baja que cubre los
    // próximos días, y ese caso, que es el corriente, tiene que seguir pasando.
    if (fechaInicio > hoy) throw new AusenciaError('incapacidad_en_el_futuro', 400, 'fechaInicio');
    // Y hacia atrás, poco: informarla es cosa de días, no de meses. Con la
    // ventana en dos días, una baja de la semana pasada ya no entra sola y hay
    // que pedírsela a administración, que sí puede corregir el registro.
    if (fechaInicio < limiteDeLaIncapacidad(hoy)) {
      throw new AusenciaError('incapacidad_demasiado_antigua', 400, 'fechaInicio');
    }
  }

  const diasNaturales = (Date.parse(`${fechaFin}T00:00:00Z`) - Date.parse(`${fechaInicio}T00:00:00Z`)) / 86_400_000 + 1;
  if (diasNaturales > MAX_DIAS_RANGO) throw new AusenciaError('rango_demasiado_largo', 400, 'fechaFin');

  const comentarios = typeof b.comentarios === 'string' ? b.comentarios.trim() : '';
  if (comentarios.length > MAX_COMENTARIOS) throw new AusenciaError('comentarios_demasiado_largos', 400, 'comentarios');

  const adjunto = validarAdjunto(b.adjunto);
  // La incapacidad es el único tipo que no se aprueba; el soporte médico es lo
  // único que la respalda, así que sin él no se registra.
  if (tipo === 'incapacidad' && !adjunto) throw new AusenciaError('adjunto_requerido', 400, 'adjunto');

  const dias = validarDiasConcedidos(b.dias, tipo, fechaInicio, fechaFin, hoy, comentarios);

  const { horaInicio, horaFin } = validarHoras(b, tipo, fechaInicio, fechaFin);

  return { tipo, fechaInicio, fechaFin, comentarios: comentarios || undefined, adjunto, dias, horaInicio, horaFin };
}

/** Tope de UNA concesión. El del saldo entero es otro (`MAX_SALDO`, 999). */
const MAX_DIAS_CONCEDIDOS = 30;

/** Hasta cuántos meses hacia atrás se puede reclamar un trabajo extra. */
const MESES_HACIA_ATRAS = 3;

/**
 * El día más antiguo por el que hoy se puede pedir un compensatorio.
 *
 * Meses de calendario y no un número de días: la regla se le dice al empleado
 * como «tres meses», y noventa días no coinciden con eso en la mitad del año.
 *
 * ⚠️ Espejo EXACTO de `limiteDelTrabajo` en `apps/ausencias/src/dominio.ts`, que
 * es lo que el formulario le pone al `min` del calendario. Si las dos se
 * separan, el selector deja elegir un día que el servidor rechaza —o al revés,
 * bloquea uno que aceptaría—, y las dos formas son igual de desconcertantes.
 *
 * `Date.UTC` normaliza el desbordamiento de día: desde un 31 de mayo, tres meses
 * atrás no es «31 de febrero» sino el 3 de marzo. Eso hace la ventana un par de
 * días más CORTA en esas fechas, nunca más larga, así que el límite nunca deja
 * pasar algo que la regla no quería.
 */
export function limiteDelTrabajo(hoy: string): string {
  const [anio, mes, dia] = hoy.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1 - MESES_HACIA_ATRAS, dia)).toISOString().slice(0, 10);
}

/** Cuántos días hacia atrás se puede informar una incapacidad. */
const DIAS_DE_LA_INCAPACIDAD = 2;

/**
 * El día más antiguo por el que hoy se puede informar una incapacidad.
 *
 * Constante y función PROPIAS, y no las del otorgamiento aunque las dos acoten
 * hacia atrás: son dos políticas distintas que hoy coinciden en la forma y no en
 * el número, y compartirlas haría que tocar una moviera la otra en silencio.
 *
 * `Date.UTC` con el día restado hace el arrastre de mes y de año él solo: el 1
 * de marzo menos dos días es el 27 o el 28 de febrero según el año, y esa cuenta
 * no hay que escribirla.
 */
export function limiteDeLaIncapacidad(hoy: string): string {
  const [anio, mes, dia] = hoy.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia - DIAS_DE_LA_INCAPACIDAD)).toISOString().slice(0, 10);
}

/**
 * Los días de un otorgamiento, y las cuatro reglas que solo él tiene.
 *
 * Devuelve `undefined` para los otros cuatro tipos, cuyos días los cuenta el
 * servidor con `contarDiasHabiles`. Y RECHAZA el campo si viene en uno de ellos:
 * aceptarlo e ignorarlo en silencio dejaría creer que se puede fijar desde el
 * cliente el recuento de unas vacaciones, que es justo lo que no se puede.
 */
function validarDiasConcedidos(
  valor: unknown,
  tipo: TipoSolicitud,
  fechaInicio: string,
  fechaFin: string,
  hoy: string,
  comentarios: string,
): number | undefined {
  if (!esOtorgamiento(tipo)) {
    if (valor !== undefined) throw new AusenciaError('dias_no_aplica', 400, 'dias');
    return undefined;
  }

  // Un solo día de trabajo, no un rango. El formulario manda una sola fecha,
  // pero el servidor no puede fiarse de eso: sin esta regla se podría colar un
  // trimestre entero como «el día que trabajé».
  if (fechaInicio !== fechaFin) throw new AusenciaError('otorgamiento_un_solo_dia', 400, 'fechaFin');

  // Sin tope hacia atrás, alguien reclamaría hoy un sábado de hace seis años. Un
  // año es además lo que evita que la concesión caiga antes de la fecha de corte
  // de casi nadie — y por debajo del corte no sumaría nada, que es peor que
  // negarla, porque el empleado no vería ningún error.
  if (fechaInicio < limiteDelTrabajo(hoy)) {
    throw new AusenciaError('trabajo_demasiado_antiguo', 400, 'fechaInicio');
  }
  // Y tampoco hacia adelante: un compensatorio se gana por haber trabajado, no
  // por ir a trabajar. La ventana es «desde hoy hacia atrás», y el `max` del
  // calendario dice lo mismo — el servidor lo repite porque el `max` de un input
  // se salta tecleando.
  if (fechaInicio > hoy) throw new AusenciaError('trabajo_en_el_futuro', 400, 'fechaInicio');

  // El motivo es lo único que deja auditable la concesión: sin él, dentro de seis
  // meses nadie sabrá por qué esa persona tiene esos días.
  if (!comentarios) throw new AusenciaError('motivo_requerido', 400, 'comentarios');

  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw new AusenciaError('dias_invalidos', 400, 'dias');
  }
  // Una décima, que es la precisión de NUMERIC(4,1) y la del medio día.
  if (Math.round(valor * 10) !== valor * 10) throw new AusenciaError('dias_invalidos', 400, 'dias');
  if (valor <= 0) throw new AusenciaError('dias_invalidos', 400, 'dias');
  if (valor > MAX_DIAS_CONCEDIDOS) throw new AusenciaError('dias_demasiados', 400, 'dias');

  return valor;
}

function validarAdjunto(v: unknown): NuevaSolicitud['adjunto'] {
  if (v === undefined || v === null) return undefined;
  const a = v as Record<string, unknown>;
  const nombreArchivo = String(a.nombreArchivo ?? '').trim();
  const mime = String(a.mime ?? '');
  const contenidoBase64 = String(a.contenidoBase64 ?? '');

  if (!nombreArchivo || nombreArchivo.length > MAX_NOMBRE_ARCHIVO) {
    throw new AusenciaError('nombre_archivo_invalido', 400, 'adjunto');
  }
  if (mime !== 'application/pdf') throw new AusenciaError('adjunto_no_es_pdf', 400, 'adjunto');
  if (!contenidoBase64) throw new AusenciaError('adjunto_vacio', 400, 'adjunto');
  // Se estima el tamaño ANTES de decodificar: no tiene sentido materializar en
  // memoria un buffer de 50 MB solo para descubrir que sobra.
  if (Math.floor((contenidoBase64.length * 3) / 4) > MAX_ADJUNTO_BYTES) {
    throw new AusenciaError('adjunto_demasiado_grande', 400, 'adjunto');
  }
  return { nombreArchivo, mime, contenidoBase64 };
}

function esClase(v: unknown): v is ClaseModificacion {
  return typeof v === 'string' && (CLASES_MODIFICACION as readonly string[]).includes(v);
}

/** Un campo que el cliente ha rellenado de verdad. Un `''` es un input vacío. */
function llegaConValor(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

/**
 * Valida la propuesta contra las fechas que la solicitud tiene AHORA.
 *
 * Recibe la solicitud actual y el `hoy` —y no solo el cuerpo— porque ni
 * `sin_cambios` ni la regla del pasado se pueden decidir sin ellos. Los dos
 * entran por parámetro, como el `hoy` de `validarNuevaSolicitud`, para que la
 * función siga siendo pura y probable sin base de datos ni reloj.
 *
 * La regla del pasado NO es la del alta: ver el comentario de `fecha_en_pasado`
 * más abajo.
 */
export function validarNuevaModificacion(
  body: unknown,
  actual: Pick<Solicitud, 'tipo' | 'fechaInicio' | 'fechaFin'>,
  hoy: string,
): NuevaModificacion {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!esClase(b.clase)) throw new AusenciaError('clase_invalida', 400, 'clase');
  const clase = b.clase;

  // A un otorgamiento solo se le puede pedir la anulación: no tiene rango que
  // mover —es un día de trabajo y una cantidad concedida—, así que «cambiar las
  // fechas» no significa nada sobre él. Con nombre propio y no `clase_invalida`,
  // por lo mismo que la contradicción de más abajo: esa clase existe, lo que no
  // encaja es con ESTA solicitud.
  if (clase === 'fechas' && esOtorgamiento(actual.tipo)) {
    throw new AusenciaError('otorgamiento_solo_anulable', 409, 'clase');
  }

  const motivo = typeof b.motivo === 'string' ? b.motivo.trim() : '';
  if (motivo.length > MAX_MOTIVO_MODIFICACION) throw new AusenciaError('motivo_demasiado_largo', 400, 'motivo');

  if (clase === 'anulacion') {
    // Las fechas NO se ignoran en silencio: un cliente con un bug creería haber
    // pedido un cambio de fechas y habría pedido que le anularan las vacaciones.
    //
    // Código propio y no `clase_invalida`: la clase que mandó SÍ existe, así que
    // `clase_invalida` se leería como una mentira en un log y el cliente no
    // podría distinguir «esa clase no existe» de «tu clase contradice tus
    // fechas». Es la misma contradicción a la que la 024 le dio nombre propio
    // con `modificaciones_campos_por_clase`. Se señala `clase` porque es el
    // campo que hay que corregir para que la petición signifique lo que el
    // cliente cree que significa.
    if (llegaConValor(b.fechaInicio) || llegaConValor(b.fechaFin)) {
      throw new AusenciaError('anulacion_con_fechas', 400, 'clase');
    }
    return { clase, fechaInicio: null, fechaFin: null, motivo: motivo || null };
  }

  const fechaInicio = String(b.fechaInicio ?? '');
  const fechaFin = String(b.fechaFin ?? '');
  if (!esFechaValida(fechaInicio)) throw new AusenciaError('fecha_invalida', 400, 'fechaInicio');
  if (!esFechaValida(fechaFin)) throw new AusenciaError('fecha_invalida', 400, 'fechaFin');
  if (fechaInicio > fechaFin) throw new AusenciaError('rango_invertido', 400, 'fechaFin');

  // Un permiso es de UN día desde el 2026-08-25, y esta es la SEGUNDA puerta.
  // El formulario ya solo pide una fecha, pero sin esto se pedía de un día y se
  // estiraba a cinco por aquí: con la firma del jefe, sí, pero contra la regla
  // que el alta acaba de imponer, y con la app diciendo dos cosas distintas
  // según por dónde se entre.
  //
  // Va DESPUÉS de validar el formato y el orden —para que una fecha mal escrita
  // dé su propio error y no este— y con código propio en vez de reutilizar
  // `rango_invertido`, por lo mismo que `otorgamiento_solo_anulable` unas líneas
  // más arriba: el rango que mandó es correcto, lo que no encaja es con ESTA
  // solicitud. Se señala `fechaFin`, que es el campo que hay que igualar.
  //
  // ⚠️ Mira el TIPO y no el rango a secas: para unas vacaciones, estirar el
  // rango es justamente el caso normal.
  //
  // NO alcanza al `PATCH` del registro general (`actualizarSolicitud`), y es a
  // propósito: allí un admin corrige el histórico, y existen permisos de varios
  // días anteriores a esta regla que tienen que poder tocarse.
  if (actual.tipo === 'permiso' && fechaInicio !== fechaFin) {
    throw new AusenciaError('permiso_de_un_solo_dia', 409, 'fechaFin');
  }

  const diasNaturales = (Date.parse(`${fechaFin}T00:00:00Z`) - Date.parse(`${fechaInicio}T00:00:00Z`)) / 86_400_000 + 1;
  if (diasNaturales > MAX_DIAS_RANGO) throw new AusenciaError('rango_demasiado_largo', 400, 'fechaFin');

  // La regla del alta no vale tal cual: recortar una ausencia YA EMPEZADA obliga
  // a proponer una fecha de inicio que está en el pasado. Lo que NO puede es
  // RETROCEDER — mover a enero unos días de julio todavía sin disfrutar
  // reservaría días ya pasados y movería saldo de un año a otro.
  //
  // Las dos condiciones juntas son el invariante «hacia dentro sí, hacia atrás
  // no»: la segunda es la que deja pasar el recorte (proponer el MISMO inicio
  // que ya tiene nunca es retroceder, esté o no en el pasado).
  if (fechaInicio < hoy && fechaInicio < actual.fechaInicio) {
    throw new AusenciaError('fecha_en_pasado', 400, 'fechaInicio');
  }

  // Pedir exactamente lo que ya tiene no es un cambio: sin esto, el jefe
  // recibiría un correo pidiéndole que apruebe dejar todo igual.
  if (fechaInicio === actual.fechaInicio && fechaFin === actual.fechaFin) {
    throw new AusenciaError('sin_cambios', 400, 'fechaInicio');
  }

  return { clase, fechaInicio, fechaFin, motivo: motivo || null };
}

// `normalize('NFD')` separa la tilde de su letra, y el bloque U+0300–U+036F son
// esas marcas sueltas. La clase se construye desde los códigos en vez de
// escribirla como literal: en el fuente serían caracteres invisibles, y
// cualquier reencoding del fichero las rompería sin dejar rastro.
const DIACRITICOS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

/**
 * Nombre normalizado del PDF, tal como el flujo de n8n lo dejaba en Drive:
 * `Tipo_Nombre_Apellidos_Fecha_N.pdf`, sin tildes ni espacios. Se mantiene la
 * convención para que las carpetas sigan siendo homogéneas.
 */
export function nombreArchivoNormalizado(
  tipo: TipoSolicitud,
  nombreCompleto: string,
  fechaInicio: string,
  indice = 1,
): string {
  const limpiar = (t: string) =>
    t
      .normalize('NFD')
      .replace(DIACRITICOS, '')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '');
  const [nombre, ...resto] = nombreCompleto.trim().split(/\s+/);
  const apellidos = resto.join(' ') || 'Apellidos';
  return `${limpiar(ETIQUETA_TIPO[tipo])}_${limpiar(nombre || 'Nombre')}_${limpiar(apellidos)}_${fechaInicio}_${indice}.pdf`;
}
