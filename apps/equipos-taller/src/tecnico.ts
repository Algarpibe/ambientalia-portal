// Identidad del técnico en «Mis equipos». Una visita asignada en el portal es de la CUENTA a la que se asignó
// (`tecnico.userId`). Las demás se reconocen como antes: el nombre del usuario frente al Encargado de Desk, sin
// importar mayúsculas, tildes ni espacios (D16). Sin escrituras ni tabla de equivalencias.
import { Reglas, type Tablero, type Tarjeta } from './nucleo';

const nkey = Reglas.nkey;

const palabras = (n: string): Set<string> => new Set(nkey(n).split(' ').filter(Boolean));

/** Mismas palabras, o las del nombre más corto (2 o más) están todas en el más largo. */
export function coincideTecnico(a: string, b: string): boolean {
  const [x, y] = [palabras(a), palabras(b)].sort((p, q) => p.size - q.size);
  if (x.size === 0) return false;
  if (x.size === y.size) return [...x].every((p) => y.has(p));
  return x.size >= 2 && [...x].every((p) => y.has(p));
}

/**
 * Nombres distintos (por clave normalizada) de los técnicos de DESK con tarjetas, en orden alfabético. Las
 * asignadas en el portal no entran: se reconocen por la cuenta, no por «¿Quién eres?».
 */
export function tecnicosDelTablero(t: Tablero): string[] {
  const vistos = new Map<string, string>();
  for (const c of t.columnas) {
    for (const k of c.tarjetas) {
      if (k.tecnico && !k.tecnico.userId && !vistos.has(nkey(k.tecnico.nombre))) vistos.set(nkey(k.tecnico.nombre), k.tecnico.nombre);
    }
  }
  return [...vistos.values()].sort((p, q) => p.localeCompare(q, 'es'));
}

/** Las tarjetas del técnico `nombre` (igualdad de clave normalizada). */
export const esDe = (k: Tarjeta, nombre: string): boolean => !!k.tecnico && nkey(k.tecnico.nombre) === nkey(nombre);

/**
 * ¿Es mía esta tarjeta? Con asignación del portal, solo si es de mi cuenta (aunque Desk o el nombre digan otra
 * cosa). Sin ella, por el nombre elegido o reconocido, como antes.
 */
export function esMia(k: Tarjeta, yo: { userId: string | null; nombre: string | null }): boolean {
  if (k.tecnico?.userId) return yo.userId !== null && k.tecnico.userId === yo.userId;
  return yo.nombre !== null && esDe(k, yo.nombre);
}
