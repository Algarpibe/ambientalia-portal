import type { Pool } from '@algarpibe/zoho-sync';
import { avisarN8n } from './avisar.js';
import { APROBADOR_POR_DEFECTO, COPIA_POR_DEFECTO } from './config.js';
import {
  diasDelAnio,
  diasDelMes,
  esAnioValido,
  esMesValido,
  franjasDelAnio,
  marcasDelMes,
  mesesDelAnio,
  rangoDelAnio,
  rangoDelMes,
  type DiaCalendario,
  type FranjaCalendario,
  type MarcaCalendario,
  type MesDelAnio,
} from './calendario.js';
import { contarDiasHabiles, esFechaValida, MAX_DIAS_RANGO } from './dias-habiles.js';
import {
  pendientesPorAntiguedad,
  tiemposPorAprobador,
  type PendientesPorAntiguedad,
  type TiempoDeAprobador,
} from './kpis.js';
import { resolverEmpleado, validarFilasHistorico } from './historico.js';
import { aprobadoresDe, construirIndice, creariaCiclo, detectarCiclos, jefeEfectivo } from './jerarquia.js';
import {
  construirPayload,
  construirPayloadModificacion,
  eventosDeAlta,
  type Firmante,
} from './notificaciones.js';
import * as repo from './repo.js';
import {
  calcularSaldo,
  calcularSaldoCompensatorios,
  hoyCongelado,
  hoyEnColombia,
  pedible,
  type SaldoCompensatorios,
  type SaldoVacaciones,
} from './saldo.js';
import {
  CLASES_MODIFICACION,
  ETIQUETA_TIPO,
  TIPOS,
  correoDelTurno,
  decisorDeModificacion,
  esOtorgamiento,
  requiereAprobacion,
  transicionAlDecidir,
  type ClaseModificacion,
  type Empleado,
  type EstadoModificacion,
  type EstadoSolicitud,
  type Modificacion,
  type Movimiento,
  type NuevaModificacion,
  type NuevaSolicitud,
  type Solicitud,
  type TipoSolicitud,
} from './types.js';

/** Error de dominio con su código HTTP, como `UserError` en users.service.ts. */
export class AusenciaError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly field?: string,
    /**
     * Datos del conflicto, para los errores que sin ellos no se pueden accionar.
     * «Te solapas» sin decir CON QUÉ deja a la persona sin saber qué corregir.
     * Opcional: la inmensa mayoría de los errores se explican solos con `code`.
     */
    public readonly detalle?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'AusenciaError';
  }
}

/** Tope del PDF adjunto. Una incapacidad escaneada rara vez pasa de 2-3 MB. */
export const MAX_ADJUNTO_BYTES = 8 * 1024 * 1024;
const MAX_COMENTARIOS = 2000;
const MAX_MOTIVO = 1000;
/**
 * Más holgado que el motivo de un rechazo: quien pide un cambio tiene que
 * explicar un caso personal («me han adelantado la cita del especialista»), y no
 * solo justificar un no.
 */
const MAX_MOTIVO_MODIFICACION = 2000;
const MAX_NOMBRE_ARCHIVO = 200;

// El contenido de los correos y los destinos de Google viven en
// notificaciones.ts y config.ts. Aquí solo se decide QUÉ eventos se encolan.

// ── Validación ─────────────────────────────────────────────────────────────

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

// ── Casos de uso ───────────────────────────────────────────────────────────

export interface Sesion {
  email: string;
  userId: string | null;
  esAdmin: boolean;
}

/**
 * El empleado del usuario logueado, dándolo de alta si aún no tenía ficha.
 *
 * Quien tiene la app asignada es exactamente quien debe poder solicitar, así
 * que la asignación ya es el permiso; la ficha se deriva sola de la cuenta del
 * portal. Solo queda 403 cuando de verdad no hay de dónde sacarla: un token
 * legacy sin usuario en BD, o una ficha que un admin desactivó a propósito.
 */
export async function empleadoDeSesion(db: Pool, sesion: Sesion): Promise<Empleado> {
  const empleado = await repo.asegurarEmpleado(db, sesion.userId, sesion.email);
  if (!empleado) throw new AusenciaError('empleado_no_registrado', 403);
  return empleado;
}

/**
 * Lo que el cliente necesita saber del choque, y nada más.
 *
 * Campo a campo, y sin el `id`: es a la vez lo que hace que esto compile
 * —`Solape` es una interface, sin index signature implícita, así que
 * `AusenciaError` no la admite tal cual— y lo que evita mandar al cliente un
 * uuid que no necesita.
 *
 * Tiene nombre y no `Record<string, unknown>` a secas porque el `detalle` de un
 * `AusenciaError` no lo tiene: sin este alias, quien redacta el 409 en el
 * navegador se lo inventa campo a campo y nada compara las dos listas.
 *
 * ⚠️ `type` y NO `interface`, y la diferencia es de compilación: TypeScript le
 * da index signature implícita a un alias de tipo, pero no a una interface. En
 * cuanto esto sea una `interface` deja de ser asignable al
 * `Record<string, unknown>` del `detalle` de `AusenciaError` y `errorDeSolape`
 * no compila — que es exactamente lo que le pasa a `repo.Solape`, y por lo que
 * existe la función de abajo.
 */
export type SolapeDetalle = {
  tipo: TipoSolicitud;
  estado: EstadoSolicitud;
  fechaInicio: string;
  fechaFin: string;
};

/**
 * El choque recortado a eso. Privada a propósito: quien lo necesita desde fuera
 * necesita en realidad el error entero, y para eso está `errorDeSolape`.
 */
function detalleDelSolape(choque: repo.Solape): SolapeDetalle {
  return {
    tipo: choque.tipo,
    estado: choque.estado,
    fechaInicio: choque.fechaInicio,
    fechaFin: choque.fechaFin,
  };
}

/**
 * El 409 del solapamiento entero, escrito una sola vez.
 *
 * El `detalle` no era lo único que había que atar: `code`, `status` y `field` son
 * igual de contrato, y estaban tecleados a mano en los tres sitios que responden
 * este error —`exigirSinSolape` para el alta y la propuesta, la traducción de
 * `decidirModificacion` más abajo, y el `catch` del `PATCH` en `router.ts`—. Con
 * la tripleta suelta bastaba con que uno dijera `fechaFin`, o un `code` con otra
 * letra, para que la interfaz tuviera que aprender dos formas de contar lo mismo,
 * y ningún test lo habría visto: cada puerta afirma la SUYA.
 *
 * Lo vigilan los cuatro tests de `router.test.ts` que afirman
 * `error: 'rango_solapado'` desde HTTP, uno por puerta; tres comparan además las
 * claves exactas del `detalle`, que es donde vive la promesa de no filtrar el
 * `id` del choque.
 */
export function errorDeSolape(choque: repo.Solape): AusenciaError {
  return new AusenciaError('rango_solapado', 409, 'fechaInicio', detalleDelSolape(choque));
}

/**
 * Corta si esta persona ya tiene una ausencia viva en esas fechas.
 *
 * Aquí se decide qué es un solapamiento para las DOS puertas que pasan por el
 * servicio: esta alta y proponer un cambio de fechas.
 *
 * ⚠️ Las otras dos no pasan por aquí, y no es descuido. Firmar el cambio vive
 * dentro de la transacción de `repo.decidirModificacion`, con un `PoolClient` y
 * sin poder lanzar `AusenciaError`. Y el `PATCH` de admin no tiene función de
 * servicio —el router llama a `repo.actualizarSolicitud` derecho— y su
 * comprobación va también dentro de esa transacción, para no mirar por una
 * conexión y escribir por otra. Las dos llaman a `repo.solapeDe` por su cuenta,
 * pero la REGLA de qué ocupa agenda ya no se repite en ninguna: las cuatro
 * puertas llaman a `repo.ocupaAgenda`. Se comparte porque copiarla salió mal —el
 * `PATCH` nació copiando media, el tipo sin el estado— y porque los candados no
 * lo habrían visto: cada puerta prueba la suya, así que cambiar la regla en un
 * solo sitio deja verdes los tests de las otras.
 */
async function exigirSinSolape(
  db: Pool,
  empleadoId: string,
  tipo: TipoSolicitud,
  estado: EstadoSolicitud,
  fechaInicio: string,
  fechaFin: string,
  excluirSolicitudId: string | null,
): Promise<void> {
  // La fila que va a quedar escrita solo puede chocar con alguien si ella misma
  // OCUPA agenda; si no, comprobarla solo sirve para negar lo que nadie tenía por
  // qué negar. El porqué de cada mitad, en `repo.ocupaAgenda`.
  //
  // Por estas dos puertas hoy no pasa ninguna fila que no ocupe por su estado: el
  // alta nace `pendiente` o `registrada` —nunca `rechazada`— y
  // `estadoAdmiteModificacion` deja fuera a las rechazadas mucho antes de llegar a
  // la propuesta. Se pasa el estado igual, porque preguntar por la fila ENTERA es
  // lo que impide que esta puerta diverja de las otras tres — que es exactamente
  // lo que pasó cuando el `PATCH` copió media regla.
  if (!repo.ocupaAgenda(tipo, estado)) return;

  const choque = await repo.solapeDe(db, empleadoId, fechaInicio, fechaFin, excluirSolicitudId);
  if (!choque) return;
  throw errorDeSolape(choque);
}

/**
 * Corta si esta persona no tiene compensatorios suficientes.
 *
 * Al contrario que las vacaciones —que solo avisan en el cliente y dejan la
 * decisión a quien firma— el compensatorio se BLOQUEA aquí. La razón es que no
 * se devenga con el tiempo: un descubierto no se cura esperando, y nadie puede
 * autorizarlo tampoco, porque los días o se han ganado o no.
 *
 * ⚠️ SIN CONFIGURAR CUENTA COMO CERO Y BLOQUEA. Es decisión de producto, y tiene
 * una consecuencia operativa que no se puede olvidar: las migraciones tienen
 * prohibido sembrar datos, así que el día que esto entra en producción la bolsa
 * está vacía para TODA la plantilla. Por eso esta función viaja en un despliegue
 * posterior al de la pestaña que permite sembrarla, y no en el mismo — si no,
 * nadie podría pedir un compensatorio durante el hueco. El contador de «sin
 * bolsa de compensatorios» del panel de Saldos es el que dice cuándo se puede
 * activar: mientras no esté en cero, esto corta a gente que no tiene forma de
 * arreglarlo por su cuenta.
 *
 * Se compara contra `pedible` (disponible − enTramite) y NO contra `disponible`:
 * con el firme a secas, tres solicitudes de un día con un día de bolsa pasarían
 * las tres, porque ninguna de las anteriores ha bajado el firme todavía (media
 * firma no descuenta, ver `calcularSaldo`).
 *
 * Solo al CREAR, nunca al aprobar. Bloquear en la firma dejaría solicitudes
 * pendientes imposibles de decidir si la bolsa baja entre medias, y al jefe con
 * una bandeja que no puede vaciar. Tampoco en el `PATCH` de admin: ahí no se
 * decide nada, se corrige el registro.
 *
 * ⚠️ NO cierra la carrera de dos altas simultáneas: son dos SELECT sin `FOR
 * UPDATE`, igual que `solapeDe` y por la misma razón que aquella documenta. Dos
 * pestañas mandando a la vez pueden colar un día de más.
 */
async function exigirCompensatoriosSuficientes(
  db: Pool,
  empleado: Empleado,
  tipo: TipoSolicitud,
  dias: number,
): Promise<void> {
  if (tipo !== 'compensatorio') return;
  // Un rango entero de fines de semana da 0 días hábiles y no consume nada. Sin
  // este corte, con la bolsa en negativo —alcanzable: basta que un admin baje el
  // corte después de aprobar— `0 > -2` bloquearía una solicitud que no gasta un
  // solo día. `TarjetaCompensatorios` ya esquiva lo mismo con su `diasPedidos > 0`.
  if (dias <= 0) return;

  const { compensatorios } = await saldosDeSesion(db, empleado);
  // Se distingue de «no te alcanza» porque la acción es otra: aquí no hay nada
  // que el empleado pueda hacer salvo avisar a administración, y un mensaje
  // único lo dejaría dando vueltas.
  if (!compensatorios.configurado) {
    throw new AusenciaError('compensatorios_sin_saldo', 409, 'tipo');
  }

  const puedePedir = pedible(compensatorios);
  if (dias <= puedePedir) return;
  // El detalle es obligatorio, no decorativo: «no puedes» sin los números es
  // inaccionable. No hay riesgo de fuga — es el saldo de quien pregunta.
  throw new AusenciaError('compensatorios_insuficientes', 409, 'fechaFin', {
    pedidos: dias,
    pedible: puedePedir,
    disponible: compensatorios.disponible,
    enTramite: compensatorios.enTramite,
  });
}

/**
 * Nadie pide más vacaciones de las que tiene. Salvo un admin.
 *
 * Gemela de `exigirCompensatoriosSuficientes` y con las mismas tres decisiones,
 * que ya están razonadas allí y no se repiten: se compara contra `pedible`
 * (disponible − enTramite) y no contra el firme —si no, tres solicitudes que
 * quepan por separado pasarían las tres, porque media firma no descuenta—; el
 * corte por `dias <= 0` deja pasar un rango de solo fin de semana, que no gasta
 * nada; y solo actúa al CREAR, nunca al aprobar ni en el `PATCH` de admin.
 *
 * ⚠️ **Dos diferencias con su gemela, y las dos son deliberadas.**
 *
 * La primera: un ADMIN queda exento y puede meterse en negativo. Es lo que se
 * pidió, y la exención sale de la SESIÓN, así que cubre exactamente a quien
 * pulsa el botón — un admin sobre su propia solicitud. No existe hoy un alta en
 * nombre de otro, así que no hay forma de que un admin meta en negativo a nadie
 * más; si algún día se añade, esta línea hay que volver a mirarla.
 *
 * La segunda: sin saldo configurado **NO se bloquea**, al revés que los
 * compensatorios. La asimetría no es un descuido. Una bolsa de compensatorios
 * sin configurar significa «no tienes compensatorios», que es el estado normal
 * de casi toda la plantilla. Un saldo de vacaciones sin configurar significa
 * «administración todavía no ha puesto el punto de corte» — o sea DESCONOCIDO, no
 * cero—, y `sinConfigurar()` devuelve `disponible: 0`. Bloquear sobre eso le
 * cerraría las vacaciones a quien no puede arreglarlo por su cuenta, y encima el
 * día del despliegue y de golpe. Se deja pasar y se registra, que es lo que hace
 * visible a quién le falta el corte sin castigar a nadie por ello.
 */
