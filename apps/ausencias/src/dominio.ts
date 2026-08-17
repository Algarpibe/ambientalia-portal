import type { ClaseModificacion, EstadoSolicitud, Modificacion, Solicitud, TipoSolicitud } from './api';

/** Los cuatro tipos, en el orden en que se ofrecen en el formulario. */
export const TIPOS: { id: TipoSolicitud; label: string; ayuda: string }[] = [
  { id: 'vacaciones', label: 'Vacaciones', ayuda: 'Requiere aprobación.' },
  { id: 'compensatorio', label: 'Compensatorio', ayuda: 'Requiere aprobación.' },
  { id: 'permiso', label: 'Permiso', ayuda: 'Requiere aprobación. Puedes adjuntar un soporte en PDF.' },
  { id: 'incapacidad', label: 'Incapacidad', ayuda: 'No se aprueba: se informa. El soporte médico en PDF es obligatorio.' },
];

export const ETIQUETA_TIPO: Record<TipoSolicitud, string> = {
  vacaciones: 'Vacaciones',
  permiso: 'Permiso',
  compensatorio: 'Compensatorio',
  incapacidad: 'Incapacidad',
};

/** Solo la incapacidad se informa; el resto pasa por el visto bueno de alguien. */
export const requiereAprobacion = (t: TipoSolicitud) => t !== 'incapacidad';

interface Chip {
  label: string;
  clase: string;
}

