import { formatDias } from './dominio';

// El resumen por persona de los KPIs: lo que se decide sin pantalla. Vive aquí,
// con tests, y no dentro de PanelKpis.

/** Un número de días, o «—» si es cero: un 0 en una tabla larga se lee peor. */
export function celdaDeDias(n: number): string {
  return n > 0 ? formatDias(n) : '—';
}

/**
 * La celda de permisos: las horas de los que las tienen y, aparte, los de día
 * completo («6,5 h + 1 d»). Los días no se pasan a horas: la app no conoce la
 * jornada.
 */
export function celdaDePermisos(horas: number, dias: number): string {
  const partes: string[] = [];
  if (horas > 0) partes.push(`${formatDias(horas)} h`);
  if (dias > 0) partes.push(`${formatDias(dias)} d`);
  return partes.length > 0 ? partes.join(' + ') : '—';
}

/** Lo que el título dice del periodo, a partir del `anio` que devuelve el servidor. */
export function rotuloDelPeriodo(anio: number | null): string {
  return anio === null ? 'en los últimos 12 meses' : `en ${anio}`;
}