async function exigirVacacionesSuficientes(
  db: Pool,
  empleado: Empleado,
  tipo: TipoSolicitud,
  dias: number,
  esAdmin: boolean,
): Promise<void> {
  if (tipo !== 'vacaciones') return;
  if (esAdmin) return;
  if (dias <= 0) return;

  const { saldo } = await saldosDeSesion(db, empleado);

  if (!saldo.configurado) {
    // Una línea por solicitud, no un contador: lo que hace falta saber es a QUIÉN
    // le falta el corte, y eso es justo lo que administración necesita para
    // sembrarlo desde el panel de Saldos.
    console.log(
      JSON.stringify({
        event: 'ausencias_vacaciones_sin_saldo_configurado',
        timestamp: new Date().toISOString(),
        empleadoId: empleado.id,
        correo: empleado.correo,
        diasPedidos: dias,
      }),
    );
    return;
  }

  const puedePedir = pedible(saldo);
  if (dias <= puedePedir) return;
  // El detalle es obligatorio, no decorativo, por lo mismo que en la gemela: «no
  // puedes» sin los números es inaccionable. Y no hay fuga: es el saldo de quien
  // pregunta.
  throw new AusenciaError('vacaciones_insuficientes', 409, 'fechaFin', {
    pedidos: dias,
    pedible: puedePedir,
    disponible: saldo.disponible,
    enTramite: saldo.enTramite,
  });
}

export async function crearSolicitud(db: Pool, sesion: Sesion, body: unknown): Promise<Solicitud> {
  const datos = validarNuevaSolicitud(body, hoyEnColombia());
  const empleado = await empleadoDeSesion(db, sesion);
  // La otra mitad del bloqueo de la baja: allí se impide fijar una fecha que
  // deje días huérfanos detrás, y aquí se impide crear esos días después. Sin
  // las dos, la regla se puede saltar por el otro extremo.
  //
  // Va aquí y no en `validarNuevaSolicitud` porque esa función es pura y no
  // conoce la ficha; mismo criterio que `exigirSinSolape` y
  // `exigirVacacionesSuficientes`.
  //
  // `>` y no `>=`: la fecha de retiro es su último día trabajado, así que unas
  // vacaciones que acaban justo ese día caben.
  //
  // El otorgamiento NO queda exento, aunque sí lo está de `ocupaAgenda` y del
  // solape. La mitad gemela de este candado —`repo.diasPosterioresA`, la que
  // bloquea FIJAR el retiro— tampoco lo excluye por tipo: su WHERE solo mira
  // `fecha_fin > fecha` y el estado, sin `tipo <> 'otorgamiento'`. Exceptuarlo
  // aquí rompería esa simetría: un otorgamiento posterior bloquearía fijar el
  // retiro, pero crear ese mismo otorgamiento DESPUÉS de fijarlo no chocaría
  // con nada. Y tiene sentido por sí solo: la fecha de un otorgamiento es el
  // día que se TRABAJÓ, y reclamar uno posterior al último día trabajado es la
  // misma contradicción que agendar una ausencia después de haberse ido —
  // aunque uno sume días y la otra los gaste. En la práctica esta guarda casi
  // nunca la alcanza un otorgamiento: no se puede pedir para el futuro
  // (`trabajo_en_el_futuro`), así que si el retiro sigue siendo futuro la
  // comparación nunca da `>`. Solo se dispara si `fechaRetiro` ya quedó en el
  // pasado antes de que el barrido desactivara la ficha.
  if (empleado.fechaRetiro !== null && datos.fechaFin > empleado.fechaRetiro) {
    throw new AusenciaError('fecha_posterior_al_retiro', 409, 'fechaFin', {
      fechaRetiro: empleado.fechaRetiro,
    });
  }
  // Los dos suben aquí porque la comprobación de solape pregunta por la fila que
  // se va a crear, y eso incluye con qué estado nace. Son derivaciones puras de
  // `datos.tipo`, así que adelantarlas no cambia nada más.
  const aprueba = requiereAprobacion(datos.tipo);
  const estado = aprueba ? 'pendiente' : 'registrada';
  // Va aquí porque necesita el id del empleado, y antes de escribir nada DE LA
  // SOLICITUD: el alta automática de la ficha ya ha podido escribir en la línea
  // de arriba (`empleadoDeSesion` → `repo.asegurarEmpleado`, un INSERT ... ON
  // CONFLICT DO NOTHING idempotente), pero de ahí es de donde sale el id que
  // esta comprobación necesita, así que tiene que ir antes por fuerza.
  await exigirSinSolape(db, empleado.id, datos.tipo, estado, datos.fechaInicio, datos.fechaFin, null);
  // El otorgamiento no pasa por la comprobación de arriba —está exento de
  // `ocupaAgenda` a propósito, porque su fecha es el día que se TRABAJÓ y tiene
  // que poder caer dentro de las propias vacaciones—, y esa exención dejaba
  // abierto reclamar DOS veces la misma jornada: dos peticiones por el mismo
  // sábado conceden el doble de días por un solo día de trabajo, y ninguna de
  // sus cuatro reglas propias lo miraba.
  //
  // Por eso una regla suya y estrecha, en vez de meterlo en `ocupaAgenda`:
  // aquello cerraría el duplicado y de paso rompería el caso más típico que
  // tiene este tipo.
  if (esOtorgamiento(datos.tipo) && (await repo.existeOtorgamientoDelDia(db, empleado.id, datos.fechaInicio, null))) {
    throw new AusenciaError('otorgamiento_duplicado', 409, 'fechaInicio');
  }
  // En un otorgamiento los días NO se cuentan: se conceden. `contarDiasHabiles`
  // daría 0 justo en el caso normal —el sábado por el que se gana el
  // compensatorio no es hábil— y la concesión quedaría en nada. `datos.dias` ya
  // viene validado, y `validarNuevaSolicitud` garantiza que existe si y solo si
  // el tipo es otorgamiento.
  const diasHabiles = datos.dias ?? contarDiasHabiles(datos.fechaInicio, datos.fechaFin);
  // No puede subir más: necesita `diasHabiles`. Y va antes de resolver firmantes
  // y de decodificar el base64 del adjunto para no procesar 8 MB de una solicitud
  // que se va a rechazar.
  await exigirCompensatoriosSuficientes(db, empleado, datos.tipo, diasHabiles);
  // Las dos puertas van seguidas y ninguna se solapa con la otra: cada una mira
  // su `tipo` y sale enseguida si no es el suyo, así que solo una llega a
  // consultar el saldo. Se llaman las dos, y no un `if/else` sobre el tipo,
  // porque el día que haya una tercera bolsa la lista crece sin tocar el flujo.
  await exigirVacacionesSuficientes(db, empleado, datos.tipo, diasHabiles, sesion.esAdmin);

  // Los dos firmantes se congelan AQUÍ. La fuente de verdad sigue siendo el árbol
  // de `empleados`; esto es una foto, para que un cambio de organigrama a mitad de
  // trámite no mueva una solicitud que ya está en vuelo.
  //
  // El correo del jefe pasa por `jefeEfectivo` ANTES de resolver su enlace: quien
  // es su propio jefe firma con el aprobador de reserva, y el segundo nivel tiene
  // que subirse desde el árbol de ÉSE y no del suyo propio.
  //
  // Un otorgamiento se firma con UNA sola firma, sea cual sea la casilla de la
  // ficha: conceder días es una decisión del jefe inmediato y no hay nada que un
  // segundo escalón añada. No se inventa nada — es exactamente lo que ya hace una
  // ficha con `requiereSegundaFirma` apagada, y el de segundo nivel queda en
  // `informado`, enterándose del resultado.
  const correoDelJefe = jefeEfectivo(empleado);
  const firmantes = aprueba
    ? aprobadoresDe(
        {
          ...empleado,
          aprobadorCorreo: correoDelJefe,
          requiereSegundaFirma: empleado.requiereSegundaFirma && !esOtorgamiento(datos.tipo),
        },
        await repo.enlaceDe(db, correoDelJefe),
      )
    : null;

  const adjunto = datos.adjunto
    ? {
        nombreArchivo: nombreArchivoNormalizado(datos.tipo, empleado.nombreCompleto, datos.fechaInicio),
        mime: datos.adjunto.mime,
        contenido: Buffer.from(datos.adjunto.contenidoBase64, 'base64'),
      }
    : null;

  // El tope real, ya decodificado: la estimación de base64 puede quedarse corta
  // si el cliente mete relleno o saltos de línea.
  if (adjunto && adjunto.contenido.length > MAX_ADJUNTO_BYTES) {
    throw new AusenciaError('adjunto_demasiado_grande', 400, 'adjunto');
  }

  const solicitud = await repo.crearSolicitud(
    db,
    {
      tipo: datos.tipo,
      empleadoId: empleado.id,
      solicitanteEmail: empleado.correo,
      fechaInicio: datos.fechaInicio,
      fechaFin: datos.fechaFin,
      diasHabiles,
      horaInicio: datos.horaInicio,
      horaFin: datos.horaFin,
      comentarios: datos.comentarios ?? null,
      estado,
      // Una incapacidad no la aprueba nadie: dejar aquí un aprobador la haría
      // aparecer en su bandeja de pendientes.
      aprobadorCorreo: firmantes ? firmantes.primero : null,
      segundoAprobadorCorreo: firmantes ? firmantes.segundo : null,
      informadoCorreo: firmantes ? firmantes.informado : null,
    },
    adjunto,
    eventosDeAlta(datos.tipo),
    construirPayload,
  );

  // Sin await: el aviso es un atajo para que el correo salga en un segundo en vez
  // de en unos minutos. La solicitud ya está guardada y encolada, así que esto no
  // puede fallar de forma que importe. Ver avisar.ts.
  void avisarN8n();
  return solicitud;
}

export async function misSolicitudes(db: Pool, sesion: Sesion): Promise<Solicitud[]> {
  const empleado = await empleadoDeSesion(db, sesion);
  return repo.solicitudesDeEmpleado(db, empleado.id);
}

/** Una solicitud de la bandeja, con si le toca firmarla a quien la mira. */
export interface SolicitudPendiente extends Solicitud {
  /**
   * Si le toca firmar AHORA a quien pregunta.
   *
   * Solo puede ser `false` para un **admin**: `solicitudesPendientes` ya filtra
   * por turno para todos los demás, y a un admin le entrega la empresa entera
   * para que pueda destrabar una aprobación cuyo firmante no está disponible.
   *
   * Se calcula aquí y no en el navegador para que la regla del turno siga
   * viviendo en un solo sitio (`correoDelTurno`). Duplicarla en el cliente es
   * cómo se llega a que la interfaz y el servidor discrepen sin que nada falle:
   * el 403 saltaría al pulsar, con el botón ya ofrecido.
   */
  esMiTurno: boolean;
}

export async function pendientesDeAprobar(db: Pool, sesion: Sesion): Promise<SolicitudPendiente[]> {
  const pendientes = await repo.solicitudesPendientes(db, sesion.email, sesion.esAdmin);
  const yo = sesion.email.toLowerCase();
  return pendientes.map((s) => ({ ...s, esMiTurno: (correoDelTurno(s) ?? '').toLowerCase() === yo }));
}

/**
 * El registro de movimientos que le corresponde a quien pregunta.
 *
 * ⚠️ El recorte lo decide AQUÍ el servidor a partir de la sesión, y NUNCA un
 * parámetro que mande el cliente: es la única barrera entre un jefe y el
 * historial de toda la empresa.
 *
 * Sustituye a `decididasPorMi` —que iba acotada al correo y sin guard porque
 * una lista vacía ya era la respuesta correcta—. Aquí no vale ese criterio: el
 * `soloDe` de `repo.movimientos` recorta por RAMA del organigrama, así que a
 * quien no aprueba a nadie no le saldría una lista vacía sino su propia rama
 * vacía... y a quien sí aprueba le saldrían las incapacidades y los permisos
 * —con sus motivos— de su rama. Por eso el 403 explícito: quien no es aprobador
 * no tiene registro que ver, y decírselo es mejor que enseñarle un vacío que
 * parece un fallo.
 *
 * Hay una TERCERA vía además de admin y aprobador: la ficha marcada con
 * `ve_toda_la_empresa` (migración 032), que entra sin aprobar a nadie y sin
 * recorte por rama. Existe para el puesto de administración que lleva la
 * nómina, que necesita la compañía entera y no una rama, y a quien darle el rol
 * de admin le regalaría además editar, borrar e importar.
 */
export async function movimientosVisibles(db: Pool, sesion: Sesion): Promise<Movimiento[]> {
  // Se resuelve UNA vez y antes del guard porque decide las DOS cosas: si pasa
  // y qué ve. Preguntarlo por separado en cada sitio dejaría abierta la puerta a
  // que un día solo se cambiara uno de los dos, y esa discrepancia no falla: o
  // deja fuera a quien tiene el permiso, o —lo grave— deja pasar el recorte por
  // rama sobre alguien a quien ya se le abrió el 403.
  const veTodo = sesion.esAdmin || (await repo.esVisorDeTodaLaEmpresa(db, sesion.email));
  if (!veTodo && !(await repo.esAprobadorDeAlguien(db, sesion.email))) {
    throw new AusenciaError('no_es_aprobador', 403);
  }
  return repo.movimientos(db, veTodo ? null : sesion.email);
}

