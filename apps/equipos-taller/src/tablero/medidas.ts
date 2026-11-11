// Presupuesto de espacio del tablero a 1920×1080 (diseño D4/D5). Puro: se decide la densidad de
// una columna por el número de tarjetas y sus etiquetas, sin medir el DOM (que jsdom no puede).

export const MEDIDAS = {
  /** Alto del tablero (sin cabecera, KPIs ni leyenda). */
  tablero: 770,
  /** Alto que queda a las tarjetas dentro de una columna. */
  areaTarjetas: 612,
  /** Alto de una tarjeta completa sin etiquetas (texto limitado a una línea). */
  base: 189,
  porEtiqueta: 38,
  /** Alto de una tarjeta compacta de 3 líneas. */
  compacta: 100,
  /** Alto de la tarjeta «+N más». */
  mas: 56,
  hueco: 10,
} as const;

export type Densidad = 'completa' | 'compacta';
export interface PlanColumna { densidad: Densidad; visibles: number; ocultas: number }

export const alturaTarjeta = (etiquetas: number): number => MEDIDAS.base + MEDIDAS.porEtiqueta * etiquetas;

const apilado = (alturas: number[]): number => alturas.reduce((a, h) => a + h, 0) + Math.max(0, alturas.length - 1) * MEDIDAS.hueco;

/**
 * Cómo se dibuja una columna ordenada de más antigua a más nueva: completas si caben; si no, TODAS
 * compactas; solo si ni así caben, las más antiguas compactas y una tarjeta «+N más».
 */
export function planColumna(tarjetas: readonly { etiquetas: number }[]): PlanColumna {
  const n = tarjetas.length;
  if (apilado(tarjetas.map((t) => alturaTarjeta(t.etiquetas))) <= MEDIDAS.areaTarjetas) return { densidad: 'completa', visibles: n, ocultas: 0 };
  if (apilado(tarjetas.map(() => MEDIDAS.compacta)) <= MEDIDAS.areaTarjetas) return { densidad: 'compacta', visibles: n, ocultas: 0 };
  let k = 0;
  while ((k + 1) * (MEDIDAS.compacta + MEDIDAS.hueco) + MEDIDAS.mas <= MEDIDAS.areaTarjetas) k++;
  return { densidad: 'compacta', visibles: k, ocultas: n - k };
}
