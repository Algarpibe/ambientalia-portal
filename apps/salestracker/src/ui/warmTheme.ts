// Sistema de diseño cálido de SalesTracker. Tokens compartidos por toda la sub-app.
// Los hex se pasan a recharts como color; las clases visuales viven en warm.css (.st-*).
export const T = {
  page: '#E7E5E0',
  surface: '#FCFBF9',
  tile: '#EFEDE8',
  ink: '#24231F',
  ink2: '#6E6B64',
  muted: '#9A968E',
  accent: '#EE7A21',
  accentSoft: '#FBE7D4',
  accentInk: '#B4541A',
  fac: '#2F3437',
  ov: '#B7B1A7',
  prev: '#CFCABF',
  grid: '#E5E2DB',
  baseline: '#D6D2C9',
} as const;

// Rampa cálida secuencial para donas (tras la 1ª porción, en naranja).
export const DONUT_RAMP = ['#575349', '#837D72', '#ABA598', '#CFC9BC', '#DED9CE'] as const;

/** Color de la porción i de una dona: 1ª en acento, 'Otros' claro, resto rampa. */
export function donutColor(i: number, categoria: string): string {
  if (categoria === 'Otros') return T.prev;
  if (i === 0) return T.accent;
  return DONUT_RAMP[(i - 1) % DONUT_RAMP.length];
}

/** Roles de color para gráficos (recharts). */
export const CHART = {
  fac: T.fac,
  ov: T.ov,
  accent: T.accent,
  prev: T.prev,
  baseline: T.baseline,
  grid: T.grid,
  muted: T.muted,
  ink: T.ink,
  reference: '#C08A4E', // líneas de referencia (80/20, equilibrio)
  // Series apiladas (buckets): charcoal, naranja, taupe, claro — ordenadas por luminosidad + acento.
  stack: ['#2F3437', '#EE7A21', '#9A8F7E', '#CBC4B6'] as const,
} as const;