/**
 * Todas las solicitudes que llevan un PDF, para que administración pueda abrirlos
 * sin salir del portal.
 *
 * Hace falta una pantalla propia porque **las incapacidades no aparecen en
 * ninguna otra**: nacen `registrada` y sin aprobador, así que ni la bandeja
 * (`pendiente`/`pendiente_2`) ni el historial (`aprobada`/`rechazada`) las
 * alcanzan, y «Registro general» es solo de admin. Justo las incapacidades son
 * las que siempre traen soporte médico.
 *
 * 403 y no 404, al revés que en `/adjuntos/:id`: allí el 404 evita confirmar que
 * un adjunto concreto existe; una colección no dice nada de nadie en particular.
 */
export async function solicitudesConAdjunto(db: Pool, sesion: Sesion): Promise<Solicitud[]> {
  if (!sesion.esAdmin && !(await repo.esVisorDeAdjuntos(db, sesion.email))) {
    throw new AusenciaError('no_es_visor_de_adjuntos', 403);
  }
  return repo.solicitudesConAdjunto(db);
}

/**
 * Quién firma los correos que salen de esta decisión: la persona de la sesión.
 *
 * La sesión y NO el `aprobadorCorreo` congelado en la solicitud, y la diferencia
 * importa en el caso que se da de verdad: un admin destrabando una aprobación
 * firma con su nombre, porque es quien decidió. Es el mismo criterio que la
 * columna «Decidida por» del registro, donde ya costó cuatro formas distintas de
 * atribuirle a alguien un acto que no hizo.
 *
 * `null` si no tiene ficha —se es aprobador por figurar en la columna de otro, y
 * un admin puede no tenerla—, y entonces `firmaDe` cae a la firma de la empresa.
 *
 * ⚠️ Si la consulta falla NO se tumba la decisión: la firma es un adorno del
 * correo y la aprobación es lo que el usuario vino a hacer. Perder la firma es
 * un correo menos personal; perder la decisión por no poder firmarla sería
 * cambiar un fallo cosmético por uno de negocio. Mismo criterio que los saldos
 * en `/ausencias/contexto`.
 */
async function firmanteDeSesion(db: Pool, sesion: Sesion): Promise<Firmante | null> {
  try {
    const ficha = await repo.empleadoDeUsuario(db, sesion.userId, sesion.email);
    return ficha ? { nombreCompleto: ficha.nombreCompleto, cargo: ficha.cargo } : null;
  } catch (e) {
    console.error('ausencias_firmante error', e);
    return null;
  }
}

export async function decidir(db: Pool, sesion: Sesion, id: string, body: unknown): Promise<Solicitud> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.aprueba !== 'boolean') throw new AusenciaError('aprueba_requerido', 400, 'aprueba');
  const motivo = typeof b.motivo === 'string' ? b.motivo.trim() : '';
  if (motivo.length > MAX_MOTIVO) throw new AusenciaError('motivo_demasiado_largo', 400, 'motivo');

  const solicitud = await repo.solicitudPorId(db, id);
  if (!solicitud) throw new AusenciaError('no_encontrada', 404);
  if (!puedeDecidir(sesion, solicitud)) throw new AusenciaError('no_es_su_aprobacion', 403);

  const transicion = transicionAlDecidir(solicitud, b.aprueba);
  // Estado terminal: `puedeDecidir` deja pasar a los dos firmantes precisamente
  // para llegar aquí, porque «ya decidida» describe mejor lo ocurrido que un 403.
  if (!transicion) throw new AusenciaError('ya_decidida', 409);

  const firmante = await firmanteDeSesion(db, sesion);
  const actualizada = await repo.decidirSolicitud(
    db,
    id,
    solicitud.estado,
    transicion,
    b.aprueba ? null : motivo || null,
    sesion.userId,
    // Una clausura con el firmante ya dentro, en vez de pasar la función a pelo.
    // Así el contrato que el repo pide —`(solicitud, evento) => PayloadEvento`—
    // no cambia y `construirPayload` sigue siendo pura: quien consulta la ficha
    // es el servicio, que es quien tiene el `Pool` y la sesión.
    (s, evento) => construirPayload(s, evento, firmante),
    // El aviso de la propuesta que caduca. Va SIN firmante y no es un olvido: no
    // la cierra nadie, la cierra el sistema porque la firma la dejó inaplicable.
    construirPayloadModificacion,
  );
  // El UPDATE lleva `AND estado = <el que se leyó>`: si no devolvió fila es que
  // otro (o un doble clic) se adelantó. Es un conflicto, no un fallo del servidor.
  if (!actualizada) throw new AusenciaError('ya_decidida', 409);

  void avisarN8n();
  return actualizada;
}

/**
 * Quien tiene el TURNO, o un admin (que destraba aprobaciones bloqueadas).
 *
 * ⚠️ Las ramas están separadas por estado a propósito. Escribirlo como un OR de
 * los dos correos —que es la forma más natural— dejaría al segundo aprobador
 * firmar una solicitud que su jefe inmediato todavía no ha visto: la cascada
 * dejaría de existir sin que nada fallara.
 *
 * En estado terminal pasan los dos firmantes, para que el 409 de «ya decidida»
 * gane al 403: es más informativo, y es lo que ya hacía la versión de una firma.
 */
export function puedeDecidir(sesion: Sesion, s: Solicitud): boolean {
  if (sesion.esAdmin) return true;
  const yo = sesion.email.toLowerCase();
  // **El propio solicitante no, aunque él mismo sea el aprobador congelado.**
  // Faltaba, y era el agujero: la raíz del organigrama se declara siendo su
  // propio jefe, así que su solicitud aterrizaba en su propia bandeja y se la
  // firmaba ella. Valía para TODOS los tipos, no solo para los otorgamientos.
  //
  // Gemela de la que `puedeDecidirModificacion` ya tenía, y con el mismo orden:
  // el admin va PRIMERO y queda fuera del candado, a sabiendas —ya puede
  // reescribir la fila entera con el PATCH, que no manda ningún correo, así que
  // cerrarle esta puerta solo lo empujaría a la silenciosa—.
  //
  // Se compara contra `solicitanteEmail`, el de la fila que el PATCH mantiene al
  // día, y no contra el congelado en ningún satélite.
  //
  // La otra mitad de la regla está en `jefeEfectivo` (jerarquia.ts), que manda
  // esas solicitudes al aprobador de reserva: sin ella esto no cerraría el
  // agujero, lo convertiría en un callejón sin salida.
  if (s.solicitanteEmail.toLowerCase() === yo) return false;
  if (s.estado === 'pendiente') return (s.aprobadorCorreo ?? '').toLowerCase() === yo;
  if (s.estado === 'pendiente_2') return (s.segundoAprobadorCorreo ?? '').toLowerCase() === yo;
  return (
    (s.aprobadorCorreo ?? '').toLowerCase() === yo || (s.segundoAprobadorCorreo ?? '').toLowerCase() === yo
  );
}

// ── Modificación de una solicitud ya enviada ───────────────────────────────

/**
 * Los estados que admiten una enmienda.
 *
 * `rechazada` queda fuera porque los días nunca se concedieron: lo que su dueño
 * quiere es volver a pedirlos, y para eso está `POST /solicitudes`. `registrada`
 * queda fuera porque una incapacidad se informa, no se concede: no hay a quién
 * mandarle la petición (y `decisorDeModificacion` devuelve `null`, que es la
 * comprobación que de verdad lo cierra).
 */
const ESTADOS_MODIFICABLES: readonly EstadoSolicitud[] = ['pendiente', 'pendiente_2', 'aprobada'];

/**
 * Si su dueño puede RETIRARLA él mismo, sin pedirle permiso a nadie.
 *
 * Mucho más estrecho que `puedePedirModificacion`: solo mientras esté
 * `pendiente` y **sin ninguna firma dada**. En `pendiente_2` el jefe inmediato ya
 * dio su visto bueno, y hacerlo desaparecer sin decírselo sería borrarle una
 * decisión; para eso está pedir la anulación, que él firma.
 *
 * Las dos condiciones y no solo el estado: un admin puede devolver una solicitud
 * a `pendiente` desde el PATCH del registro sin limpiar `primeraFirmaAt`, y en
 * esa fila «pendiente» convive con una firma ya dada. Es el mismo par que
 * defiende el WHERE de `repo.retirarSolicitud`, y están en los dos sitios a
 * propósito: aquí decide el 409 con su mensaje, allí cierra la carrera.
 *
 * No mira la fecha, al revés que `puedePedirAnulacion`. No hace falta: una
 * solicitud sin firmar no ha reservado nada ni ha llegado al calendario, así que
 * retirar una que ya empezó no regala días de nadie — simplemente deja de pedir
 * unos que nunca se concedieron.
 */
export function puedeRetirarla(s: Pick<Solicitud, 'estado' | 'primeraFirmaAt'>): boolean {
  return s.estado === 'pendiente' && s.primeraFirmaAt === null;
}

/** Lo mínimo de una solicitud para saber si admite un cambio. */
type SolicitudEnmendable = Pick<
  Solicitud,
  'tipo' | 'estado' | 'fechaInicio' | 'fechaFin' | 'aprobadorCorreo' | 'segundoAprobadorCorreo'
>;

function estadoAdmiteModificacion(s: SolicitudEnmendable): boolean {
  return ESTADOS_MODIFICABLES.includes(s.estado) && decisorDeModificacion(s) !== null;
}

/**
 * Se mira `fechaFin` y NO `fechaInicio`, a propósito. Una ausencia en curso es
 * justo el caso donde «córtala, tengo que volver» es legítimo; una ya terminada
 * es corrección de nómina, no una aprobación que nadie pueda ya conceder.
 */
function sigueVigente(s: Pick<Solicitud, 'tipo' | 'fechaFin'>, hoy: string): boolean {
  // Un otorgamiento no caduca: su fecha es el día que se TRABAJÓ y está en el
  // pasado siempre, así que con la regla de las ausencias no se podría enmendar
  // ninguno — ni anularlo, que es lo que se decidió que tenía que poderse.
  //
  // Lo que le da o le quita vigencia es su ESTADO, y de eso ya se encarga
  // `estadoAdmiteModificacion`: los días concedidos siguen ahí mientras la
  // solicitud esté viva, se pidieran cuando se pidieran.
  if (esOtorgamiento(s.tipo)) return true;
  return s.fechaFin >= hoy;
}

/**
 * Anular exige que la ausencia **no haya empezado**, y por eso mira
 * `fechaInicio` donde `sigueVigente` mira `fechaFin`.
 *
 * No es simetría de más: anular deja la solicitud en `rechazada`, y `rechazada`
 * devuelve TODOS sus días —`disfrutadas` suma solo `['aprobada']`
 * (`saldo.ts`)— y la borra entera del calendario
 * (`calendario.ts`: «una rechazada no es una ausencia»). Sobre unas vacaciones
 * del 6 al 10 anuladas el día 8, eso regala los tres días que sí se
 * disfrutaron, sin que nada falle ni nadie se entere. Para ese caso la
 * herramienta es cambiar las fechas a 6–10 → 6–8, que recalcula `diasHabiles` y
 * deja el saldo correcto; por eso el error lo dice.
 *
 * ⚠️ `>=` y no `>`: una ausencia que EMPIEZA HOY sí se puede anular. Un día solo
 * queda consumido al terminar, y cancelar la mañana del primer día es un caso
 * real y frecuente. El riesgo residual —quien anule a las cinco de la tarde
 * habiendo disfrutado el día— es de UN día, exige mala fe, y deja rastro en el
 * outbox de quién lo pidió y cuándo. Con `>` se bloquearía el caso legítimo y
 * además esa persona se quedaría sin salida: una ausencia que empieza hoy no se
 * puede «acortar» a menos de un día. No cambiar a `>` sin releer esto.
 */
function noHaEmpezado(s: Pick<Solicitud, 'tipo' | 'fechaInicio'>, hoy: string): boolean {
  // Un otorgamiento no «empieza»: no hay días fuera que se estén consumiendo.
  // Toda la razón de esta regla —que anular devuelve TODOS los días, incluidos
  // los ya disfrutados— no le aplica: anularlo quita los días concedidos, y si la
  // persona ya se los gastó la bolsa queda en negativo, que es lo decidido y lo
  // que la app ya hace con el saldo de vacaciones.
  if (esOtorgamiento(s.tipo)) return true;
  return s.fechaInicio >= hoy;
}

/**
 * Si esta solicitud admite que su dueño pida cambiarle las FECHAS.
 *
 * Es el AND de las reglas que `pedirModificacion` comprueba por separado —él las
 * separa para poder dar el 409 exacto—, y vive aquí en una sola función porque
 * es lo que la interfaz necesita para decidir si enseña el botón. Duplicar la
 * regla en el navegador es cómo se llega a ofrecer un botón que responde 409 al
 * pulsarlo.
 */
export function puedePedirModificacion(s: SolicitudEnmendable, hoy: string): boolean {
  return estadoAdmiteModificacion(s) && sigueVigente(s, hoy);
}

/**
 * Si además admite que se pida ANULARLA. Estrictamente más exigente que
 * `puedePedirModificacion`: toda anulable es modificable, pero no al revés —una
 * ausencia ya empezada solo se puede acortar. Ver `noHaEmpezado`.
 */
export function puedePedirAnulacion(s: SolicitudEnmendable, hoy: string): boolean {
  return puedePedirModificacion(s, hoy) && noHaEmpezado(s, hoy);
}