/** Las clases van completas y literales: Tailwind purga lo que construya en runtime. */
export const CHIP_ESTADO: Record<EstadoSolicitud, Chip> = {
  pendiente: { label: 'Pendiente', clase: 'bg-amber-100 text-amber-800 border-amber-200' },
  // Naranja y no ámbar para distinguir de un vistazo la media firma de la que
  // todavía no tiene ninguna.
  pendiente_2: { label: 'Pendiente 2ª firma', clase: 'bg-orange-100 text-orange-800 border-orange-200' },
  aprobada: { label: 'Aprobada', clase: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  rechazada: { label: 'Rechazada', clase: 'bg-red-100 text-red-700 border-red-200' },
  registrada: { label: 'Registrada', clase: 'bg-sky-100 text-sky-800 border-sky-200' },
};

const CHIP_DESCONOCIDO = 'bg-gray-100 text-gray-700 border-gray-200';

/**
 * El chip de un estado, con red de seguridad.
 *
 * El acceso directo al Record revienta la tabla entera —y con ella la pestaña—
 * si el backend devuelve un estado que este bundle no conoce. Pasa de verdad:
 * hub-api y el portal son dos servicios de EasyPanel y se despliegan por
 * separado, así que hay una ventana de minutos en que uno va por delante.
 */
export const chipDe = (estado: EstadoSolicitud): Chip =>
  CHIP_ESTADO[estado] ?? { label: estado, clase: CHIP_DESCONOCIDO };

/**
 * Gris y no rojo: anular no es un castigo, es una renuncia. El rojo de
 * «Rechazada» dice «te lo han negado», y aquí lo pidió la propia persona.
 */
const CHIP_ANULADA: Chip = { label: 'Anulada', clase: 'bg-gray-100 text-gray-700 border-gray-200' };

/** El chip ámbar de que hay una propuesta de cambio esperando decisión. */
export const CHIP_CAMBIO_PENDIENTE = 'bg-amber-50 text-amber-800 border-amber-200';

/** Lo mínimo para saber si una `rechazada` es en realidad una anulación. */
type ConAnulacion = Pick<Solicitud, 'estado' | 'anuladaAt'>;

/**
 * Si esta solicitud se anuló a petición de su dueño.
 *
 * Anular deja la fila en `rechazada` —el estado ya hereda la semántica correcta
 * en todos los filtros del servidor—, así que `anuladaAt` es lo único que la
 * separa de un rechazo del jefe. Se lee por veracidad: si hub-api todavía no
 * manda el campo, `undefined` cae en «no anulada» y se sigue leyendo
 * «Rechazada», que es el comportamiento de antes de esta feature.
 */
export const esAnulada = (s: ConAnulacion): boolean => s.estado === 'rechazada' && Boolean(s.anuladaAt);

/**
 * El chip que hay que pintar, contando ya con la anulación.
 *
 * ⚠️ Toda tabla que enseñe el estado debe usar ESTA y no `chipDe(s.estado)`. Una
 * anulada rotulada «Rechazada» no es solo impreciso: el texto que va debajo es
 * el motivo que escribió EL TRABAJADOR al pedirla —el servidor lo guarda ahí a
 * propósito—, así que la pareja «Rechazada» + ese motivo se lee como si el jefe
 * hubiera negado la solicitud dando esa razón.
 */
export function chipDeSolicitud(s: ConAnulacion): Chip {
  return esAnulada(s) ? CHIP_ANULADA : chipDe(s.estado);
}

/**
 * De quién es el texto que va debajo del chip. Es la otra mitad del arreglo de
 * arriba: el campo es el mismo (`motivoRechazo`) y el autor no.
 */
export function etiquetaMotivo(s: ConAnulacion): string {
  return esAnulada(s) ? 'Motivo que dio quien pidió anularla:' : 'Motivo del rechazo:';
}

/** True si la solicitud todavía espera la firma de alguien. */
export const enTramite = (estado: EstadoSolicitud) => estado === 'pendiente' || estado === 'pendiente_2';

/** Lo mínimo para saber de quién es el turno. */
type ConTurno = Pick<Solicitud, 'estado' | 'aprobadorCorreo' | 'segundoAprobadorCorreo'>;

/**
 * True si a `email` le toca firmar esa solicitud **ahora**. Espejo de
 * `correoDelTurno` en `apps/hub-api/src/ausencias/types.ts`.
 *
 * La bandeja NO usa esto: el servidor le manda `esMiTurno` ya calculado, que es
 * donde vive la regla de verdad. Hace falta solo para recalcularlo sobre la fila
 * que devuelve una decisión, porque ese endpoint responde una `Solicitud` a
 * secas. Si algún día cambia la máquina de estados, esta función y la del
 * servidor cambian juntas.
 */
export function esTurnoDe(s: ConTurno, email: string): boolean {
  return (correoDelTurno(s) ?? '').toLowerCase() === email.toLowerCase();
}

/** A quién le toca firmar ahora, o `null` si el estado ya no admite firma. */
export function correoDelTurno(s: ConTurno): string | null {
  if (s.estado === 'pendiente') return s.aprobadorCorreo;
  if (s.estado === 'pendiente_2') return s.segundoAprobadorCorreo;
  return null;
}

/** Etiqueta del campo de fecha según el tipo, como en los formularios de n8n. */
export function etiquetasFecha(tipo: TipoSolicitud): { inicio: string; fin: string } {
  const n: Record<TipoSolicitud, string> = {
    vacaciones: 'de vacaciones',
    permiso: 'de permiso',
    compensatorio: 'de compensatorio',
    incapacidad: 'de incapacidad',
  };
  return { inicio: `Fecha primer día ${n[tipo]}`, fin: `Fecha último día ${n[tipo]}` };
}

/**
 * Días hábiles entre dos fechas, con la MISMA regla que el servidor
 * (apps/hub-api/src/ausencias/dias-habiles.ts): ambas incluidas, sin sábados,
 * domingos ni festivos. Aquí es solo para el contador en vivo del formulario —
 * el valor que se guarda lo recalcula siempre el servidor.
 *
 * Toda la aritmética es en UTC sobre cadenas: el navegador del usuario está en
 * UTC−5 y `new Date('2026-07-06')` se interpreta como medianoche UTC, así que
 * mezclar métodos locales y UTC desplaza un día.
 */
export function contarDiasHabiles(desde: string, hasta: string, festivos: Set<string>): number {
  if (!desde || !hasta || desde > hasta) return 0;
  let dias = 0;
  let ms = Date.parse(`${desde}T00:00:00Z`);
  const fin = Date.parse(`${hasta}T00:00:00Z`);
  // Cortafuegos: si alguien teclea un año de más, no bloqueamos la pestaña.
  if ((fin - ms) / 86_400_000 > 366) return 0;
  while (ms <= fin) {
    const d = new Date(ms);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !festivos.has(d.toISOString().slice(0, 10))) dias++;
    ms += 86_400_000;
  }
  return dias;
}

