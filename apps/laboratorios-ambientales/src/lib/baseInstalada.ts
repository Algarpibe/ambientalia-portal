// Base instalada de aire: un equipo por código de laboratorio + número de serie,
// sacado del dataset 2waz-acaa. Ver
// docs/superpowers/specs/2026-11-27-base-instalada-aire-design.md.

// Los rellenos que el dataset escribe cuando no hay dato.
const RELLENOS = new Set(['no aplica', 'n/a', 'na']);

/**
 * ¿Es un valor vacío? Tras recortarlo: en blanco, solo guiones, o «No aplica»,
 * «N/A» o «NA» sin distinguir mayúsculas. Lo usan mapRecord (para no guardar
 * estacion ni serie vacías) y la agrupación de equipos.
 */
export function esValorVacio(texto: string): boolean {
  const limpio = texto.trim().toLowerCase().replace(/\s+/g, ' ');
  return limpio === '' || /^[-–—]+$/.test(limpio) || RELLENOS.has(limpio);
}

/**
 * Las series de un campo de equipo: una fila puede listar varias (una red con
 * 30 muestreadores). Se parte por comas, puntos y comas y saltos de línea; no
 * por «/» ni por espacios, porque hay series como «XY-12345-678/2». Los trozos
 * vacíos (según esValorVacio) se descartan.
 */
export function separarSeries(campo: string): string[] {
  return campo
    .split(/[,;\r\n]/)
    .map((trozo) => trozo.trim())
    .filter((trozo) => !esValorVacio(trozo));
}
