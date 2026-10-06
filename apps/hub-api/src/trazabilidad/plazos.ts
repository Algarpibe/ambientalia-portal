/**
 * Plazos de los servicios abiertos en Zoho Desk, en días hábiles.
 *
 * Sólo de servidor: el calendario laboral (lunes a viernes sin festivos de
 * Colombia) es el de la app de Ausencias y aquí no se repite ninguna regla,
 * se llama a `contarDiasHabiles` y a `festivosColombia`. La app del portal no
 * importa este fichero: recibe ya calculados la fecha límite, los días que
 * quedan y el estado.
 */

import { MAX_DIAS_RANGO, contarDiasHabiles } from '../ausencias/dias-habiles.js';
import { festivosColombia, sumarDias } from '../ausencias/festivos.js';
import { RETROCESO_MAX_DIAS, esFechaIso, estadoPlazo, type EstadoPlazo, type TramoPlazo } from './dominio.js';

/** Margen de festivos que se manda más allá de la última fecha límite. */
const MARGEN_FESTIVOS_DIAS = 31;

const esHabil = (fecha: string): boolean => contarDiasHabiles(fecha, fecha) === 1;

/**
 * `desde` + `n` días hábiles. El día de partida no cuenta: un ingreso el lunes
 * con plazo de 3 vence el jueves.
 */
export function sumarDiasHabiles(desde: string, n: number): string {
  let fecha = desde;
  for (let quedan = n; quedan > 0; ) {
    fecha = sumarDias(fecha, 1);
    if (esHabil(fecha)) quedan--;
  }
  return fecha;
}

/** Días hábiles de `desde` a `hasta`, ambos incluidos, por tramos que `contarDiasHabiles` admite. */
function habilesInclusive(desde: string, hasta: string): number {
  let total = 0;
  for (let a = desde; a <= hasta; ) {
    const tope = sumarDias(a, MAX_DIAS_RANGO - 1);
    const b = tope < hasta ? tope : hasta;
    total += contarDiasHabiles(a, b);
    a = sumarDias(b, 1);
  }
  return total;
}

/**
 * Días hábiles de `desde` a `hasta` sin contar el de partida: positivo si
 * `hasta` es posterior, negativo si es anterior, 0 si son el mismo día.
 */
export function diasHabilesEntre(desde: string, hasta: string): number {
  if (hasta === desde) return 0;
  // «0 - n» y no «-n»: un atraso de cero días hábiles (sábado tras un límite en viernes) no debe salir como -0.
  return hasta > desde ? habilesInclusive(sumarDias(desde, 1), hasta) : 0 - habilesInclusive(sumarDias(hasta, 1), desde);
}

export interface PlazoCalculado {
  /** Ingreso + plazo en días hábiles; null si el servicio no tiene plazo. */
  fechaLimite: string | null;
  /** Días hábiles hasta la fecha límite; negativo = días hábiles de atraso. */
  diasHabiles: number | null;
  estadoPlazo: EstadoPlazo;
}

/**
 * Fecha límite de un servicio: ingreso + `dias` hábiles, a fecha `hoy`. Sin
 * ingreso o sin plazo configurado para su tipo, no hay fecha límite.
 */
export function calcularPlazo(ingreso: string | null, dias: number | null, hoy: string): PlazoCalculado {
  if (dias === null || !esFechaIso(ingreso)) return { fechaLimite: null, diasHabiles: null, estadoPlazo: 'SIN_PLAZO' };
  const fechaLimite = sumarDiasHabiles(ingreso, dias);
  return { fechaLimite, diasHabiles: diasHabilesEntre(hoy, fechaLimite), estadoPlazo: estadoPlazo(fechaLimite, hoy) };
}

/**
 * Los tramos del plazo de un servicio de tipo compuesto: cada parte ocupa sus
 * días hábiles a continuación de la anterior, empezando en el ingreso. El
 * último tramo acaba en la fecha límite (`calcularPlazo` con la suma), porque
 * sumar días hábiles por partes da lo mismo que sumarlos de una vez. Null si
 * no hay ingreso, no hay partes o a alguna le falta el plazo.
 */
export function calcularTramos(
  ingreso: string | null,
  partes: readonly { clave: string; etiqueta: string; dias: number | null }[],
): TramoPlazo[] | null {
  if (!esFechaIso(ingreso) || partes.length === 0) return null;
  const tramos: TramoPlazo[] = [];
  let desde: string = ingreso;
  for (const p of partes) {
    if (p.dias === null) return null;
    desde = sumarDiasHabiles(desde, p.dias);
    tramos.push({ clave: p.clave, etiqueta: p.etiqueta, dias: p.dias, hasta: desde });
  }
  return tramos;
}

/**
 * Festivos que caen en el tramo que puede pintar el calendario de barras: desde
 * el tope de retroceso hasta pasada la última fecha límite. La app sombrea con
 * ellos los días no hábiles sin conocer la regla.
 */
export function festivosDelEje(hoy: string, fechasLimite: readonly (string | null)[]): string[] {
  const desde = sumarDias(hoy, -RETROCESO_MAX_DIAS);
  const ultima = fechasLimite.reduce<string>((max, f) => (f && f > max ? f : max), hoy);
  const hasta = sumarDias(ultima, MARGEN_FESTIVOS_DIAS);
  const out: string[] = [];
  for (let anio = Number(desde.slice(0, 4)); anio <= Number(hasta.slice(0, 4)); anio++) {
    for (const f of festivosColombia(anio)) if (f >= desde && f <= hasta) out.push(f);
  }
  return out.sort();
}