/**
 * La fecha de hoy en Colombia (UTC−5, sin horario de verano). Espejo de
 * `hoyEnColombia` en `apps/hub-api/src/ausencias/saldo.ts`.
 *
 * No vale `new Date().toISOString().slice(0, 10)` ni los métodos locales del
 * navegador: el servidor valida contra la hora de Colombia, así que si el
 * formulario se guiara por la zona del equipo, alguien fuera del país vería
 * habilitado un día que el servidor va a rechazar —o bloqueado uno que aceptaría.
 * Se resta el desfase ANTES de tomar la fecha, por lo mismo que en el servidor.
 */
export function hoyEnColombia(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** Un decimal, y sin el «,0» cuando es entero. El formato de los días en toda la app. */
export function formatDias(n: number): string {
  return n.toLocaleString('es-CO', { maximumFractionDigits: 1 });
}

/** «6 jul 2026» — más corto que la fecha ISO y menos ambiguo que 06/07/2026. */
export function formatFecha(iso: string): string {
  if (!iso) return '';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Un instante (un `timestamptz` de la BD, como `decididaAt`) en hora de Colombia.
 *
 * No vale `formatFecha`: espera `YYYY-MM-DD` y le concatena `T00:00:00Z`, así que
 * con un timestamp completo devuelve «Invalid Date». Y tampoco vale cortar los
 * diez primeros caracteres, que es lo que primero se piensa: el servidor guarda
 * en UTC y Colombia es UTC−5, de modo que una decisión tomada a las 20:00 en
 * Bogotá se vería fechada al día siguiente.
 */
export function formatInstante(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Bogota',
  });
}

// ── Modificación de una solicitud ya enviada ───────────────────────────────

/**
 * Espejo de `ESTADOS_MODIFICABLES` en `apps/hub-api/src/ausencias/service.ts`.
 *
 * `rechazada` queda fuera porque los días nunca se concedieron —lo que su dueño
 * quiere es volver a pedirlos, y para eso está el formulario— y `registrada`
 * porque una incapacidad se informa, no se concede: no hay a quién mandarle la
 * petición.
 */
const ESTADOS_MODIFICABLES: readonly EstadoSolicitud[] = ['pendiente', 'pendiente_2', 'aprobada'];

/** Lo mínimo de una solicitud para saber si admite una enmienda. */
type Enmendable = Pick<
  Solicitud,
  'estado' | 'fechaInicio' | 'fechaFin' | 'aprobadorCorreo' | 'segundoAprobadorCorreo'
>;

/**
 * Quién decidiría el cambio. Espejo de `decisorDeModificacion` en
 * `apps/hub-api/src/ausencias/types.ts`.
 *
 * Sale de la propia solicitud y NUNCA del organigrama de hoy: en trámite decide
 * quien tiene el turno, y ya cerrada el jefe inmediato que la firmó. `null`
 * —una incapacidad, o una fila del histórico sin aprobador— significa que no
 * admite modificación, y es la comprobación que de verdad cierra esos casos.
 */
export function decisorDeModificacion(s: ConTurno): string | null {
  return correoDelTurno(s) ?? s.aprobadorCorreo;
}

/**
 * Si el dueño puede pedir que le cambien las FECHAS. Espejo de
 * `puedePedirModificacion` en `service.ts`.
 *
 * Se mira `fechaFin` y no `fechaInicio` a propósito: una ausencia en curso es
 * justo el caso donde «córtala, tengo que volver» es legítimo; una ya terminada
 * es corrección de nómina, no una aprobación que nadie pueda ya conceder.
 *
 * Existe aquí solo para decidir si se enseña el botón. La regla de verdad vive
 * en el servidor y él la vuelve a comprobar; si las dos divergieran, lo peor que
 * pasa es un 409 al pulsar, nunca un cambio que no debía poder pedirse.
 */
export function puedePedirModificacion(s: Enmendable, hoy: string): boolean {
  return ESTADOS_MODIFICABLES.includes(s.estado) && decisorDeModificacion(s) !== null && s.fechaFin >= hoy;
}

/**
 * Si además puede pedir ANULARLA. Espejo de `puedePedirAnulacion` en
 * `service.ts`, y estrictamente más exigente que la de arriba.
 *
 * Anular exige que la ausencia no haya empezado (`fechaInicio >= hoy`) porque
 * deja la solicitud en `rechazada`, y una `rechazada` devuelve TODOS sus días y
 * desaparece del calendario: sobre unas vacaciones del 6 al 10 anuladas el día
 * 8, eso regalaría los tres días ya disfrutados sin que nada falle ni nadie se
 * entere. Para ese caso la herramienta es acortar las fechas, que recalcula los
 * días y deja el saldo correcto — y por eso el aviso de la interfaz lo dice.
 */
