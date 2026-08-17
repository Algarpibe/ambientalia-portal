import type { SolicitudPendiente } from '../api';

// Resumen que alimenta el widget «Solicitudes por aprobar» del Dashboard.
// Pura a propósito —sin React, sin fetch y sin reloj propio: `ahora` entra por
// parámetro— para poder razonarla de un vistazo, y para que cubrirla con tests
// sea trivial el día que esta app tenga runner.

export interface ResumenPendientes {
  /** Cuántas esperan la firma de quien mira el widget. */
  total: number;
  /** Días naturales que lleva esperando la más antigua. `null` si no hay ninguna. */
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
  ahora: Date,
): ResumenPendientes {
  // `!== false` y no `=== true`. Los dos servicios se despliegan por separado y
  // hay una ventana en que el portal va por delante de hub-api; ahí el campo
  // llega `undefined`. Así degrada a «cuéntalas todas» —el comportamiento
  // anterior— y el peor caso es un número inflado, que se ve y se corrige solo
  // al desplegar. Con `=== true` degradaría a 0: diría «nada pendiente»
  // mientras las solicitudes se pudren, y eso no lo nota nadie.
  const mias = solicitudes.filter((s) => s.esMiTurno !== false);
  if (mias.length === 0) return { total: 0, esperaDias: null };

  const instantes = mias
    .map((s) => new Date(esperandoDesde(s)).getTime())
    .filter((t) => Number.isFinite(t));

  // Si ninguna fecha es legible seguimos sabiendo cuántas hay: se calla la
  // antigüedad, pero no se pierde el aviso. Un «NaN días» sería peor que nada.
  if (instantes.length === 0) return { total: mias.length, esperaDias: null };

  // Días de calendario COLOMBIANO, no bloques de 24 h ni días hábiles: contar
  // hábiles exigiría los festivos, que viajan en `/ausencias/contexto` y
  // costarían una segunda llamada. Y con bloques de 24 h una solicitud creada
  // ayer a las 18:00 y mirada hoy a las 08:00 (14 h) diría «llegó hoy», que es
  // falso: cruzó la medianoche de Colombia y ya lleva un día natural esperando.
  const esperaDias = diaColombiano(ahora.getTime()) - diaColombiano(Math.min(...instantes));

  return { total: mias.length, esperaDias: Math.max(0, esperaDias) };
}
