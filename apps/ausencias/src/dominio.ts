import type {
  ClaseModificacion,
  EstadoSolicitud,
  Modificacion,
  Solicitud,
  SolicitudConPropuesta,
  SolicitudPendiente,
  TipoSolicitud,
} from './api';

/** Los cinco tipos, en el orden en que se ofrecen en el formulario. */
export const TIPOS: { id: TipoSolicitud; label: string; ayuda: string }[] = [
  { id: 'vacaciones', label: 'Vacaciones', ayuda: 'Requiere aprobación.' },
  {
    id: 'compensatorio',
    label: 'Compensatorio',
    ayuda: 'Requiere aprobación. Descuenta de tu bolsa de compensatorios.',
  },
  {
    id: 'otorgamiento',
    label: 'Pedir compensatorios',
    ayuda: 'Trabajaste un día extra y pides que te lo compensen. Si tu jefe lo aprueba, esos días entran en tu bolsa.',
  },
  { id: 'permiso', label: 'Permiso', ayuda: 'Requiere aprobación. Puedes adjuntar un soporte en PDF.' },
  { id: 'incapacidad', label: 'Incapacidad', ayuda: 'No se aprueba: se informa. El soporte médico en PDF es obligatorio.' },
];

export const ETIQUETA_TIPO: Record<TipoSolicitud, string> = {
  vacaciones: 'Vacaciones',
  permiso: 'Permiso',
  compensatorio: 'Compensatorio',
  incapacidad: 'Incapacidad',
  otorgamiento: 'Compensatorio concedido',
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
    otorgamiento: 'de trabajo extra',
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

/**
 * Qué tipos descuentan de una bolsa. En un solo sitio porque cada vez que se
 * responde a mano —«¿enseño el saldo aquí?», «¿digo que devuelve días?»— la
 * respuesta se puede desviar sin que nada avise.
 *
 * `permiso` e `incapacidad` no consumen nada: se piden y ya.
 */
export function consumeSaldo(tipo: TipoSolicitud): boolean {
  return tipo === 'vacaciones' || tipo === 'compensatorio';
}

/**
 * El único tipo que NO es una ausencia. Espejo de `esOtorgamiento` en
 * `apps/hub-api/src/ausencias/types.ts`.
 *
 * Los otros cuatro dicen «no voy a estar»; éste dice «trabajé el sábado,
 * concédeme un día». Sus columnas se leen distinto —`diasHabiles` son días
 * CONCEDIDOS y `fechaInicio` es el día del trabajo extra, en el pasado— y de ahí
 * salen todas las ramas de la interfaz. En un predicado y no en comparaciones
 * sueltas porque son nueve pantallas: cada una que se responda a mano se puede
 * desviar sin que nada avise.
 */
export function esOtorgamiento(tipo: TipoSolicitud): boolean {
  return tipo === 'otorgamiento';
}

/**
 * Lo que se puede pedir sin descubrirse. Espejo de `pedible` en
 * `apps/hub-api/src/ausencias/saldo.ts`.
 *
 * Redondea, y tiene que redondear IGUAL que el servidor. `disponible − enTramite`
 * sobre floats da cosas como 3.9000000000000004; sin redondear, el formulario y
 * el backend discreparían justo en el borde en el que la pantalla dice «te falta
 * 0» — uno dejaría enviar y el otro rechazaría.
 *
 * Toma la forma y no el tipo, así que sirve para las dos bolsas.
 */
export function pedible(saldo: { disponible: number; enTramite: number }): number {
  return Math.round((saldo.disponible - saldo.enTramite) * 10) / 10;
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
  'tipo' | 'estado' | 'fechaInicio' | 'fechaFin' | 'aprobadorCorreo' | 'segundoAprobadorCorreo'
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
  // Un otorgamiento no caduca: su fecha es la del día que se TRABAJÓ y está en el
  // pasado siempre, así que la regla de las ausencias lo dejaría fuera SIEMPRE —
  // ni siquiera se podría anular. Lo que le da o le quita vigencia es su estado.
  // Espejo de `sigueVigente` en el servidor.
  const vigente = esOtorgamiento(s.tipo) || s.fechaFin >= hoy;
  return ESTADOS_MODIFICABLES.includes(s.estado) && decisorDeModificacion(s) !== null && vigente;
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
 *
 * ⚠️ `>=` y no `>`: una ausencia que EMPIEZA HOY sí se puede anular. Un día solo
 * queda consumido al terminar, y cancelar la mañana del primer día es un caso
 * real y frecuente. Con `>` se bloquearía el caso legítimo y además esa persona
 * se quedaría sin salida: una ausencia que empieza hoy no se puede «acortar» a
 * menos de un día. **No cambiar a `>` sin releer esto** —«ya empezó» suena a `>`
 * a quien lo lea rápido—, y no cambiarlo nunca sin cambiar a la vez
 * `noHaEmpezado` en `apps/hub-api/src/ausencias/service.ts`, que es la regla de
 * verdad.
 */
export function puedePedirAnulacion(s: Enmendable, hoy: string): boolean {
  // Un otorgamiento no «empieza»: no hay días fuera consumiéndose. Anularlo quita
  // los días concedidos, y si ya se gastaron la bolsa queda en negativo — que es
  // lo decidido. Espejo de `noHaEmpezado` en el servidor.
  return puedePedirModificacion(s, hoy) && (esOtorgamiento(s.tipo) || s.fechaInicio >= hoy);
}

/**
 * La fecha de inicio más temprana que el servidor aceptaría en una propuesta.
 * Vale tal cual para el `min` de un `input type="date"`.
 *
 * Espejo de la regla `fecha_en_pasado` de `validarNuevaModificacion`, que
 * rechaza un inicio que esté **a la vez** en el pasado Y antes del que la
 * solicitud ya tiene. Lo que sí acepta es, por tanto,
 * `inicio >= hoy || inicio >= actual`, cuya unión es «desde el menor de los
 * dos» — y eso es lo que devuelve esta función.
 *
 * La regla del formulario de alta («nada antes de hoy») NO vale aquí: recortar
 * una ausencia YA EMPEZADA obliga a proponer un inicio que está en el pasado —el
 * suyo—, que es justo el caso para el que existe esta pantalla. Lo que no puede
 * es RETROCEDER: mover a enero unos días de julio todavía sin disfrutar
 * reservaría días ya pasados y movería saldo de un año a otro.
 */
export function minimoInicioPropuesto(s: Pick<Solicitud, 'fechaInicio'>, hoy: string): string {
  return s.fechaInicio < hoy ? s.fechaInicio : hoy;
}

/** True si la fecha propuesta retrocede más allá de lo que el servidor admite. */
export function retrocedeAlPasado(s: Pick<Solicitud, 'fechaInicio'>, inicio: string, hoy: string): boolean {
  return Boolean(inicio) && inicio < minimoInicioPropuesto(s, hoy);
}

/**
 * Espejo de `sin_cambios`: pedir exactamente lo que ya se tiene no es un cambio.
 * Sin esto, el jefe recibiría un correo pidiéndole que apruebe dejarlo todo
 * igual — y el servidor contesta 400 antes de llegar ahí.
 */
export function sinCambiosDeFechas(
  s: Pick<Solicitud, 'fechaInicio' | 'fechaFin'>,
  inicio: string,
  fin: string,
): boolean {
  return inicio === s.fechaInicio && fin === s.fechaFin;
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
 * Se distingue por tipo porque «devuelves días» solo es cierto en los tipos que
 * consumen bolsa: vacaciones y compensatorios. Decírselo a quien acorta un
 * permiso o una incapacidad sería prometerle unos días que no existen.
 *
 * `delta > 0` = la solicitud encoge (se liberan días); `< 0` = crece.
 */
function efectoEnDias(tipo: TipoSolicitud, delta: number): string {
  if (delta === 0) return 'Los mismos días, en otras fechas.';
  const n = `${formatDias(Math.abs(delta))} ${Math.abs(delta) === 1 ? 'día' : 'días'}`;
  if (consumeSaldo(tipo)) return delta > 0 ? `Devuelves ${n} a tu saldo.` : `Pides ${n} más de tu saldo.`;
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
    return {
      ahora,
      quedaria: null,
      deltaDias: s.diasHabiles,
      // Un rango sin días hábiles se puede pedir: `crearSolicitud` cuenta los
      // días pero no rechaza el cero, así que un sábado–domingo queda
      // `pendiente` con `diasHabiles = 0`. Al anularlo, un delta de 0 caería en
      // «Los mismos días, en otras fechas», que contradice de plano el
      // «Quedaría: nada reservado» que el panel pinta justo encima.
      efecto: s.diasHabiles > 0 ? efectoEnDias(s.tipo, s.diasHabiles) : 'La solicitud dejaría de existir.',
    };
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
 * En tercera persona («Pide…») y no en segunda. Como texto visible solo aparece
 * en «Mis solicitudes», donde un «Pediste» sería correcto; pero es además el
 * `title` del chip «Cambio pendiente», y ese chip lo pintan también la bandeja,
 * los soportes adjuntos y el Registro general, donde quien lee no es quien
 * pidió nada.
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
 * Qué le pasa al recuento si el jefe aprueba, en una frase y en TERCERA persona.
 *
 * Gemela de `efectoEnDias`, que dice lo mismo al trabajador («devuelves») y no
 * vale aquí: quien lee esto no es quien pidió nada. Se mantiene la misma
 * distinción por tipo, porque «le devuelve días» solo es cierto en vacaciones —
 * son las únicas que consumen saldo.
 *
 * `delta > 0` = la solicitud encoge (se liberan días); `< 0` = crece.
 */
function efectoParaElDecisor(tipo: TipoSolicitud, delta: number): string {
  if (delta === 0) return 'Los mismos días, en otras fechas.';
  const n = `${formatDias(Math.abs(delta))} ${Math.abs(delta) === 1 ? 'día' : 'días'}`;
  if (tipo === 'vacaciones') {
    return delta > 0 ? `Aprobarlo le devuelve ${n} a su saldo.` : `Aprobarlo le descuenta ${n} más de su saldo.`;
  }
  return delta > 0 ? `Aprobarlo son ${n} de ausencia menos.` : `Aprobarlo son ${n} de ausencia más.`;
}

/** El antes y el después de una propuesta ya enviada, como lo lee quien decide. */
export interface VistaPropuesta {
  /** Si lo que se pide es anular. Quien pinte esto tiene que poder decirlo. */
  anula: boolean;
  /** Cómo estaba la solicitud cuando se pidió el cambio. */
  ahora: string;
  /** Cómo quedaría si la aprueba, ya redactado. Al anular, que no queda nada. */
  quedaria: string;
  /**
   * Días que se liberan (positivo) o que se piden de más (negativo). **Mismo
   * signo que `ResumenCambio.deltaDias`**: dos convenios opuestos en el mismo
   * fichero serían una trampa para quien lea uno y use el otro.
   */
  deltaDias: number;
  /**
   * Los días que esta propuesta pediría DE MÁS, y 0 si no pide ninguno.
   *
   * Existe para `TarjetaSaldo`, que es lo único que sabe hacer con un número
   * así: avisar de que no caben. Su aviso está guardado con `diasPedidos > 0`,
   * de modo que pasarle el delta a pelo funciona por casualidad en un sentido
   * (pedir de más) y calla en el otro (devolver días) sin romper nada ni decir
   * nada. Se calcula aquí y no en el JSX porque es una decisión de dominio —qué
   * número significa «esto puede descubrirle el saldo»—, no de pintado.
   */
  diasDeMas: number;
  /** El efecto sobre el recuento, en una frase cerrada con punto. */
  efecto: string;
}

/**
 * Lo que el jefe necesita leer de una propuesta antes de decidirla.
 *
 * Hermana de `resumenCambio`, que resume lo que se va a PEDIR (y cuenta los días
 * nuevos en el navegador porque todavía no existen). Aquí la propuesta ya está
 * guardada, así que los dos recuentos vienen del servidor y no se recalcula
 * ninguno: contarlos otra vez aquí solo abriría la puerta a que la bandeja
 * enseñara un número y el servidor aplicara otro.
 *
 * El «ahora» sale de la FOTO (`*Previos`) y no de la solicitud que se tenga
 * pintada, por lo mismo que la foto existe: es el estado contra el que el
 * servidor va a comparar su testigo de tres campos, así que es el único antes
 * que describe lo que de verdad va a pasar al aprobar. Si la solicitud se movió
 * por debajo, eso lo dice `propuestaDesfasada` — no se disimula cambiando el
 * antes.
 */
export function vistaDePropuesta(s: Pick<Solicitud, 'tipo'>, m: Modificacion): VistaPropuesta {
  const ahora = rangoConDias(m.fechaInicioPrevia, m.fechaFinPrevia, m.diasHabilesPrevios);
  // Ninguna de las tres frases de `quedaria` lleva punto final: la de arriba
  // («Ahora: …») tampoco lo lleva, y una sí y otra no se lee como una errata.
  if (m.clase === 'anulacion') {
    return {
      anula: true,
      ahora,
      quedaria: 'nada reservado, la ausencia desaparece del calendario',
      deltaDias: m.diasHabilesPrevios,
      // Anular siempre libera días, nunca pide de más.
      diasDeMas: 0,
      // Misma salvedad que en `resumenCambio`: un rango sin días hábiles (un
      // sábado–domingo) se puede pedir y se puede anular, y ahí un delta de 0
      // caería en «Los mismos días, en otras fechas», que contradice de plano
      // el «quedaría nada reservado» de la línea de encima.
      efecto:
        m.diasHabilesPrevios > 0
          ? efectoParaElDecisor(s.tipo, m.diasHabilesPrevios)
          : 'La solicitud dejaría de existir.',
    };
  }
  // Los tres campos nuevos van juntos —o los tres con valor, o los tres nulos, y
  // lo garantiza un CHECK en la BD—, pero se comprueban igual: interpolar un
  // null a pelo es cómo se acaba enseñando «Quedaría: null – null» a quien tiene
  // que decidir a partir de eso.
  if (!m.fechaInicioNueva || !m.fechaFinNueva) {
    return {
      anula: false,
      ahora,
      quedaria: 'no se puede leer qué fechas se piden',
      deltaDias: 0,
      diasDeMas: 0,
      efecto: 'Pídele que retire la petición y la vuelva a mandar.',
    };
  }
  // Sin recuento no hay delta que enseñar, y un 0 inventado diría «los mismos
  // días» sobre unas fechas que pueden ser muchas más.
  if (typeof m.diasHabilesNuevos !== 'number') {
    return {
      anula: false,
      ahora,
      quedaria: rangoFechas(m.fechaInicioNueva, m.fechaFinNueva),
      deltaDias: 0,
      diasDeMas: 0,
      efecto: 'Se piden otras fechas.',
    };
  }
  const delta = m.diasHabilesPrevios - m.diasHabilesNuevos;
  return {
    anula: false,
    ahora,
    quedaria: rangoConDias(m.fechaInicioNueva, m.fechaFinNueva, m.diasHabilesNuevos),
    deltaDias: delta,
    diasDeMas: Math.max(0, -delta),
    efecto: efectoParaElDecisor(s.tipo, delta),
  };
}

/**
 * True si la solicitud se movió por debajo desde que se pidió el cambio.
 *
 * Espejo exacto de `TESTIGO_SOLICITUD` (`repo.ts`), los MISMOS tres campos: si
 * alguno no casa, aprobar responde 409 (`solicitud_cambio_de_estado`) y no
 * aplica nada. Enseñarlo antes evita que el jefe decida leyendo un «antes» que
 * ya no es el de la fila que tiene delante —y que pulse un botón que solo puede
 * fallar.
 *
 * Pasa de verdad: el `PATCH` de admin corrige fechas sin encolar nada, así que
 * nadie se entera de que la foto envejeció.
 */
export function propuestaDesfasada(
  s: Pick<Solicitud, 'estado' | 'fechaInicio' | 'fechaFin'>,
  m: Modificacion,
): boolean {
  return (
    s.estado !== m.estadoPrevio ||
    s.fechaInicio !== m.fechaInicioPrevia ||
    s.fechaFin !== m.fechaFinPrevia
  );
}

// ── Lo que le falta por atender a quien aprueba ────────────────────────────
//
// Dos sitios enseñan este número —el rótulo de la pestaña «Pendientes de
// aprobar (N)» y el widget del Dashboard— y tienen que decir lo mismo. Los dos
// filtros viven aquí, en una sola definición, porque la última vez que cada uno
// contaba por su cuenta divergían: la pestaña las contaba todas y el widget solo
// las de su turno, de modo que la raíz del organigrama —que es su propio jefe,
// recibe su propio cambio y no puede autoaprobárselo— leía «(1)» en la pestaña y
// «Nada pendiente» en el Dashboard.

/**
 * Si a quien mira le toca firmar ESTA solicitud.
 *
 * `!== false` y no `=== true`: hub-api y el portal se despliegan por separado y
 * hay una ventana en que el campo llega `undefined`. Así degrada a «cuéntalas
 * todas» —el comportamiento anterior, con un número inflado que se ve y se
 * corrige solo— en vez de a 0, que diría «nada pendiente» mientras las
 * solicitudes se pudren, y eso no lo nota nadie.
 */
export const meTocaFirmar = (s: Pick<SolicitudPendiente, 'esMiTurno'>): boolean => s.esMiTurno !== false;

/** Si a quien mira le toca decidir ESTE cambio. Mismo criterio y mismo porqué. */
export const meTocaDecidir = (c: Pick<SolicitudConPropuesta, 'puedoDecidirla'>): boolean =>
  c.puedoDecidirla !== false;

/** Lo que espera una decisión de quien mira, ya desglosado. */
export interface PorAtender {
  /** Solicitudes que esperan su firma. */
  solicitudes: number;
  /** Cambios pedidos que le toca decidir a él. */
  cambios: number;
  /** La suma: el número del rótulo de la pestaña y el grande del widget. */
  total: number;
}

/**
 * ⚠️ Cuenta DECISIONES, no filas de tabla. La bandeja enseña además las que solo
 * puede destrabar (un admin) y el cambio de quien no puede decidir el suyo, así
 * que el «(5)» del título de una sección y este total pueden no coincidir a
 * propósito: uno dice cuántas filas hay y el otro cuántas esperan a esta
 * persona.
 */
export function contarPorAtender(
  pendientes: Pick<SolicitudPendiente, 'esMiTurno'>[],
  cambios: Pick<SolicitudConPropuesta, 'puedoDecidirla'>[],
): PorAtender {
  const solicitudes = pendientes.filter(meTocaFirmar).length;
  const mios = cambios.filter(meTocaDecidir).length;
  return { solicitudes, cambios: mios, total: solicitudes + mios };
}

/**
 * Por qué una fila de «Cambios pedidos» lleva los botones apagados.
 *
 * ⚠️ **No decide nada.** Quién puede decidir lo dice `puedoDecidirla`, que llega
 * del servidor calculado con el MISMO guard que el endpoint de decisión; esta
 * función solo REDACTA el porqué de un `false` que ya viene dado. Por eso puede
 * permitirse mirar los correos: si la regla del servidor cambiara, lo peor que
 * pasaría es un texto impreciso bajo unos botones que siguen apagados — nunca un
 * botón de más.
 *
 * El primer caso es hoy el único que ocurre de verdad, y no es raro: la raíz del
 * organigrama es su propio jefe, así que sobre sus propias solicitudes el
 * decisor congelado es ella misma y el guard del solicitante la frena. Se le
 * dice además dónde SÍ puede actuar, que si no la fila es un callejón sin
 * salida. El segundo texto es la red para el día que la regla se amplíe.
 */
export function motivoNoDecidible(
  s: Pick<Solicitud, 'solicitanteEmail'>,
  m: Pick<Modificacion, 'aprobadorCorreo'>,
  email: string,
): string {
  if (s.solicitanteEmail.toLowerCase() === email.toLowerCase()) {
    return 'Es tu propia solicitud, así que este cambio no lo decides tú. Si te has echado atrás, puedes retirarlo desde «Mis solicitudes».';
  }
  return `Este cambio lo decide ${m.aprobadorCorreo}.`;
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
 *
 * ⚠️ **Solo 400 y 409.** Para 401, 403 y 404, `mensajeDeError` devuelve un texto
 * fijo suyo y nunca mira el cuerpo, así que una clave para un código de esos
 * —`no_es_su_solicitud` (403), `no_encontrada` (404)— no puede emparejar jamás y
 * lo único que hace es prometer una traducción que no ocurre. Antes había tres
 * aquí. Si algún día hace falta traducir un 403, hay que arreglarlo en
 * `packages/http`, que es donde se pierde el código.
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
  // Lo tapa `excedeRangoMaximo` antes de llegar al servidor, así que este 400
  // solo aparece si los dos topes divergen — que es justo para lo que existe
  // este mapa.
  rango_demasiado_largo: 'El rango no puede pasar de un año. Revisa las fechas.',
  motivo_demasiado_largo: 'El motivo es demasiado largo. Resúmelo un poco.',
};

/** Traduce el código de hub-api a algo legible; si no lo conoce, lo deja pasar. */
export const mensajeDeModificacion = (mensaje: string): string => MENSAJE_MODIFICACION[mensaje] ?? mensaje;

/**
 * Los tipos que de verdad se pintan en el calendario.
 *
 * Deja fuera al otorgamiento, que no es una ausencia y que el servidor ni
 * siquiera manda (`ausenciasEntre` lo excluye en el SQL). Ofrecerlo como filtro
 * o en la leyenda sería prometer un color que no va a aparecer nunca, y quien lo
 * eligiera vería el mes entero en blanco sin entender por qué.
 */
export const TIPOS_DE_AUSENCIA = TIPOS.filter((t) => !esOtorgamiento(t.id));

/** Lo mínimo para pintar una fila en cualquiera de las dos tablas. */
type ParaLaTabla = Pick<Solicitud, 'tipo' | 'fechaInicio' | 'fechaFin' | 'diasHabiles'>;

/**
 * La celda «Días», con su signo cuando lo tiene.
 *
 * Las nueve pantallas que pintan `diasHabiles` lo hacen bajo una cabecera fija
 * que dice «Días», y en ocho de ellas eso significa «días fuera». En un
 * otorgamiento significa lo contrario: días que ENTRAN en la bolsa. Sin el `+`,
 * las dos cosas se leen igual en la misma columna.
 */
export function diasDeLaFila(s: ParaLaTabla): string {
  return esOtorgamiento(s.tipo) ? `+${formatDias(s.diasHabiles)}` : formatDias(s.diasHabiles);
}

/**
 * Las celdas «Desde» y «Hasta» de una fila.
 *
 * Un otorgamiento tiene una sola fecha —el día trabajado— repetida en las dos
 * columnas, y «6 jun – 6 jun» se lee como una errata. Se enseña una vez y la
 * segunda queda vacía.
 */
export function fechasDeLaFila(s: ParaLaTabla): { desde: string; hasta: string } {
  if (esOtorgamiento(s.tipo)) return { desde: formatFecha(s.fechaInicio), hasta: '' };
  return { desde: formatFecha(s.fechaInicio), hasta: formatFecha(s.fechaFin) };
}

/** Hasta cuántos meses hacia atrás se puede reclamar un trabajo extra. */
const MESES_HACIA_ATRAS = 3;

/**
 * El día más antiguo por el que hoy se puede pedir un compensatorio. Espejo
 * EXACTO de `limiteDelTrabajo` en `apps/hub-api/src/ausencias/service.ts`.
 *
 * Es lo que el formulario le pone al `min` del calendario, así que si las dos se
 * separan el selector deja elegir un día que el servidor rechaza —o bloquea uno
 * que aceptaría—, y las dos formas desconciertan igual.
 *
 * Meses de calendario y no noventa días: la regla se le dice al empleado como
 * «tres meses». `Date.UTC` normaliza el desbordamiento de día —desde un 31 de
 * mayo, tres meses atrás cae el 3 de marzo y no el «31 de febrero»—, lo que hace
 * la ventana un par de días más corta en esas fechas, nunca más larga.
 */
export function limiteDelTrabajo(hoy: string): string {
  const [anio, mes, dia] = hoy.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1 - MESES_HACIA_ATRAS, dia)).toISOString().slice(0, 10);
}