export function puedePedirAnulacion(s: Enmendable, hoy: string): boolean {
  return puedePedirModificacion(s, hoy) && s.fechaInicio >= hoy;
}

/**
 * Espejo de `MAX_DIAS_RANGO` (`apps/hub-api/src/ausencias/dias-habiles.ts`): el
 * servidor contesta 400 por encima de un año natural.
 *
 * Aquí no es solo cortesía. El cortafuegos de `contarDiasHabiles` devuelve **0**
 * sin avisar en cuanto el rango se pasa de largo, así que sin esta comprobación
 * el resumen del cambio diría «quedaría en 0 días hábiles · devuelves los 5»
 * sobre una fecha mal tecleada, que es exactamente al revés de lo que pasaría.
 */
export function excedeRangoMaximo(inicio: string, fin: string): boolean {
  if (!inicio || !fin || inicio > fin) return false;
  const naturales = (Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000 + 1;
  return naturales > 366;
}

/** «6 jul 2026 – 10 jul 2026», y un solo día no se repite. */
export function rangoFechas(inicio: string, fin: string): string {
  return inicio === fin ? formatFecha(inicio) : `${formatFecha(inicio)} – ${formatFecha(fin)}`;
}

/** «6 jul 2026 – 10 jul 2026 · 5 días hábiles». */
function rangoConDias(inicio: string, fin: string, dias: number): string {
  return `${rangoFechas(inicio, fin)} · ${formatDias(dias)} ${dias === 1 ? 'día hábil' : 'días hábiles'}`;
}

/**
 * Qué le pasa al recuento de días, en una frase.
 *
 * Se distingue por tipo porque «devuelves días» solo es cierto en vacaciones:
 * son las únicas que consumen saldo. Decírselo a quien acorta un permiso sería
 * prometerle unos días que no existen.
 *
 * `delta > 0` = la solicitud encoge (se liberan días); `< 0` = crece.
 */
function efectoEnDias(tipo: TipoSolicitud, delta: number): string {
  if (delta === 0) return 'Los mismos días, en otras fechas.';
  const n = `${formatDias(Math.abs(delta))} ${Math.abs(delta) === 1 ? 'día' : 'días'}`;
  if (tipo === 'vacaciones') return delta > 0 ? `Devuelves ${n} a tu saldo.` : `Pides ${n} más de tu saldo.`;
  return delta > 0 ? `Son ${n} menos.` : `Son ${n} más.`;
}

/** El antes y el después de lo que se va a pedir, ya redactados. */
export interface ResumenCambio {
  /** Cómo está la solicitud ahora mismo. */
  ahora: string;
  /** Cómo quedaría. `null` al anular: no queda nada. */
  quedaria: string | null;
  /** Días que se liberan (positivo) o que se piden de más (negativo). */
  deltaDias: number;
  /** El efecto sobre el recuento, en una frase cerrada con punto. */
  efecto: string;
}

/**
 * El antes/después de un cambio antes de pedirlo.
 *
 * Función pura y aparte del modal porque es lo que evita el malentendido caro de
 * toda la feature: sin un «ahora» y un «quedaría» explícitos, quien acorta unas
 * vacaciones no ve cuántos días recupera, y quien las alarga no ve que está
 * pidiendo más de los que tiene.
 *
 * Los días nuevos se cuentan aquí con la misma regla que el servidor
 * (`contarDiasHabiles`), pero el valor que se guarda lo recalcula siempre él.
 * Quien la llame debe comprobar antes que el rango sea válido: con una fecha a
 * medio teclear, el conteo da 0 y el resumen diría que se devuelven todos.
 */
export function resumenCambio(
  s: Pick<Solicitud, 'tipo' | 'fechaInicio' | 'fechaFin' | 'diasHabiles'>,
  propuesta: { clase: ClaseModificacion; fechaInicio: string; fechaFin: string },
  festivos: Set<string>,
): ResumenCambio {
  const ahora = rangoConDias(s.fechaInicio, s.fechaFin, s.diasHabiles);
  if (propuesta.clase === 'anulacion') {
    return { ahora, quedaria: null, deltaDias: s.diasHabiles, efecto: efectoEnDias(s.tipo, s.diasHabiles) };
  }
  const dias = contarDiasHabiles(propuesta.fechaInicio, propuesta.fechaFin, festivos);
  const delta = s.diasHabiles - dias;
  return {
    ahora,
    quedaria: rangoConDias(propuesta.fechaInicio, propuesta.fechaFin, dias),
    deltaDias: delta,
    efecto: efectoEnDias(s.tipo, delta),
  };
}

/**
 * Qué pide una propuesta ya enviada, en una línea.
 *
 * En tercera persona («Pide…») y no en segunda: el mismo texto se lee en «Mis
 * solicitudes», en la bandeja del jefe, en su historial y en el Registro
 * general, y un «Pediste» sería falso en tres de las cuatro.
 */
export function resumenPropuesta(m: Modificacion): string {
  if (m.clase === 'anulacion') return 'Pide anular la solicitud.';
  // Los tres campos van juntos —o los tres con valor, o los tres nulos—, pero se
  // comprueban igual: interpolar un null a pelo es cómo se acaba enseñando
  // «Pide cambiar a null – null», que fue exactamente el fallo del flujo viejo
  // escribiendo «undefined» en el buzón de alguien.
  if (!m.fechaInicioNueva || !m.fechaFinNueva) return 'Pide cambiar las fechas.';
  const rango = rangoFechas(m.fechaInicioNueva, m.fechaFinNueva);
  if (typeof m.diasHabilesNuevos !== 'number') return `Pide cambiar las fechas a ${rango}.`;
  return `Pide cambiar las fechas a ${rangoConDias(m.fechaInicioNueva, m.fechaFinNueva, m.diasHabilesNuevos)}.`;
}

/**
 * Los códigos de error de hub-api, en español.
 *
 * `mensajeDeError` (@suite/http) devuelve para 400 y 409 el campo `error` del
 * cuerpo tal cual, que es un código como `anulacion_ya_empezada`. En el resto de
 * la app eso se enseña crudo; aquí no vale, porque estos 409 son justo lo que se
 * lleva la ventana de despliegue en que el portal va por delante de hub-api: si
 * un botón se ofrece cuando el servidor ya no lo admite, lo que la persona lee
 * al pulsarlo es lo único que le queda.
 *
 * Un código desconocido pasa tal cual: es peor esconderlo que enseñarlo feo.
 */
const MENSAJE_MODIFICACION: Record<string, string> = {
  ya_hay_modificacion_pendiente: 'Ya tienes una petición pendiente sobre esta solicitud. Retírala antes de pedir otra.',
  solicitud_cambio_de_estado: 'La solicitud cambió mientras rellenabas esto. Ciérralo y vuelve a mirarla.',
  estado_no_admite_modificacion: 'Esta solicitud ya no admite cambios.',
  solicitud_ya_pasada: 'Esa ausencia ya terminó. Para corregirla, habla con administración.',
  anulacion_ya_empezada: 'Esa ausencia ya empezó y no se puede anular. Lo que sí puedes es acortar las fechas.',
  ya_retirada: 'Esa petición ya estaba retirada.',
  ya_decidida: 'Tu jefe ya decidió esa petición. Vuelve a cargar la página para ver el resultado.',
  sin_cambios: 'Las fechas que propones son las que la solicitud ya tiene.',
  fecha_en_pasado: 'No puedes mover la ausencia hacia atrás: las fechas nuevas no pueden empezar antes de hoy.',
  anulacion_con_fechas: 'No se pueden mandar fechas al pedir una anulación.',
  no_es_su_solicitud: 'Esa solicitud no es tuya.',
  no_es_su_modificacion: 'Esa petición no es tuya.',
  no_encontrada: 'Esa petición ya no existe. Vuelve a cargar la página.',
  motivo_demasiado_largo: 'El motivo es demasiado largo. Resúmelo un poco.',
};

/** Traduce el código de hub-api a algo legible; si no lo conoce, lo deja pasar. */
export const mensajeDeModificacion = (mensaje: string): string => MENSAJE_MODIFICACION[mensaje] ?? mensaje;
