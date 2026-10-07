/**
 * El calendario de la agenda del taller (D3 de
 * docs/trazabilidad-agenda-taller.md): los días hábiles de los plazos —lunes a
 * viernes sin festivos de Colombia— MENOS los cierres de empresa que da la
 * fuente (`FuenteAgenda.cierresEmpresa`; vacíos en respaldo).
 *
 * Sólo de servidor, como plazos.ts, del que toma la regla de los días hábiles
 * sin repetirla. Puro: los cierres llegan como argumento, no lee ninguna base.
 */

import { sumarDias } from '../ausencias/festivos.js';
import { esHabil } from './plazos.js';

/** True si `fecha` (AAAA-MM-DD) es hábil y la empresa no cierra ese día. */
export function esHabilAgenda(fecha: string, cierres: ReadonlySet<string>): boolean {
  return esHabil(fecha) && !cierres.has(fecha);
}

/** `fecha` si es hábil de agenda; si no, el siguiente que lo sea (D16: nada se proyecta en un día no hábil). */
export function primerDiaHabilAgenda(fecha: string, cierres: ReadonlySet<string>): string {
  return esHabilAgenda(fecha, cierres) ? fecha : sumarDiasHabilesAgenda(fecha, 1, cierres);
}

/**
 * `desde` + `n` días hábiles de agenda. Como `sumarDiasHabiles`, el día de
 * partida no cuenta; sin cierres da exactamente lo mismo.
 */
export function sumarDiasHabilesAgenda(desde: string, n: number, cierres: ReadonlySet<string>): string {
  let fecha = desde;
  for (let quedan = n; quedan > 0; ) {
    fecha = sumarDias(fecha, 1);
    if (esHabilAgenda(fecha, cierres)) quedan--;
  }
  return fecha;
}