/**
 * El dueño de una solicitud pide cambiarle las fechas o anularla.
 *
 * Tres cosas que NO pasan aquí, y cada una es un fallo de seguridad si se cae:
 *
 *  - `empleadoId` no se lee del cuerpo: sale de la sesión, igual que en
 *    `crearSolicitud`. Solo el DUEÑO puede pedirlo, ni siquiera un admin en
 *    nombre de otro — para corregir una fila a mano ya está el `PATCH`, que
 *    además no manda correos.
 *  - Los firmantes NO se rederivan. `aprobadorCorreo` sale de
 *    `decisorDeModificacion(solicitud)`, que lee la propia solicitud. Llamar
 *    aquí a `aprobadoresDe` mandaría «anula mis vacaciones aprobadas» a un jefe
 *    nuevo que no sabe que se aprobaron.
 *  - Los días hábiles los cuenta el servidor, nunca el cliente.
 */
export async function pedirModificacion(
  db: Pool,
  sesion: Sesion,
  solicitudId: string,
  body: unknown,
): Promise<Modificacion> {
  const empleado = await empleadoDeSesion(db, sesion);
  const solicitud = await repo.solicitudPorId(db, solicitudId);
  if (!solicitud) throw new AusenciaError('no_encontrada', 404);
  if (solicitud.empleadoId !== empleado.id) throw new AusenciaError('no_es_su_solicitud', 403);

  // Un solo `hoy` para las dos reglas de fecha: leerlo dos veces del reloj
  // dejaría abierta la rendija de que una caiga a un lado de la medianoche de
  // Bogotá y la otra al otro.
  const hoy = hoyEnColombia();
  if (!estadoAdmiteModificacion(solicitud)) throw new AusenciaError('estado_no_admite_modificacion', 409);
  if (!sigueVigente(solicitud, hoy)) throw new AusenciaError('solicitud_ya_pasada', 409);

  const datos = validarNuevaModificacion(body, solicitud, hoy);
  // La vigencia depende de la CLASE, y esta comprobación va después de validar
  // porque hasta aquí no se sabe cuál es. Anular una ausencia ya empezada
  // devolvería también los días ya disfrutados: ver `noHaEmpezado`.
  if (datos.clase === 'anulacion' && !noHaEmpezado(solicitud, hoy)) {
    throw new AusenciaError('anulacion_ya_empezada', 409);
  }

  // Solo un cambio de fechas puede crear un solapamiento: anular quita una
  // ausencia, y quitar nunca choca con nada. Se le pasa `solicitud.id` como
  // `excluirSolicitudId` porque si no, moverle las fechas a una solicitud viva
  // —acortarla, alargarla o desplazarla— la haría chocar contra ella misma; y
  // acortar es la única salida que le queda a una ausencia ya empezada, que no
  // se puede anular (ver `noHaEmpezado`).
  //
  // Las dos mitades del `if` no comprueban lo mismo por partida doble:
  //  - `datos.fechaInicio && datos.fechaFin` la pide EL COMPILADOR:
  //    `NuevaModificacion` (types.ts) es una interface plana, no una unión
  //    discriminada, así que `clase === 'fechas'` no estrecha `string | null` a
  //    `string` y sin ese trozo `exigirSinSolape` no compila.
  //  - `datos.clase === 'fechas'` hoy no cambia nada: en toda anulación
  //    `validarNuevaModificacion` devuelve las dos fechas en `null`, así que el
  //    trozo del compilador ya excluye la anulación por su cuenta —quitarla no
  //    pone rojo ni un test—. Se deja porque nombra a qué clase se le aplica la
  //    regla. Lo que NO hace: obligar a nadie a volver aquí. Si mañana
  //    `CLASES_MODIFICACION` gana una tercera clase con fechas, quedará fuera
  //    del candado en silencio mientras nadie toque esta línea.
  if (datos.clase === 'fechas' && datos.fechaInicio && datos.fechaFin) {
    await exigirSinSolape(
      db,
      empleado.id,
      solicitud.tipo,
      solicitud.estado,
      datos.fechaInicio,
      datos.fechaFin,
      solicitud.id,
    );
  }

  const decisor = decisorDeModificacion(solicitud);
  // `estadoAdmiteModificacion` ya lo ha exigido, pero eso vive treinta líneas
  // más arriba y en otra función: se comprueba aquí para que el tipo salga sin
  // aserción y para que reordenar los guards no abra un `null` silencioso.
  if (!decisor) throw new AusenciaError('estado_no_admite_modificacion', 409);

  const resultado = await repo.crearModificacion(
    db,
    {
      solicitudId,
      clase: datos.clase,
      // El estado que se acaba de LEER, como testigo de concurrencia hasta el
      // WHERE del INSERT. Ver `repo.crearModificacion`.
      estadoEsperado: solicitud.estado,
      fechaInicioNueva: datos.fechaInicio,
      fechaFinNueva: datos.fechaFin,
      diasHabilesNuevos:
        datos.fechaInicio && datos.fechaFin ? contarDiasHabiles(datos.fechaInicio, datos.fechaFin) : null,
      motivo: datos.motivo,
      aprobadorCorreo: decisor,
    },
    construirPayloadModificacion,
  );

  if (!resultado.ok) {
    throw resultado.razon === 'estado'
      ? new AusenciaError('solicitud_cambio_de_estado', 409)
      : new AusenciaError('ya_hay_modificacion_pendiente', 409);
  }

  void avisarN8n();
  return resultado.modificacion;
}

/**
 * Por qué una propuesta ya no se puede retirar. Son dos cosas distintas y el
 * cliente tiene que poder distinguirlas: «tu jefe ya la decidió» exige mirar el
 * resultado, y «ya la retiraste» —el doble clic— no exige nada.
 */
function codigoNoPendiente(estado: EstadoModificacion): string {
  return estado === 'retirada' ? 'ya_retirada' : 'ya_decidida';
}

/**
 * El autor retira su propia propuesta. Sin correo a nadie: retirar deja la
 * solicitud exactamente como estaba, así que no hay nada que comunicar.
 *
 * El dueño se comprueba por `empleadoId` contra la SOLICITUD, la misma noción
 * que usa `pedirModificacion`. Comparar aquí el `solicitanteEmail` congelado en
 * el satélite —que es el dato que la fila ya trae, y ahorraba esta consulta—
 * daba un 403 sobre su propia propuesta a quien hubiera cambiado de correo
 * entre pedirla y retirarla.
 */
export async function retirarModificacion(db: Pool, sesion: Sesion, id: string): Promise<Modificacion> {
  const empleado = await empleadoDeSesion(db, sesion);
  const modificacion = await repo.modificacionPorId(db, id);
  if (!modificacion) throw new AusenciaError('no_encontrada', 404);

  const solicitud = await repo.solicitudPorId(db, modificacion.solicitudId);
  // La FK va con ON DELETE CASCADE, así que una propuesta sin solicitud no
  // debería existir; si existiera, no hay dueño contra quien comparar y negarla
  // es lo único seguro.
  if (!solicitud) throw new AusenciaError('no_encontrada', 404);
  if (solicitud.empleadoId !== empleado.id) throw new AusenciaError('no_es_su_modificacion', 403);

  if (modificacion.estado !== 'pendiente') {
    throw new AusenciaError(codigoNoPendiente(modificacion.estado), 409);
  }

  const retirada = await repo.retirarModificacion(db, id);
  if (!retirada) {
    // Sin fila: alguien la movió entre la lectura y el UPDATE. Se relee para
    // decir cuál de las dos cosas pasó en vez de acusar al jefe por defecto —el
    // caso más probable aquí es el doble clic del propio autor.
    const actual = await repo.modificacionPorId(db, id);
    throw new AusenciaError(actual ? codigoNoPendiente(actual.estado) : 'no_encontrada', actual ? 409 : 404);
  }
  return retirada;
}

/**
 * El dueño retira su propia solicitud. No la decide nadie: la quita él.
 *
 * Los tres guards van en este orden y no es indiferente:
 *  1. Existe. 404 si no.
 *  2. Es SUYA. 403 — y se compara contra el empleado de la sesión, nunca contra
 *     nada que venga en la petición. Ni un admin puede retirar la de otro: para
 *     tocar la fila de un tercero está el `DELETE` del registro, que además deja
 *     rastro de quién lo hizo.
 *  3. Está retirable. 409 con el porqué.
 *
 * El 403 va ANTES que el 409 a propósito: a quien no es el dueño no se le dice
 * en qué estado está la solicitud de otro, ni siquiera para negarle la acción.
 */
export async function retirarSolicitud(db: Pool, sesion: Sesion, id: string): Promise<Solicitud> {
  const empleado = await empleadoDeSesion(db, sesion);
  const solicitud = await repo.solicitudPorId(db, id);
  if (!solicitud) throw new AusenciaError('no_encontrada', 404);
  if (solicitud.empleadoId !== empleado.id) throw new AusenciaError('no_es_su_solicitud', 403);
  if (!puedeRetirarla(solicitud)) throw new AusenciaError('ya_no_se_puede_retirar', 409, 'estado');

  const retirada = await repo.retirarSolicitud(db, id, construirPayload);
  // Sin fila: el jefe firmó entre la lectura y el UPDATE, y su firma gana. Es un
  // conflicto, no un fallo — el mismo 409 que da el doble clic en la bandeja.
  if (!retirada) throw new AusenciaError('ya_no_se_puede_retirar', 409, 'estado');

  void avisarN8n();
  return retirada;
}

// ── Decidir la modificación ────────────────────────────────────────────────

/**
 * Quién puede aprobar o rechazar una propuesta.
 *
 * ⚠️ El decisor sale de la PROPUESTA (`m.aprobadorCorreo`, congelado al pedirla)
 * y de ningún otro sitio. La solicitud entra por parámetro para el guard del
 * solicitante —y para que el llamante ya la tenga cargada—, pero **sus firmantes
 * NO se miran**: escribir esto como un OR de `s.aprobadorCorreo` y
 * `s.segundoAprobadorCorreo` es lo natural y es exactamente el bug que
 * `puedeDecidir` documenta treinta líneas más arriba. Sobre una `pendiente_2`,
 * ese OR dejaría decidir el cambio al jefe inmediato, que ya perdió el turno.
 *
 * **El propio solicitante no, aunque la propuesta sea suya**: autoaprobarse
 * convierte el debido proceso en un formulario. Se compara contra
 * `s.solicitanteEmail` —el de la fila, que el PATCH mantiene al día— y no contra
 * el congelado en el satélite: quien cambiara de correo entre pedirla y
 * decidirla se saltaría el candado con la copia vieja.
 *
 * El admin va PRIMERO, como en `puedeDecidir`: es quien destraba una decisión
 * cuyo firmante no está disponible. Eso deja fuera del candado a un admin que
 * decidiera su propia propuesta, y se acepta a sabiendas: ese admin ya puede
 * reescribir la fila entera con el `PATCH`, que **no manda ningún correo**,
 * mientras que por aquí la decisión sale por correo a toda la cadena. Cerrarle
 * esta puerta solo lo empujaría a la silenciosa.
 */
export function puedeDecidirModificacion(sesion: Sesion, m: Modificacion, s: Solicitud): boolean {
  if (sesion.esAdmin) return true;
  const yo = sesion.email.toLowerCase();
  if (s.solicitanteEmail.toLowerCase() === yo) return false;
  return m.aprobadorCorreo.toLowerCase() === yo;
}

/**
 * Una solicitud de la bandeja de cambios: su propuesta viva, y si quien mira
 * puede decidirla.
 *
 * `modificacionPendiente` se estrecha a NO nula: en esta respuesta nunca lo es
 * —la consulta filtra por `m.id IS NOT NULL`—, y dejarla nullable obligaría al
 * espejo manual del frontend a un `!` por fila para algo que no puede pasar.
 *
 * `puedoDecidirla` es el `esMiTurno` de esta bandeja, y existe por la misma
 * razón: que la regla viva en un solo sitio. Duplicar el guard en el navegador
 * es cómo se llega a ofrecer un botón que responde 403 al pulsarlo, y aquí la
 * parte que un espejo manual se deja es justo la que más importa (la exclusión
 * del solicitante).
 */
export type SolicitudConPropuesta = Solicitud & {
  modificacionPendiente: Modificacion;
  puedoDecidirla: boolean;
};

/** Estrecha el tipo sin `!`, y de paso descarta una fila imposible. */
const tienePropuesta = (s: Solicitud): s is Solicitud & { modificacionPendiente: Modificacion } =>
  s.modificacionPendiente !== null;

/**
 * Las solicitudes con una propuesta viva que le toca decidir a quien pregunta.
 *
 * Sin guard de aprobador: quien no tenga ninguna recibe lista vacía, no un 403.
 * Mismo criterio que `pendientesDeAprobar` — un 403 no aportaría nada y
 * obligaría a la app a saber de antemano si alguien es decisor.
 *
 * Es el criterio CONTRARIO al de `movimientosVisibles`, y a propósito: esta
 * bandeja acota por el decisor congelado en cada propuesta, así que quien no
 * decide nada recibe de verdad una lista vacía. Aquella acota por RAMA del
 * organigrama, y ahí no ponerle guard sería dejar la puerta abierta.
 *
 * ⚠️ La fila puede venir con `puedoDecidirla: false`, y no es un caso raro: la
 * RAÍZ del organigrama es su propio jefe (`aprobadoresDe` lo trata así a
 * propósito), así que sobre sus propias solicitudes el decisor congelado es ella
 * misma y el guard del solicitante la frena. Se le enseña la fila apagada —y con
 * el botón de retirar, que sí es suyo— en vez de esconderla o de ofrecerle un
 * botón que responde 403. Un admin también las ve todas, como en la bandeja de
 * solicitudes.
 */
