// Reglas puras de la pantalla de TV: escala del lienzo 1920×1080, tema día/noche y fecha larga.
import { esModoTemaTv, fechaBogota, horaBogota, type AjustesTablero, type ModoTemaTv } from '../nucleo';

export const LIENZO = { ancho: 1920, alto: 1080 } as const;

/** Escala que hace caber el lienzo entero en la ventana, y el desplazamiento que lo centra. */
export function escalaLienzo(ancho: number, alto: number): { escala: number; x: number; y: number } {
  const w = Math.max(1, ancho);
  const h = Math.max(1, alto);
  const escala = Math.min(w / LIENZO.ancho, h / LIENZO.alto);
  return { escala, x: (w - LIENZO.ancho * escala) / 2, y: (h - LIENZO.alto * escala) / 2 };
}

export type TemaTv = 'dia' | 'noche';

/** Noche desde `nocheDesde` (incluida) hasta `nocheHasta` (excluida), en hora de Bogotá. */
export function temaAuto(ms: number, a: Pick<AjustesTablero, 'nocheDesde' | 'nocheHasta'>): TemaTv {
  const h = horaBogota(ms);
  const { nocheDesde: d, nocheHasta: n } = a;
  const noche = d > n ? h >= d || h < n : h >= d && h < n;
  return noche ? 'noche' : 'dia';
}

/**
 * Tema de la TV: `?tema=dia|noche|auto` manda; sin él (o con uno inválido), el ajuste «Tema de la TV»
 * (si falta o no se reconoce, día). Solo `auto` mira el horario de noche.
 */
export function resolverTema(param: string | null, ms: number, a: Pick<AjustesTablero, 'nocheDesde' | 'nocheHasta' | 'temaTv'>): TemaTv {
  const modo: ModoTemaTv = esModoTemaTv(param) ? param : esModoTemaTv(a.temaTv) ? a.temaTv : 'dia';
  return modo === 'auto' ? temaAuto(ms, a) : modo;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «miércoles 11 de noviembre de 2026», con el día de Bogotá. */
export function fechaLarga(ms: number): string {
  const [a, m, d] = fechaBogota(ms).split('-').map(Number);
  return `${DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]} ${d} de ${MESES[m - 1]} de ${a}`;
}
