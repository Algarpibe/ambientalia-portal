// Identidad del técnico en «Mis equipos»: se compara el nombre del usuario con el `z.enc` de las
// tarjetas, sin importar mayúsculas, tildes ni espacios (D16). Sin escrituras ni tabla de equivalencias.
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

/** Nombres distintos (por clave normalizada) de los técnicos con tarjetas, en orden alfabético. */
export function tecnicosDelTablero(t: Tablero): string[] {
  const vistos = new Map<string, string>();
  for (const c of t.columnas) for (const k of c.tarjetas) if (k.tecnico && !vistos.has(nkey(k.tecnico.nombre))) vistos.set(nkey(k.tecnico.nombre), k.tecnico.nombre);
  return [...vistos.values()].sort((p, q) => p.localeCompare(q, 'es'));
}

/** Las tarjetas del técnico `nombre` (igualdad de clave normalizada). */
export const esDe = (k: Tarjeta, nombre: string): boolean => !!k.tecnico && nkey(k.tecnico.nombre) === nkey(nombre);
