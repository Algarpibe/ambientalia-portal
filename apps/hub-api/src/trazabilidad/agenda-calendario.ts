/**
 * El calendario de la agenda del taller (D3 de
 * docs/trazabilidad-agenda-taller.md): los días hábiles de los plazos —lunes a
 * viernes sin festivos de Colombia— MENOS los cierres de empresa que da la
 * fuente (`FuenteAgenda.cierresEmpresa`; vacíos en respaldo).
 *
 * Sólo de servidor, como plazos.ts, del que toma la regla de los días hábiles
 * sin repetirla. Puro: los cierres llegan como argumento, no lee ninguna base.
 */

import { festivosColombia, sumarDias } from '../ausencias/festivos.js';
import { esHabil } from './plazos.js';

/** El eje del calendario de la pantalla (lote 7): cuántos días hábiles hacia atrás y cuántos días hacia delante de hoy. */
export const EJE_HABILES_ATRAS = 3;
export const EJE_DIAS_ADELANTE = 28;

/** El tramo que pinta el calendario de la agenda (ambos días incluidos) y sus días no hábiles que no son fin de semana. */
export interface EjeAgenda {
  desde: string;
  hasta: string;
  festivos: string[];
  cierres: string[];
}

/**
 * El eje a fecha `hoy`: desde hace `EJE_HABILES_ATRAS` días hábiles de agenda
 * hasta `EJE_DIAS_ADELANTE` días después, con los festivos de Colombia y los
 * cierres de empresa que caen dentro. La pantalla sombrea con ellos sin
 * conocer la regla.
 */
export function ejeAgenda(hoy: string, cierres: readonly string[]): EjeAgenda {
  const cerrados = new Set(cierres);
  let desde = hoy;
  for (let quedan = EJE_HABILES_ATRAS; quedan > 0; ) {
    desde = sumarDias(desde, -1);
    if (esHabilAgenda(desde, cerrados)) quedan--;
  }
  const hasta = sumarDias(hoy, EJE_DIAS_ADELANTE);
  const dentro = (f: string) => f >= desde && f <= hasta;
  const festivos: string[] = [];
  for (let anio = Number(desde.slice(0, 4)); anio <= Number(hasta.slice(0, 4)); anio++) festivos.push(...[...festivosColombia(anio)].filter(dentro));
  return { desde, hasta, festivos: festivos.sort(), cierres: [...cerrados].filter(dentro).sort() };
}

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
