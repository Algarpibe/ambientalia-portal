import { COLORES_AVATAR } from './marca';

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

/** Decisión D9: 1.ª palabra y 2.ª (o 3.ª si hay cuatro o más), sin partículas. */
export function iniciales(nombre: string): string {
  const palabras = nombre
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '' && !PARTICULAS.has(p.toLowerCase()));
  if (palabras.length === 0) return '?';
  const segunda = palabras.length >= 4 ? palabras[2] : palabras[1];
  return (palabras[0].charAt(0) + (segunda ?? '').charAt(0)).toUpperCase();
}

/** «BRUNO DÍAZ» → «Bruno». */
export function primerNombre(nombre: string): string {
  const primera = nombre.trim().split(/\s+/)[0] ?? '';
  return primera.charAt(0).toUpperCase() + primera.slice(1).toLowerCase();
}

/** Color estable por persona para el avatar sin foto. */
export function colorDe(userId: string): string {
  let h = 0;
  for (const caracter of userId) h = (h * 31 + caracter.charCodeAt(0)) >>> 0;
  return COLORES_AVATAR[h % COLORES_AVATAR.length];
}
