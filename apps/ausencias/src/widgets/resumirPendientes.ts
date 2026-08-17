import type { SolicitudConPropuesta, SolicitudPendiente } from '../api';
import { meTocaDecidir, meTocaFirmar } from '../dominio';

// Resumen que alimenta el widget «Solicitudes por aprobar» del Dashboard.
// Pura a propósito —sin React, sin fetch y sin reloj propio: `ahora` entra por
// parámetro— para poder razonarla de un vistazo, y para que cubrirla con tests
// sea trivial el día que esta app tenga runner. Las frases que pinta el widget
// también viven aquí, por lo mismo.

export interface ResumenPendientes {
  /** Todo lo que espera una decisión suya: las firmas MÁS los cambios pedidos. */
  total: number;
  /** De ese total, las solicitudes que esperan su firma. */
  solicitudes: number;
  /**
   * De ese total, los cambios pedidos sobre solicitudes ya enviadas.
   *
   * Se suman al total y no se cuentan aparte porque están en la misma pestaña
   * de la app (`Pendientes de aprobar`), y ese contador los suma igual: dos
   * números distintos para «lo que me falta por atender» no los reconcilia
   * nadie. Van además desglosados para poder decir de qué son los del total.
   */
  cambios: number;
  /** Días naturales que lleva esperando lo más antiguo. `null` si no hay nada. */
  esperaDias: number | null;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * El día del calendario colombiano al que pertenece un instante. Mismo criterio
 * que `hoyEnColombia` en `dominio.ts`: restar el desfase UTC−5 ANTES de trocear
 * en días. Sin esto se contarían bloques de 24 h, y «llegó hoy» acabaría
 * diciéndose de una solicitud que llegó ayer por la tarde.
 */
const diaColombiano = (ms: number) => Math.floor((ms - 5 * 3_600_000) / MS_POR_DIA);

/**
 * Desde cuándo lleva esperando a ESTE firmante.
 *
 * Para una `pendiente_2` la espera arranca en la primera firma, no en el alta:
 * hasta ese momento la solicitud no le estaba esperando a él. Medirla desde
 * `createdAt` le cobraría la tardanza del primer aprobador y convertiría el
 * aviso en un reproche injusto.
 */
function esperandoDesde(s: SolicitudPendiente): string {
  return s.estado === 'pendiente_2' ? (s.primeraFirmaAt ?? s.createdAt) : s.createdAt;
}

export function resumirPendientes(
  solicitudes: SolicitudPendiente[],
  cambios: SolicitudConPropuesta[],
  ahora: Date,
): ResumenPendientes {
  // Los dos filtros salen de `dominio.ts` y NO se escriben aquí: el rótulo de la
  // pestaña «Pendientes de aprobar (N)» cuenta con los mismos, y la única forma
  // de que los dos números no vuelvan a divergir es que la regla exista una sola
  // vez. Allí está también el porqué del `!== false`.
  const mias = solicitudes.filter(meTocaFirmar);
  const mios = cambios.filter(meTocaDecidir);
  const total = mias.length + mios.length;
  if (total === 0) return { total: 0, solicitudes: 0, cambios: 0, esperaDias: null };
  const recuento = { total, solicitudes: mias.length, cambios: mios.length };

  const instantes = [
    ...mias.map((s) => Date.parse(esperandoDesde(s))),
    // Un cambio lleva esperando desde que se PIDIÓ, no desde que se creó la
    // solicitud: se puede pedir meses después, y medirlo desde el alta diría
    // «lleva 90 días esperando» de algo que llegó esta mañana.
    ...mios.map((c) => Date.parse(c.modificacionPendiente?.createdAt ?? '')),
  ].filter((t) => Number.isFinite(t));

  // Si ninguna fecha es legible seguimos sabiendo cuántas hay: se calla la
  // antigüedad, pero no se pierde el aviso. Un «NaN días» sería peor que nada.
  if (instantes.length === 0) return { ...recuento, esperaDias: null };

  // Días de calendario COLOMBIANO, no bloques de 24 h ni días hábiles: contar
  // hábiles exigiría los festivos, que viajan en `/ausencias/contexto` y
  // costarían una segunda llamada. Y con bloques de 24 h una solicitud creada
  // ayer a las 18:00 y mirada hoy a las 08:00 (14 h) diría «llegó hoy», que es
  // falso: cruzó la medianoche de Colombia y ya lleva un día natural esperando.
  const esperaDias = diaColombiano(ahora.getTime()) - diaColombiano(Math.min(...instantes));

  return { ...recuento, esperaDias: Math.max(0, esperaDias) };
}

/** «3 solicitudes», «1 cambio pedido»: el número con su sustantivo concordado. */
const plural = (n: number, singular: string, pluralizado: string) =>
  `${n} ${n === 1 ? singular : pluralizado}`;

/**
 * La etiqueta que va bajo el número grande.
 *
 * Sin cambios pedidos dice exactamente lo que decía antes de existir esta
 * feature («solicitudes» a secas): el widget es el mismo hasta que hay algo
 * nuevo que contar. Con los dos, desglosa — un «5» sobre la palabra
 * «solicitudes» sería mentira si dos de esos cinco son cambios.
 */
export function etiquetaDePendientes(r: ResumenPendientes): string {
  if (r.cambios === 0) return r.total === 1 ? 'solicitud' : 'solicitudes';
  if (r.solicitudes === 0) return r.cambios === 1 ? 'cambio pedido' : 'cambios pedidos';
  return `${plural(r.solicitudes, 'solicitud', 'solicitudes')} y ${plural(r.cambios, 'cambio', 'cambios')}`;
}

/**
 * La frase entera, que es lo que oye un lector de pantalla: el número y su
 * etiqueta sueltos se leerían «5» y luego «3 solicitudes y 2 cambios».
 *
 * Se arma en plantillas y no pegando etiquetas JSX: en este repo un salto de
 * línea entre texto y etiqueta ya se comió un espacio dos veces.
 */
export function fraseDePendientes(r: ResumenPendientes): string {
  if (r.cambios === 0) return `${plural(r.total, 'solicitud espera', 'solicitudes esperan')} tu firma`;
  if (r.solicitudes === 0) {
    return `${plural(r.cambios, 'cambio pedido espera', 'cambios pedidos esperan')} tu decisión`;
  }
  return `${plural(r.solicitudes, 'solicitud espera', 'solicitudes esperan')} tu firma, y ${plural(
    r.cambios,
    'cambio pedido espera',
    'cambios pedidos esperan',
  )} tu decisión`;
}

/**
 * El texto del enlace. «Ir a firmar» deja de ser cierto cuando lo único que
 * queda son cambios, que no se firman: se aprueban o se rechazan.
 */
export const textoDelEnlace = (r: ResumenPendientes): string =>
  r.solicitudes === 0 ? 'Ir a decidir' : 'Ir a firmar';