export async function modificacionesPendientes(db: Pool, sesion: Sesion): Promise<SolicitudConPropuesta[]> {
  const solicitudes = await repo.modificacionesPendientes(db, sesion.email, sesion.esAdmin);
  return solicitudes.filter(tienePropuesta).map((s) => ({
    ...s,
    puedoDecidirla: puedeDecidirModificacion(sesion, s.modificacionPendiente, s),
  }));
}

/**
 * El jefe decide la propuesta. El cuerpo es `{ aprueba, motivo? }`, **idéntico**
 * al de la decisión de una solicitud, para que la interfaz pueda reutilizar el
 * mismo componente y el mismo manejo de errores.
 *
 * Decide UNA sola persona: la modificación no estrena segunda firma. La segunda
 * firma valida la concesión, que ya está validada, y exigir dos para *renunciar*
 * a unas vacaciones es absurdo.
 *
 * ⚠️ Limitación conocida y deliberada: aprobar un cambio de fechas sobre una
 * `pendiente_2` **no la devuelve a `pendiente`** para que el primer jefe
 * refirme. `transicionAlDecidir` es monótona por diseño, y esa arista hacia
 * atrás repoblaría la bandeja del primer firmante mientras el segundo está
 * decidiendo, además de romper el razonamiento del testigo (el estado previo
 * dejaría de describir la fila). El primer firmante se entera por el correo, que
 * va a la cadena entera.
 */
export async function decidirModificacion(
  db: Pool,
  sesion: Sesion,
  id: string,
  body: unknown,
): Promise<{ modificacion: Modificacion; solicitud: Solicitud }> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.aprueba !== 'boolean') throw new AusenciaError('aprueba_requerido', 400, 'aprueba');
  const motivo = typeof b.motivo === 'string' ? b.motivo.trim() : '';
  // El tope del rechazo, no el de la petición: aquí se justifica un no, que es
  // exactamente lo mismo que hace `decidir`.
  if (motivo.length > MAX_MOTIVO) throw new AusenciaError('motivo_demasiado_largo', 400, 'motivo');

  const modificacion = await repo.modificacionPorId(db, id);
  if (!modificacion) throw new AusenciaError('no_encontrada', 404);
  const solicitud = await repo.solicitudPorId(db, modificacion.solicitudId);
  // La FK va con ON DELETE CASCADE, así que esto no debería ocurrir; si
  // ocurriera, no hay solicitud a la que aplicar nada y negarlo es lo único
  // seguro. Mismo criterio que `retirarModificacion`.
  if (!solicitud) throw new AusenciaError('no_encontrada', 404);
  if (!puedeDecidirModificacion(sesion, modificacion, solicitud)) {
    throw new AusenciaError('no_es_su_aprobacion', 403);
  }
  // El guard va antes que este 409 —al revés que en `decidir`— porque aquí un
  // tercero no tiene ningún derecho a saber si la propuesta ya se decidió.
  if (modificacion.estado !== 'pendiente') throw new AusenciaError('ya_decidida', 409);

  const firmante = await firmanteDeSesion(db, sesion);
  const resultado = await repo.decidirModificacion(
    db,
    id,
    b.aprueba,
    b.aprueba ? null : motivo || null,
    sesion.userId,
    // Clausura con el firmante dentro, por lo mismo que en `decidir`.
    (s, m, evento) => construirPayloadModificacion(s, m, evento, firmante),
  );
  if (!resultado.ok) {
    // Los tres son 409 y cuentan cosas distintas: `ya_decidida` es el doble clic
    // o alguien que se adelantó; `solicitud_cambio_de_estado` es que la
    // solicitud se movió debajo —un PATCH de admin, una decisión del jefe— y
    // aplicar el cambio habría pisado esa corrección en silencio; `rango_solapado`
    // es que a esa persona le aprobaron OTRA ausencia sobre esos días entre que
    // se propuso el cambio y se firma, así que la propuesta era legal cuando se
    // pidió y ha dejado de serlo sin que nadie hiciera nada mal.
    if (resultado.razon === 'solape') {
      // Mismo `code`, mismo `field` y mismo `detalle` que las otras tres puertas,
      // y ya no por buena voluntad: los cuatro salen de `errorDeSolape`. Llegar
      // aquí con una forma distinta obligaría a la interfaz a aprender un segundo
      // caso para decir lo mismo.
      throw errorDeSolape(resultado.solape);
    }
    throw resultado.razon === 'ya_decidida'
      ? new AusenciaError('ya_decidida', 409)
      : new AusenciaError('solicitud_cambio_de_estado', 409);
  }

  void avisarN8n();
  // Se devuelven las DOS filas: la decisión toca dos, y quien pintaba la
  // solicitud necesita la versión nueva. Devolver solo la propuesta obligaría a
  // una segunda llamada cuyo resultado podría ya no ser este.
  return { modificacion: resultado.modificacion, solicitud: resultado.solicitud };
}

/**
 * El solicitante, sus dos aprobadores y quien tenga la llave maestra pueden ver
 * el PDF; nadie más (salvo admin).
 *
 * `esVisor` entra por parámetro y no se consulta aquí: desde que la lista salió
 * de `config.ts` a `portal.empleados`, resolverla dentro obligaría a pasar el
 * `Pool` y esta función dejaría de poder probarse sin Postgres — que no hay en
 * ningún test del repo. Quien llama lo resuelve con `repo.esVisorDeAdjuntos`.
 *
 * La llave AÑADE acceso, nunca lo condiciona: por eso va como retorno propio y
 * no como una condición del `return` final. Quitársela a alguien no puede
 * dejarle sin ver sus propias solicitudes.
 */
export function puedeVerAdjunto(sesion: Sesion, a: repo.AdjuntoCompleto, esVisor: boolean): boolean {
  if (sesion.esAdmin) return true;
  if (esVisor) return true;
  const yo = sesion.email.toLowerCase();
  // El segundo aprobador entra aquí aunque todavía no sea su turno: la ruta del
  // adjunto devuelve 404 y no 403, así que sin esto tendría que firmar un permiso
  // sin poder abrir su soporte y sin entender por qué.
  return (
    a.solicitanteEmail.toLowerCase() === yo ||
    (a.aprobadorCorreo ?? '').toLowerCase() === yo ||
    (a.segundoAprobadorCorreo ?? '').toLowerCase() === yo
  );
}

// ── Importación del histórico de la hoja ───────────────────────────────────

export interface ResumenImportacion {
  /** Filas leídas del Excel. */
  total: number;
  /** De esas, las que se pudieron atribuir a un empleado. */
  resueltas: number;
  importadas: number;
  yaExistian: number;
  /** Nombres que no casan con nadie. Se enseñan, no se adivinan. */
  sinResolver: string[];
  /** Nombres que casan con más de una persona. */
  ambiguos: { nombre: string; candidatos: string[] }[];
}

/**
 * Importa el histórico que solo vivía en la hoja.
 *
 * Con `dryRun` no escribe nada: la UI lo llama primero así para poder enseñar
 * el recuento y los nombres problemáticos antes de tocar la tabla.
 *
 * Importa lo que resuelve y **reporta lo que no**, en vez de abortar entero por
 * un nombre suelto. Reimportar es inocuo (el INSERT se salta lo que ya está),
 * así que corregir el maestro y volver a pasar el fichero es el camino natural.
 */
export async function importarHistorico(db: Pool, body: unknown): Promise<ResumenImportacion> {
  const filas = validarFilasHistorico(body);
  const dryRun = (body as { dryRun?: unknown })?.dryRun === true;
  const empleados = await repo.listarEmpleados(db);

  const resueltas: repo.FilaHistoricoResuelta[] = [];
  const sinResolver = new Set<string>();
  const ambiguos = new Map<string, string[]>();

  for (const f of filas) {
    const r = resolverEmpleado(f.nombre, empleados);
    if (r.ambiguo) {
      ambiguos.set(f.nombre, r.ambiguo.map((e) => e.nombreCompleto));
      continue;
    }
    if (!r.empleado) {
      sinResolver.add(f.nombre);
      continue;
    }
    resueltas.push({
      empleadoId: r.empleado.id,
      tipo: f.tipo,
      fechaInicio: f.fechaInicio,
      fechaFin: f.fechaFin,
      dias: f.dias,
      comentarios: f.comentarios,
      observaciones: f.observaciones,
      // Todas las de la hoja están resueltas: las incapacidades se informan y el
      // resto llegó con «Aprobado? = Sí» (los rechazos nunca se registraron).
      estado: f.tipo === 'incapacidad' ? 'registrada' : 'aprobada',
    });
  }

  const { importadas, yaExistian } = await repo.importarHistorico(db, resueltas, dryRun);

  return {
    total: filas.length,
    resueltas: resueltas.length,
    importadas,
    yaExistian,
    sinResolver: [...sinResolver],
    ambiguos: [...ambiguos].map(([nombre, candidatos]) => ({ nombre, candidatos })),
  };
}


// ── Saldo de vacaciones ────────────────────────────────────────────────────

/**
 * Tope del saldo de corte, en valor absoluto. NUMERIC(5,1) admite hasta 9999,9,
 * pero 999 días son 66 años de devengo: por encima es un error de tecleo.
 *
 * Se aplica también hacia abajo: el saldo PUEDE ser negativo —quien ha
 * adelantado vacaciones ha disfrutado más días de los que lleva devengados, y
 * el Excel del que salen los saldos iniciales los trae así— pero -1000 sigue
 * siendo un tecleo.
 */
const MAX_SALDO = 999;

/** Lo que un admin puede fijar. Las dos a null vacía la configuración. */
export interface SaldoAFijar {
  saldoCorte: number | null;
  fechaCorte: string | null;
}

/**
 * Un saldo en texto: signo menos opcional, dígitos y, como mucho, una coma o un
 * punto decimal.
 *
 * Se comprueba la FORMA antes de convertir porque `Number()` es demasiado
 * permisivo para tratarlo como la respuesta a un formulario: acepta espacios
 * en blanco como 0 (`Number('  ') === 0`), hexadecimal (`Number('0x10') ===
 * 16`) y notación científica (`Number('1e2') === 100`). El panel de admin usa
 * `type="text"` —hace falta para admitir la coma decimal, que un
 * `type="number"` rechaza en la mayoría de locales—, así que cualquiera de
 * esas rarezas puede llegar tal cual desde el campo.
 */
const RE_SALDO = /^-?\d{1,3}([.,]\d+)?$/;

/** Las dos bolsas que puede traer el body del panel de admin. */
export interface SaldosAFijar {
  vacaciones: SaldoAFijar;
  /**
   * Null cuando el body NO traía la pareja de compensatorios: entonces la bolsa
   * no se toca. Es distinto de traerla con los dos campos vacíos, que sí la vacía.
   */
  compensatorios: SaldoAFijar | null;
}

/**
 * Valida una pareja saldo+fecha. Exige las dos claves, o ninguna cosa a medias.
 *
 * El operador `in` mira la CLAVE, no el valor: así se distingue «vaciar a
 * propósito» (las dos claves presentes y en null) de «el body no trae las
 * claves que se esperan» (un `{}`, o un renombrado en el front como
 * `{saldo: 20, fecha: '...'}`). Mirando solo el valor, los dos casos
 * colapsarían en el mismo `undefined` y un renombrado borraría en silencio
 * un saldo ya configurado.
 */
function validarPareja(b: Record<string, unknown>, claveSaldo: string, claveFecha: string): SaldoAFijar {
  const saldoPresente = claveSaldo in b;
  const fechaPresente = claveFecha in b;
  if (!saldoPresente || !fechaPresente) {
    throw new AusenciaError('saldo_incompleto', 400, !saldoPresente ? claveSaldo : claveFecha);
  }

  const valorSaldo = b[claveSaldo];
  const valorFecha = b[claveFecha];
  const saldoVacio = valorSaldo === null || valorSaldo === '';
  const fechaVacia = valorFecha === null || valorFecha === '';

  // Vaciar la configuración es legítimo: devuelve al empleado a «sin configurar».
  if (saldoVacio && fechaVacia) return { saldoCorte: null, fechaCorte: null };
  // A medias, no: es justo lo que impide el CHECK de la BD, y aquí el mensaje
  // se puede explicar. El campo señalado es el que FALTA, no el que sí llegó
  // (si no, la interfaz resaltaría el campo que el admin rellenó bien).
  if (saldoVacio || fechaVacia) {
    throw new AusenciaError('saldo_incompleto', 400, saldoVacio ? claveSaldo : claveFecha);
  }

  // Se exige el tipo ANTES de convertir: un array no debe llegar siquiera a
  // `String()` (que lo aplanaría a su primer elemento, o a "", y las dos
  // formas parecen un número válido para lo que sigue).
  if (typeof valorSaldo !== 'number' && typeof valorSaldo !== 'string') {
    throw new AusenciaError('saldo_invalido', 400, claveSaldo);
  }
  let saldo: number;
  if (typeof valorSaldo === 'number') {
    saldo = valorSaldo;
  } else {
    if (!RE_SALDO.test(valorSaldo)) throw new AusenciaError('saldo_invalido', 400, claveSaldo);
    saldo = Number(valorSaldo.replace(',', '.'));
  }
  if (!Number.isFinite(saldo) || Math.abs(saldo) > MAX_SALDO) {
    throw new AusenciaError('saldo_invalido', 400, claveSaldo);
  }

  // Mismo defecto de rebote que en el saldo: un array como `['2026-08-12']`
  // pasaría igual por `String()`, así que se exige el tipo antes de mirar el
  // contenido. `esFechaValida` descarta de paso los valores mágicos de
  // Postgres (`'infinity'`, `'today'`), que la columna DATE aceptaría sin
  // rechistar.
  if (typeof valorFecha !== 'string') throw new AusenciaError('fecha_invalida', 400, claveFecha);
  if (!esFechaValida(valorFecha)) throw new AusenciaError('fecha_invalida', 400, claveFecha);

  return { saldoCorte: Math.round(saldo * 10) / 10, fechaCorte: valorFecha };
}

