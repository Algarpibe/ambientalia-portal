// Paleta y tokens del rediseño cálido del dashboard (Home). Solo aplica a la Home;
// el resto de la sub-app conserva su estilo. Los hex se pasan a recharts como color.
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

// Rampa cálida secuencial para la dona (tras la 1ª porción, en naranja).
export const DONUT_RAMP = ['#575349', '#837D72', '#ABA598', '#CFC9BC', '#DED9CE'] as const;

/** Color de la porción i de la dona: 1ª en acento, 'Otros' claro, resto rampa. */
export function donutColor(i: number, categoria: string): string {
  if (categoria === 'Otros') return T.prev;
  if (i === 0) return T.accent;
  return DONUT_RAMP[(i - 1) % DONUT_RAMP.length];
}
