import type { FichaDeDescanso, TramoDeDescanso } from './api';

// La tarjeta «Cuánto lleva cada uno sin descansar»: lo que se decide sin
// pantalla. El tramo y los meses vienen hechos de hub-api; aquí solo se
// redactan, para que la etiqueta y el color salgan del mismo número.

/** Cuánto lleva sin descansar, en la unidad que se entiende de un vistazo. */
export function textoDeDescanso(
  f: Pick<FichaDeDescanso, 'tramo' | 'diasSinVacaciones' | 'mesesSinVacaciones'>,
): string {
  if (f.tramo === 'ahora') return 'de vacaciones ahora';
  if (f.diasSinVacaciones === null || f.mesesSinVacaciones === null) return 'sin vacaciones registradas';
  const dias = f.diasSinVacaciones;
  if (dias < 60) return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
  const meses = f.mesesSinVacaciones;
  if (meses < 24) return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  return `hace ${Math.floor(meses / 12)} años`;
}

/** El color del tiempo según el tramo. «nunca» es lo más grave: rojo, como la alarma. */
export const COLOR_DE_TRAMO: Record<TramoDeDescanso, string> = {
  nunca: 'text-red-600',
  alarma: 'text-red-600',
  aviso: 'text-amber-600',
  ok: 'text-gray-700',
  ahora: 'text-emerald-600',
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * `YYYY-MM-DD` → «3 oct 2026». A mano y no con `toLocaleDateString`: el formato
 * de `es-CO` cambia entre versiones de ICU («3 de oct. de 2026») y aquí cabe
 * poco.
 */
export function fechaConMes(iso: string): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return `${dia} ${MESES[mes - 1]} ${anio}`;
}