/**
 * Valida a mano lo que llega del cliente; en este repo no hay zod.
 *
 * ⚠️ Las dos parejas NO se tratan igual, y la asimetría es deliberada. La de
 * vacaciones se EXIGE: lleva ahí desde el principio, así que si falta solo puede
 * ser un front renombrado, y dar eso por bueno borraría un saldo configurado. La
 * de compensatorios, en cambio, puede faltar por una razón legítima —un bundle
 * del portal anterior a esta función, que no la conoce— y tratar su ausencia
 * como «vacíala» borraría la bolsa de todo aquel a quien un admin le corrigiera
 * las vacaciones durante la ventana de despliegue. Ausente = no se toca.
 *
 * Basta con que asome UNA de las dos claves para exigir la otra: así un front que
 * sí las conoce pero manda media pareja sigue recibiendo su 400.
 */
export function validarSaldo(body: unknown): SaldosAFijar {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const traeCompensatorios = 'compensatoriosSaldoCorte' in b || 'compensatoriosFechaCorte' in b;
  return {
    vacaciones: validarPareja(b, 'saldoCorte', 'fechaCorte'),
    compensatorios: traeCompensatorios
      ? validarPareja(b, 'compensatoriosSaldoCorte', 'compensatoriosFechaCorte')
      : null,
  };
}

// ── Organigrama ────────────────────────────────────────────────────────────

/** Un empleado del maestro con su posición en el árbol ya derivada. */
export interface EmpleadoConJefatura extends Empleado {
  /** Quien firmaría en segundo lugar una solicitud suya creada ahora mismo. */
  segundoAprobadorCorreo: string | null;
  /**
   * Quien solo se enteraría del resultado, si su ficha no exige segunda firma.
   * Excluyente con el de arriba, y por eso van los dos: el panel necesita saber
   * QUIÉN está en el escalón de arriba aunque hoy no firme.
   *
   * No confundir con el `informadoCorreo` de `Solicitud`: aquel se congela en el
   * alta y vive con esa solicitud para siempre; este se recalcula en cada
   * consulta al maestro y cambia en cuanto se mueve el organigrama o se apaga la
   * casilla.
   */
  informadoCorreo: string | null;
  /** Su rama del organigrama forma un círculo. Se avisa, no se bloquea. */
  enCiclo: boolean;
  /**
   * Tiene rol de administrador en el portal.
   *
   * Existe para UNA cosa: que el panel no pinte las tres casillas de permisos
   * —soportes, exporta, empresa— en su fila. El rol ya se las da todas, plegadas
   * dentro de los booleanos del contexto, así que una casilla sin marcar ahí
   * afirmaba lo contrario de lo que pasa de verdad.
   *
   * NO es un permiso ni se guarda en `portal.empleados`: se deriva en cada
   * consulta del rol que tenga esa persona en `portal.users`. Si deja de ser
   * admin, sus casillas vuelven a aparecer con el valor que la columna tuviera
   * guardado — que es justo el que pasaría a aplicarle.
   */
  esAdminDelPortal: boolean;
}

/**
 * El maestro con el árbol resuelto. La derivación se hace AQUÍ y no en el
 * navegador para que la regla viva en un solo sitio: el admin ve exactamente lo
 * que se congelaría en una solicitud nueva, no una aproximación.
 */
export async function empleadosConJefatura(db: Pool): Promise<EmpleadoConJefatura[]> {
  const [empleados, enlaces, admins] = await Promise.all([
    repo.listarEmpleados(db),
    repo.enlacesActivos(db),
    repo.correosDeAdmin(db),
  ]);
  const porCorreo = new Map(enlaces.map((e) => [e.correo, e]));
  const enCiclo = new Set(detectarCiclos(construirIndice(enlaces)).flat());

  return empleados.map((e) => {
    // Por `jefeEfectivo` también, y no solo el alta: si no, el panel enseñaría a
    // la raíz del organigrama que se aprueba a sí misma mientras el alta la manda
    // a otro sitio. La derivación tiene que decir lo que de verdad va a pasar.
    const jefe = jefeEfectivo(e);
    const arriba = aprobadoresDe({ ...e, aprobadorCorreo: jefe }, porCorreo.get(jefe) ?? null);
    return {
      ...e,
      segundoAprobadorCorreo: arriba.segundo,
      informadoCorreo: arriba.informado,
      enCiclo: enCiclo.has(e.correo.toLowerCase()),
      // En minúsculas por los dos lados: el Set ya viene con `lower()` del SQL,
      // y el correo de la ficha lo escribe la hoja de Google sin garantía de
      // caja. Comparar en crudo dejaría a un admin con el correo en mayúsculas
      // fuera del conjunto y con sus tres casillas puestas otra vez — un fallo
      // que no rompe nada y que solo se nota mirando la fila de esa persona.
      esAdminDelPortal: admins.has(e.correo.toLowerCase()),
    };
  });
}

/**
 * Cambia el jefe inmediato de alguien.
 *
 * Autoasignarse es legítimo: así se declara la raíz del organigrama. Un ciclo se
 * rechaza al escribir (409), pero uno que YA esté en la base de datos no bloquea
 * la edición: si lo hiciera, sería imposible deshacerlo desde el panel.
 */
export async function fijarJefe(db: Pool, empleadoId: string, body: unknown): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b.aprobadorCorreo !== 'string') throw new AusenciaError('jefe_requerido', 400, 'aprobadorCorreo');
  const jefe = b.aprobadorCorreo.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(jefe)) throw new AusenciaError('correo_invalido', 400, 'aprobadorCorreo');

  const empleado = await repo.empleadoPorId(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404);

  const enlaces = await repo.enlacesActivos(db);
  const conocido = enlaces.some((e) => e.correo === jefe);
  // El buzón por defecto se acepta aunque no tenga ficha de empleado: es de quien
  // cuelga toda la plantilla hoy, y rechazarlo dejaría el organigrama sin raíz.
  if (!conocido && jefe !== APROBADOR_POR_DEFECTO.toLowerCase()) {
    throw new AusenciaError('jefe_no_encontrado', 400, 'aprobadorCorreo');
  }
  if (creariaCiclo(construirIndice(enlaces), empleado.correo, jefe)) {
    throw new AusenciaError('ciclo_jerarquia', 409, 'aprobadorCorreo');
  }

  if (!(await repo.fijarJefe(db, empleadoId, jefe))) throw new AusenciaError('empleado_no_encontrado', 404);

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Fija a quién se pone en copia de los correos de alguien. `null` = a nadie.
 *
 * Se valida contra los empleados ACTIVOS, no solo el formato del correo: el
 * desplegable del panel solo ofrece personas de la plantilla, y aceptar aquí
 * cualquier cosa dejaría entrar erratas que mandarían los avisos al vacío sin
 * que nadie se enterara. No hay comprobación de ciclos, a diferencia del jefe:
 * esto no es un árbol y estar en copia no da ningún permiso.
 */
export async function fijarCopia(db: Pool, empleadoId: string, body: unknown): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const bruto = b.copiaCorreo;
  if (bruto !== null && typeof bruto !== 'string') {
    throw new AusenciaError('copia_invalida', 400, 'copiaCorreo');
  }

  const copia = typeof bruto === 'string' && bruto.trim() ? bruto.trim().toLowerCase() : null;
  if (copia !== null) {
    const enlaces = await repo.enlacesActivos(db);
    // El buzón por defecto se acepta aunque no tenga ficha activa, igual que
    // `APROBADOR_POR_DEFECTO` en `fijarJefe`: es el valor con el que la migración
    // 021 sembró toda la plantilla, y rechazarlo lo dejaría irreponible desde el
    // panel en cuanto su ficha se desactivara.
    if (!enlaces.some((e) => e.correo === copia) && copia !== COPIA_POR_DEFECTO.toLowerCase()) {
      throw new AusenciaError('copia_no_encontrada', 400, 'copiaCorreo');
    }
  }

  if (!(await repo.fijarCopia(db, empleadoId, copia))) throw new AusenciaError('empleado_no_encontrado', 404);

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Enciende o apaga la segunda firma de alguien.
 *
 * Sin registro de auditoría, al contrario que `fijarVisor`: esto no da acceso a
 * ningún dato personal, así que se queda al nivel del jefe y de la copia. Y sin
 * comprobación de ciclos, al contrario que `fijarJefe`: no se toca ninguna arista
 * del árbol, solo si el escalón de arriba firma o se limita a enterarse.
 *
 * Las solicitudes ya en vuelo no se mueven: llevan su reparto congelado del alta.
 */
export async function fijarSegundaFirma(
  db: Pool,
  empleadoId: string,
  body: unknown,
): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  // El tipo se exige, no se interpreta: `'no'` es una cadena con valor de verdad,
  // y aceptarla dejaría encendida una casilla que alguien quiso apagar.
  if (typeof b.requiereSegundaFirma !== 'boolean') {
    throw new AusenciaError('segunda_firma_invalida', 400, 'requiereSegundaFirma');
  }

  if (!(await repo.fijarSegundaFirma(db, empleadoId, b.requiereSegundaFirma))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Da o quita la llave maestra de los adjuntos, dejando constancia.
 *
 * Recibe la `Sesion` —al contrario que `fijarJefe` y `fijarCopia`— porque el
 * registro tiene que decir QUIÉN lo hizo. Es lo que sustituye al historial de
 * git desde que la lista dejó de vivir en `config.ts`.
 *
 * Si el valor no cambia no se escribe nada, ni en la tabla ni en el registro:
 * el botón del panel guarda la fila entera, así que llegaría aquí también
 * cuando lo tocado fuera el jefe o la copia.
 */
export async function fijarVisor(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: unknown,
): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b.veAdjuntos !== 'boolean') throw new AusenciaError('visor_invalido', 400, 'veAdjuntos');

  const empleado = await repo.empleadoPorId(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404);

  if (empleado.veAdjuntos !== b.veAdjuntos) {
    // Una sola llamada que da la llave Y la registra en la misma transacción:
    // ver el porqué en `repo.fijarVisorConRegistro`.
    if (
      !(await repo.fijarVisorConRegistro(db, {
        empleadoId,
        veAdjuntos: b.veAdjuntos,
        adminEmail: sesion.email,
        empleadoCorreo: empleado.correo,
      }))
    ) {
      throw new AusenciaError('empleado_no_encontrado', 404);
    }
  }

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Da o quita el permiso de exportar el registro, dejando constancia.
 *
 * Recibe la `Sesion` por lo mismo que `fijarVisor`: el registro tiene que decir
 * QUIÉN lo concedió. Exportar es sacar de la aplicación las incapacidades y los
 * permisos de la plantilla —con sus motivos— a un fichero que ya nadie
 * controla, así que quién dio esa llave es tan auditable como quién dio la de
 * los adjuntos.
 *
 * Sin el «si no cambia, no se escribe» de `fijarVisor`, y no por descuido: aquel
 * lo necesita porque su botón guarda la fila entera del panel y llegaría aquí
 * también al tocar el jefe o la copia. Este interruptor es propio y no
 * comparte botón con nada más, así que cada llamada ya es una decisión de
 * cambiar el permiso, no un efecto colateral de guardar otra cosa —no hace
 * falta el guard para evitar ruido. `exportaRegistro` ya viaja en `Empleado`
 * (ver `repo.ts`), así que si el panel acabara fusionando este botón con el
 * del resto de la fila, añadir el guard sería tan barato como en `fijarVisor`:
 * una comparación contra la ficha que ya trae `repo.empleadoPorId`, sin
 * consulta extra.
 *
 * Devuelve `{ ok: true }` y nada más —no la ficha, al contrario que `fijarVisor`—
 * porque el permiso no se pinta en la fila del maestro: quien lo cambia solo
 * necesita saber que cuajó. Los caminos que no cuajan salen por `AusenciaError`,
 * así que el `ok` nunca llega a ser `false`; el tipo lo admite para que añadir un
 * «no se pudo» no cambie el contrato del cliente.
 */
export async function fijarExportador(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: { concedido?: unknown },
): Promise<{ ok: boolean }> {
  // El tipo se exige, no se interpreta, igual que en `fijarSegundaFirma`: `'no'`
  // es una cadena con valor de verdad, y aceptarla concedería el permiso que
  // alguien quiso quitar.
  const concedido = (body ?? {}).concedido;
  if (typeof concedido !== 'boolean') {
    throw new AusenciaError('exportador_invalido', 400, 'concedido');
  }

  // Una sola llamada que cambia el permiso Y lo registra en la misma
  // transacción: el porqué está en `repo.fijarExportador`.
  if (!(await repo.fijarExportador(db, sesion.email, empleadoId, concedido))) {
    // Ficha inexistente o inactiva. Las dos son un 404 para quien llama, y en
    // las dos el repo se ha guardado de escribir nada en la auditoría.
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  return { ok: true };
}

/**
 * Da o quita la vista de toda la empresa —el calendario y el registro—, dejando
 * constancia.
 *
 * Copia la forma de `fijarExportador` punto por punto, y no la de `fijarVisor`:
 * recibe la `Sesion` porque el registro tiene que decir QUIÉN lo concedió, exige
 * el booleano en vez de interpretarlo —`'no'` es una cadena con valor de verdad,
 * y aceptarla concedería el permiso que alguien quiso quitar— y devuelve
 * `{ ok: true }` en vez de la ficha, porque quien lo cambia solo necesita saber
 * que cuajó.
 *
 * Sin el «si no cambia, no se escribe» de `fijarVisor`, por lo mismo que su
 * gemelo de exportación: este interruptor no comparte endpoint con el resto de
 * la fila, así que cada llamada ya es una decisión de cambiar el permiso y no un
 * efecto colateral de guardar otra cosa. El panel llama solo si el valor cambió.
 */
export async function fijarVisorDeEmpresa(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: { concedido?: unknown },
): Promise<{ ok: boolean }> {
  const concedido = (body ?? {}).concedido;
  if (typeof concedido !== 'boolean') {
    throw new AusenciaError('visor_empresa_invalido', 400, 'concedido');
  }

  // Una sola llamada que cambia el permiso Y lo registra en la misma
  // transacción: el porqué está en `repo.fijarVisorDeEmpresa`.
  if (!(await repo.fijarVisorDeEmpresa(db, sesion.email, empleadoId, concedido))) {
    // Ficha inexistente o inactiva. Las dos son un 404 para quien llama, y en
    // las dos el repo se ha guardado de escribir nada en la auditoría.
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  return { ok: true };
}

/**
 * Da o quita la llave del panel de KPIs (migración 038).
 *
 * Copia exacta de `fijarVisorDeEmpresa` de aquí arriba, y por los mismos
 * motivos: exige el booleano en vez de interpretarlo —`'no'` es una cadena con
 * valor de verdad, y aceptarla concedería el permiso que alguien quiso quitar—,
 * devuelve `{ ok: true }` porque quien lo cambia solo necesita saber que cuajó,
 * y delega en el repo el UPDATE y el registro en una sola transacción.
 *
 * La diferencia con sus hermanas NO está aquí sino en la LECTURA: el contexto
 * no envuelve `esVisorDeKpis` en un `sesion.esAdmin || ...`. Ver el JSDoc de
 * `repo.esVisorDeKpis`.
 */
export async function fijarVisorDeKpis(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: { concedido?: unknown },
): Promise<{ ok: boolean }> {
  const concedido = (body ?? {}).concedido;
  if (typeof concedido !== 'boolean') {
    throw new AusenciaError('visor_kpis_invalido', 400, 'concedido');
  }

  if (!(await repo.fijarVisorDeKpis(db, sesion.email, empleadoId, concedido))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  return { ok: true };
}

// ── Panel de KPIs ──────────────────────────────────────────────────────────

/** Cuántos meses hacia atrás mira el KPI de tiempos de aprobación. */
const MESES_DE_VENTANA = 12;

export interface Kpis {
  /**
   * La deuda: cuántos días de vacaciones y de compensatorios tiene acumulados
   * la plantilla activa, sumados. Es la cifra que hoy no ve nadie —Saldos la
   * enseña persona a persona y nunca sumada—.
   */
  pasivo: {
    diasVacaciones: number;
    diasCompensatorios: number;
    /** Sobre cuántas fichas activas se ha sumado. Un total sin su denominador
     *  no se puede comparar con el del mes que viene. */
    empleados: number;
  };
  tiempos: TiempoDeAprobador[];
  pendientes: PendientesPorAntiguedad;
  /** El inicio de la ventana de `tiempos`, en ISO, para poder decirlo en la
   *  pantalla en vez de que el lector tenga que suponerlo. */
  desde: string;
}

/**
 * Los tres KPIs del panel.
 *
 * ⚠️ NO recibe `Sesion`, y es deliberado: esto es un agregado de la compañía
 * entera, no una vista recortada por quien pregunta. Quién puede pedirlo lo
 * decide el router con `repo.esVisorDeKpis` ANTES de llamar aquí, y ese sí es
 * un candado de verdad —la respuesta lleva los datos dentro, así que no basta
 * con no pintar el botón—.
 *
 * ⚠️ EL PASIVO SE REUTILIZA, NO SE RECALCULA. Sale del mismo `combinar()` que
 * alimenta la pestaña Saldos, y no de un `SUM()` en SQL, aunque un SUM sería
 * más corto. El motivo: `disponible` no es una columna, es el resultado de
 * `saldoCorte + devengado − disfrutado` con el devengo congelado ficha a ficha
 * (ver `saldo.ts`). Reescribir esa cuenta en SQL crearía una segunda verdad, y
 * el día que las dos pantallas discreparan nadie sabría cuál creer.
 */
export async function kpis(db: Pool): Promise<Kpis> {
  const desde = new Date();
  desde.setUTCMonth(desde.getUTCMonth() - MESES_DE_VENTANA);
  const desdeIso = desde.toISOString();

  // El `null` explícito de `soloDe` es obligatorio (ver `empleadosConSaldo`), y
  // aquí además es lo que hace que sea la plantilla ENTERA y no una rama.
  const empleados = await repo.empleadosConSaldo(db, null, null);
  const [ausencias, decisiones, pendientes] = await Promise.all([
    repo.ausenciasQueTocanElSaldo(
      db,
      empleados.map((e) => e.empleadoId),
    ),
    repo.decisionesParaKpi(db, desdeIso),
    repo.pendientesParaKpi(db),
  ]);

  const saldos = combinar(empleados, ausencias, hoyEnColombia());

  return {
    pasivo: {
      diasVacaciones: redondearDias(saldos.reduce((t, s) => t + s.saldo.disponible, 0)),
      diasCompensatorios: redondearDias(saldos.reduce((t, s) => t + s.compensatorios.disponible, 0)),
      empleados: saldos.length,
    },
    tiempos: tiemposPorAprobador(decisiones),
    pendientes: pendientesPorAntiguedad(pendientes, new Date().toISOString()),
    desde: desdeIso,
  };
}

/**
 * Un decimal. Sumar cien `disponible` en coma flotante produce colas del tipo
 * `1234.5999999999999`, y esta cifra se lee como si fuera contable.
 */
function redondearDias(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Las dos bolsas de un empleado, listas para enseñar. */
export interface SaldoDeEmpleado {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  saldo: SaldoVacaciones;
  compensatorios: SaldoCompensatorios;
}

/**
 * Reetiqueta con el correo Y con la bolsa el error de una fila corrupta.
 *
 * El cálculo lanza si alguna fecha viniera mal. Esto recorre a toda la plantilla,
 * así que sin el correo una sola fila mala dejaría la lista del admin a oscuras
 * sin decir de quién es el problema. Y ahora hay dos bolsas con dos fechas de
 * corte distintas: sin decir CUÁL de las dos envenenó la fila, el admin sabría a
 * quién mirar pero no qué columna arreglar.
 */
function conEtiqueta<T>(correo: string, bolsa: string, calcular: () => T): T {
  try {
    return calcular();
  } catch (err) {
    throw new Error(`saldo de ${bolsa} de ${correo}: ${(err as Error).message}`);
  }
}

/** Calcula las dos bolsas de cada empleado a partir de sus ausencias. */
function combinar(
  empleados: repo.EmpleadoConSaldo[],
  ausencias: repo.AusenciaDeEmpleado[],
  hoy: string,
): SaldoDeEmpleado[] {
  return empleados.map((e) => {
    // Una sola pasada por empleado: las dos bolsas miran la misma lista y cada
    // una descarta los tipos de la otra.
    const suyas = ausencias.filter((a) => a.empleadoId === e.empleadoId);
    // El «hoy» de ESTA ficha, no el de la pantalla: un retirado dejó de devengar
    // en su último día. Va aquí y no dentro de `calcularSaldo` porque el corte
    // es una propiedad del empleado, no del cálculo.
    const suHoy = hoyCongelado(e.fechaRetiro, hoy);
    const configVacaciones =
      e.saldoCorte !== null && e.fechaCorte !== null
        ? { saldoCorte: e.saldoCorte, fechaCorte: e.fechaCorte }
        : null;
    const configCompensatorios =
      e.compensatoriosSaldoCorte !== null && e.compensatoriosFechaCorte !== null
        ? { saldoCorte: e.compensatoriosSaldoCorte, fechaCorte: e.compensatoriosFechaCorte }
        : null;
    return {
      empleadoId: e.empleadoId,
      nombreCompleto: e.nombreCompleto,
      correo: e.correo,
      saldo: conEtiqueta(e.correo, 'vacaciones', () => calcularSaldo(configVacaciones, suyas, suHoy)),
      compensatorios: conEtiqueta(e.correo, 'compensatorios', () =>
        calcularSaldoCompensatorios(configCompensatorios, suyas, suHoy),
      ),
    };
  });
}

/**
 * Los saldos que esta sesión puede ver: todos si es admin, y solo los de la
 * gente que aprueba si no lo es.
 */
export async function saldosVisibles(db: Pool, sesion: Sesion): Promise<SaldoDeEmpleado[]> {
  // El `null` explícito es obligatorio: sin él, TypeScript ya no compila (ver
  // el porqué en el JSDoc de `empleadosConSaldo`).
  const empleados = await repo.empleadosConSaldo(db, sesion.esAdmin ? null : sesion.email, null);
  // Para quien no es admin, no aprobar a nadie es un 403. Para un admin, una
  // lista vacía es solo una lista vacía: la BD sin empleados todavía.
  if (!sesion.esAdmin && empleados.length === 0) throw new AusenciaError('no_es_aprobador', 403);
  const ausencias = await repo.ausenciasQueTocanElSaldo(
    db,
    empleados.map((e) => e.empleadoId),
  );
  return combinar(empleados, ausencias, hoyEnColombia());
}

/** Las dos bolsas de quien pregunta. Viajan juntas: la app siempre quiere las dos. */
export interface SaldosDeSesion {
  saldo: SaldoVacaciones;
  compensatorios: SaldoCompensatorios;
}

/**
 * Las bolsas del usuario logueado. Van dentro del contexto que carga la app.
 *
 * No comprueba que `empleado` sea el de la sesión que llama —no tiene con qué:
 * solo recibe la ficha, no la sesión—, así que esa garantía de privacidad vive
 * ENTERA en el llamante (que debe sacarla de `empleadoDeSesion`, nunca de un
 * id que decida el cliente). Pasarle la ficha de otro devuelve el saldo de ese
 * otro sin rechistar.
 */
export async function saldosDeSesion(db: Pool, empleado: Empleado): Promise<SaldosDeSesion> {
  const hoy = hoyEnColombia();
  const [fila] = await repo.empleadosConSaldo(db, null, empleado.id);
  // Sin fila —la ficha se desactivó después de que la sesión ya estuviera
  // abierta, por ejemplo— se devuelve un saldo en blanco en vez de lanzar:
  // esto viaja dentro del contexto que carga la app entera, y un 500 aquí
  // tumbaría toda la sesión por un dato que ni siquiera es crítico para poder
  // navegar.
  if (!fila) {
    return { saldo: calcularSaldo(null, [], hoy), compensatorios: calcularSaldoCompensatorios(null, [], hoy) };
  }
  const ausencias = await repo.ausenciasQueTocanElSaldo(db, [empleado.id]);
  const fusionada = combinar([fila], ausencias, hoy)[0];
  return { saldo: fusionada.saldo, compensatorios: fusionada.compensatorios };
}

/** Fija los puntos de corte de un empleado. Solo admin (lo exige el router). */
export async function fijarSaldo(db: Pool, empleadoId: string, body: unknown): Promise<SaldoDeEmpleado> {
  const { vacaciones, compensatorios } = validarSaldo(body);
  const existe = await repo.fijarSaldo(db, empleadoId, vacaciones, compensatorios);
  if (!existe) throw new AusenciaError('empleado_no_encontrado', 404);

  const empleados = await repo.empleadosConSaldo(db, null, empleadoId);
  // El 404 de arriba certifica que la fila existía y estaba activa en el
  // instante del UPDATE, pero este SELECT es una consulta aparte, sin
  // transacción que las una: entre una y otra, una desactivación concurrente
  // de ese mismo empleado dejaría `empleados` vacío. Sin esta guarda,
  // `combinar([], ...)[0]` sería `undefined` y el 404 correcto degradaría en
  // un 500 al intentar leer `.saldo` aguas arriba.
  if (empleados.length === 0) throw new AusenciaError('empleado_no_encontrado', 404);
  const ausencias = await repo.ausenciasQueTocanElSaldo(db, [empleadoId]);
  return combinar(empleados, ausencias, hoyEnColombia())[0];
}

// ── Calendario ─────────────────────────────────────────────────────────────

/**
 * A quién ve esta sesión en el calendario: `null` es «sin acotar» y un correo es
 * «su rama de dos niveles y él mismo» (ver `repo.alcanceDelCalendario`).
 *
 * ⚠️ Existe una sola vez y la comparten la vista MENSUAL y la ANUAL. No es
 * comodidad: son la misma pantalla con dos formas, y si el alcance se resolviera
 * por separado en cada una, cambiar la regla en una dejaría a la otra
 * contestando lo de antes — sin fallar, y enseñando de más justo en la vista que
 * nadie volvió a revisar.
 *
 * El CORREO de la sesión, no el id de su ficha. Es la misma clave con la que
 * este módulo resuelve todo lo demás —`esAprobadorDeAlguien`,
 * `esVisorDeAdjuntos`, `puedeExportarRegistro`— y la única con la que se puede
 * expresar «mi rama», porque el organigrama son correos (`aprobador_correo`) y
 * no ids.
 *
 * Aquí hubo un `empleadoDeUsuario` + un centinela `ID_INEXISTENTE`. Aquel
 * centinela existía porque `null` significa «sin acotar» en los dos repos y
 * quien no tuviera ficha habría caído en esa rama viendo la plantilla entera.
 * Con el correo ya no hace falta: quien no tenga ficha no casa con ninguna fila
 * y recibe una rejilla vacía, que es justo lo que toca. Y un jefe SIN ficha
 * —que puede darse, porque se es aprobador por figurar en la columna de otro—
 * ve a su equipo en vez de nada.
 */
async function alcanceDeSesion(db: Pool, sesion: Sesion): Promise<string | null> {
  // El mismo `veTodo` que decide en `movimientosVisibles`, y escrito igual a
  // propósito: son las dos caras del mismo permiso, y quien lo tenga tiene que
  // ver la compañía entera en las dos pantallas o en ninguna.
  const veTodo = sesion.esAdmin || (await repo.esVisorDeTodaLaEmpresa(db, sesion.email));
  return veTodo ? null : sesion.email;
}

export interface CalendarioDelMes {
  empleados: repo.EmpleadoActivo[];
  dias: DiaCalendario[];
  marcas: MarcaCalendario[];
}

/**
 * El calendario de un mes, con las marcas ya expandidas por día.
 *
 * El parámetro es un mes y no un rango libre: acotarlo así impide que una
 * petición pida cinco años de golpe, y la interfaz solo navega mes a mes.
 *
 * **Tres alcances, y el del medio es el normal.** Un admin —o quien tenga
 * `ve_toda_la_empresa`, migración 032— ve la plantilla entera. **Un jefe ve su
 * propia fila y la de su rama de dos niveles**, que es exactamente la gente
 * cuyas ausencias firma. Quien no aprueba a nadie sigue viendo solo la suya.
 *
 * El escalón del medio se añadió el 2026-08-21 a petición expresa, y es el que
 * hace útil la pantalla para un jefe: coordinar un equipo exige ver cuándo falta
 * ese equipo. No reabre lo que se cerró en su día —la rejilla no vuelve a
 * enseñar a cualquiera cuándo falta cada compañero—, porque el alcance está
 * atado al organigrama y no al hecho de tener la app.
 *
 * El recorte lo hace el SQL, no un filtro sobre la respuesta: si las marcas
 * ajenas llegaran al navegador ya estarían expuestas, por mucho que no se
 * pinten. Y la definición de «mi rama» NO se reescribe aquí: el repo la comparte
 * con el registro de movimientos y con los saldos (ver `alcanceDelCalendario`).
 *
 * El recorte se hace en el SQL, no filtrando la respuesta: si las marcas ajenas
 * llegaran al navegador ya estarían expuestas, por mucho que no se pinten. Es la
 * misma lección del enmascarado de incapacidades que se retiró en su día.
 *
 * ⚠️ No oculta tanto como parece: n8n sigue publicando cada ausencia aprobada en
 * el Google Calendar «Ambientalia Staff», con el nombre de la persona en el
 * título. Quien tenga ese calendario compartido ve lo mismo por otra vía.
 */
export async function calendarioDelMes(db: Pool, sesion: Sesion, mes: string): Promise<CalendarioDelMes> {
  if (!esMesValido(mes)) throw new AusenciaError('mes_invalido', 400, 'mes');

  const soloDe = await alcanceDeSesion(db, sesion);

  const { desde, hasta } = rangoDelMes(mes);
  const [empleados, ausencias] = await Promise.all([
    repo.empleadosActivos(db, soloDe),
    repo.ausenciasEntre(db, soloDe, desde, hasta),
  ]);

  return {
    empleados,
    dias: diasDelMes(mes),
    marcas: marcasDelMes(mes, ausencias),
  };
}

export interface CalendarioDelAnio {
  empleados: repo.EmpleadoActivo[];
  anio: string;
  /** 365, o 366 si es bisiesto. Es el denominador de todos los anchos. */
  diasDelAnio: number;
  meses: MesDelAnio[];
  franjas: FranjaCalendario[];
}

/**
 * El año entero, para la vista de franjas.
 *
 * Devuelve FRANJAS y no marcas por día, y ahí está el porqué de que exista una
 * función aparte en vez de un parámetro de `calendarioDelMes`: la rejilla
 * mensual rellena celdas y necesita un objeto por día; la anual dibuja barras y
 * necesita uno por ausencia. Expandir el año a días serían ~14.600 objetos en la
 * respuesta y otros tantos nodos en el DOM para pintar unas trescientas barras.
 *
 * **El alcance es EXACTAMENTE el de la vista mensual**, y no por copia: las dos
 * llaman a `alcanceDeSesion`. Un admin o un visor de empresa ven la plantilla
 * entera, un jefe su rama de dos niveles y su propia fila, y el resto solo la
 * suya. Ampliar el rango de un mes a un año no puede ampliar de paso a quién se
 * ve, que es la forma más fácil de convertir una vista nueva en una fuga.
 *
 * El parámetro es un año y no un rango libre, por lo mismo que allí es un mes:
 * acotarlo así impide que una petición pida cinco años de golpe.
 */
export async function calendarioDelAnio(db: Pool, sesion: Sesion, anio: string): Promise<CalendarioDelAnio> {
  if (!esAnioValido(anio)) throw new AusenciaError('anio_invalido', 400, 'anio');

  const soloDe = await alcanceDeSesion(db, sesion);

  const { desde, hasta } = rangoDelAnio(anio);
  const [empleados, ausencias] = await Promise.all([
    repo.empleadosActivos(db, soloDe),
    repo.ausenciasEntre(db, soloDe, desde, hasta),
  ]);

  return {
    empleados,
    anio,
    diasDelAnio: diasDelAnio(anio),
    meses: mesesDelAnio(anio),
    franjas: franjasDelAnio(anio, ausencias),
  };
}

// ── Baja de un empleado ─────────────────────────────────────────────────────

/**
 * Registra la baja de un empleado: fija `fecha_retiro` tras comprobar que
 * nada la contradice. Solo admin.
 *
 * **Bloquea en vez de arreglar por su cuenta.** El saldo que `hoyCongelado`
 * calcula a partir de `fechaRetiro` es literalmente lo que se le paga a esa
 * persona en la liquidación, así que este servicio no puede tomar decisiones
 * sobre ausencias de otro: no cierra solicitudes ajenas ni recorta días para
 * que la fecha "encaje". Si algo choca, se lo dice al admin con el detalle
 * necesario para que lo resuelva a mano (rechazando o retirando la
 * solicitud, cambiando de jefe a quien la tiene a cargo) y vuelva a intentar
 * el retiro. El único que sí escribe es el barrido (`aplicarRetirosVencidos`),
 * que solo APAGA el acceso cuando la fecha ya fijada vence.
 *
 * Los días POSTERIORES a la fecha bloquean; los ANTERIORES no, y no es un
 * descuido: son legítimos. Quien se va el 30 de septiembre puede tener unas
 * vacaciones pendientes de firma para la semana anterior a esa fecha, y su
 * jefe tiene que poder firmarlas con normalidad — la bandeja de aprobación no
 * filtra por `activo`, así que nada se lo impide, y bloquear el retiro por
 * ellas sería inventar un problema donde no lo hay. La frontera exacta entre
 * "antes" y "después" la traza `repo.diasPosterioresA`.
 *
 * **Los dos bloqueos —días posteriores y personas a cargo— se informan
 * JUNTOS, en un solo 409, y nunca el primero que salte.** Cortocircuitar
 * dejaría a quien se topa con los dos enterarse de uno, arreglarlo, reintentar
 * y toparse con el otro. Y esa población no es rara: es el jefe que se va, que
 * tiene equipo por definición y suele tener vacaciones pendientes. Los dos
 * remedios además los ejecutan personas y pantallas distintas —rechazar o
 * retirar la solicitud vs. reasignar el equipo en Organigrama—, así que
 * descubrirlos de uno en uno puede costar días.
 *
 * ⚠️ No es transaccional: entre las dos comprobaciones y `fijarRetiro` puede
 * colarse una solicitud nueva o un cambio de jefe (dos `SELECT` sin `FOR
 * UPDATE`, ni las dos ni la escritura comparten conexión). Se acepta a
 * propósito, mismo criterio que `solapeDe`: el daño es leve porque aquí no se
 * congela nada en columnas —`hoyCongelado` deriva el saldo en cada cálculo, no
 * en el instante del retiro—, así que colarse solo caduca la comprobación de
 * este momento, no corrompe ningún dato, y la baja se puede deshacer con
 * `reactivarEmpleado` si hiciera falta.
 */
export async function retirarEmpleado(
  db: Pool,
  empleadoId: string,
  body: unknown,
  adminEmail: string,
): Promise<Empleado> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const fecha = typeof b.fechaRetiro === 'string' ? b.fechaRetiro.trim() : '';
  // `esFechaValida` y no un parseo laxo: 'YYYY-MM-DD' es el formato con el que
  // esta fecha se compara lexicográficamente contra otras (el barrido, el
  // congelado). Una '30/09/2026' compilaría y rompería esas comparaciones en
  // silencio, que es el gotcha que documenta `sumarDesdeElCorte`.
  if (!esFechaValida(fecha)) throw new AusenciaError('fecha_retiro_invalida', 400, 'fechaRetiro');

  const empleado = await repo.empleadoPorIdIncluyendoInactivos(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404);

  const posteriores = await repo.diasPosterioresA(db, empleadoId, fecha);
  const aCargo = await repo.personasACargoDe(db, empleado.correo);
  if (posteriores.length > 0 || aCargo.length > 0) {
    // Los DOS de una vez, y no el primero que salte: quien se topa con ambos es
    // el jefe que se va —tiene equipo por definicion y suele tener vacaciones
    // pendientes—, y los dos remedios se ejecutan en pantallas distintas. Decirle
    // solo uno le hace descubrir el otro despues de haberlo arreglado.
    throw new AusenciaError('retiro_bloqueado', 409, 'fechaRetiro', {
      solicitudes: posteriores,
      personas: aCargo,
    });
  }

  if (!(await repo.fijarRetiro(db, empleadoId, fecha, adminEmail))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  // Se relee en vez de construir la respuesta a mano: `retirado_at` lo pone la
  // BD con NOW(), así que el único sitio donde está el valor real es la fila.
  const actualizado = await repo.empleadoPorIdIncluyendoInactivos(db, empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Deshace una baja y devuelve la ficha a la lista de activos. Solo admin.
 *
 * `limpiarRetiro` borra `retirado_por`/`retirado_at` en la propia fila —así
 * es como "deshacer" tiene que funcionar, la ficha vuelve a nacer sin
 * retiro—, y eso deja la reactivación sin ningún rastro: la migración 035
 * documenta esas dos columnas como «la constancia de quién fijó ese número»,
 * y borrarlas sin dejar nada en su lugar convertiría a `reactivarEmpleado` en
 * la única operación de esta funcionalidad que BORRA auditoría en vez de
 * crearla. Por eso la ficha se lee ANTES de limpiar —después ya no queda
 * dónde consultar qué fecha tenía ni quién la había puesto— y se deja un
 * evento estructurado con esos datos, mismo patrón que
 * `ausencias_vacaciones_sin_saldo_configurado` más arriba.
 */
export async function reactivarEmpleado(db: Pool, empleadoId: string, adminEmail: string): Promise<Empleado> {
  const antes = await repo.empleadoPorIdIncluyendoInactivos(db, empleadoId);
  if (!antes) throw new AusenciaError('empleado_no_encontrado', 404);

  console.log(
    JSON.stringify({
      event: 'ausencias_baja_deshecha',
      timestamp: new Date().toISOString(),
      empleadoId,
      correo: antes.correo,
      fechaRetiroQueTenia: antes.fechaRetiro,
      retiradoPor: antes.retiradoPor,
      deshechoPor: adminEmail,
    }),
  );

  if (!(await repo.limpiarRetiro(db, empleadoId))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  const actualizado = await repo.empleadoPorIdIncluyendoInactivos(db, empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/** Una ficha retirada, con lo que hace falta para liquidarla. */
export interface Retirado extends SaldoDeEmpleado {
  /** El último día que trabajó. `null` en las fichas apagadas a mano. */
  fechaRetiro: string | null;
  retiradoPor: string | null;
  /** Mientras sea > 0, el saldo de arriba todavía puede moverse. */
  solicitudesVivas: number;
  /**
   * True cuando la fecha de retiro es ANTERIOR al corte del saldo.
   * Aritméticamente da un devengo de cero y no revienta, pero casi siempre
   * significa que alguien se equivocó de año al teclear. Se avisa, no se
   * bloquea: puede ser legítimo, y no es esta pantalla quien debe decidirlo.
   */
  retiroAntesDelCorte: boolean;
}

/**
 * Las fichas retiradas con su saldo ya congelado. Solo admin (lo exige el router).
 *
 * Es la vista de liquidación: el `disponible` de cada fila es el número que se
 * le paga a esa persona. Por eso viaja acompañado de la constancia de quién
 * registró la baja y del recuento de solicitudes vivas — un número sin esas dos
 * cosas al lado se lee como definitivo cuando puede no serlo.
 */
export async function listaDeRetirados(db: Pool): Promise<Retirado[]> {
  const fichas = await repo.retiradosConSaldo(db);
  if (fichas.length === 0) return [];
  const ids = fichas.map((f) => f.empleadoId);
  const ausencias = await repo.ausenciasQueTocanElSaldo(db, ids);
  const vivas = await repo.solicitudesVivasDe(db, ids);
  // `combinar` ya congela ficha a ficha vía `hoyCongelado`: se le pasa el mismo
  // `hoy` a todas y cada una decide el suyo. No hay que congelar nada aquí.
  const conSaldo = combinar(fichas, ausencias, hoyEnColombia());
  // Por `empleadoId` y no por posición: que `combinar` devuelva la lista en el
  // mismo orden que la recibe es cierto hoy, pero es una invariante que no
  // comprueba nadie, y equivocarse de fila aquí le pondría a alguien la fecha
  // de retiro de otro justo en la pantalla desde la que se paga.
  const porId = new Map(fichas.map((f) => [f.empleadoId, f]));
  return conSaldo.map((s) => {
    const ficha = porId.get(s.empleadoId)!;
    return {
      ...s,
      fechaRetiro: ficha.fechaRetiro,
      retiradoPor: ficha.retiradoPor,
      solicitudesVivas: vivas.get(s.empleadoId) ?? 0,
      retiroAntesDelCorte:
        ficha.fechaRetiro !== null && s.saldo.configurado && ficha.fechaRetiro < s.saldo.fechaCorte,
    };
  });
}
