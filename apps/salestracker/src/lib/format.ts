// Formateadores de moneda compartidos (@suite/format, cierra AI-613). El resto
// de este módulo (meses, rango de años y paletas cálidas) es específico de
// salestracker y se mantiene local.
export { formatUSD, formatCompactUSD } from '@suite/format';

export const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'] as const;
export function yearRange(desde: number, hasta: number): number[] {
  const out: number[] = [];
  for (let y = hasta; y >= desde; y--) out.push(y);
  return out;
}

/** Paleta cálida de series por bucket (mano_obra, cr, equipos, operacion):
 *  charcoal, naranja, taupe, claro — ordenada por luminosidad + acento. */
export const SERIES = ['#2F3437', '#EE7A21', '#9A8F7E', '#CBC4B6'] as const;
/** Rampa cálida para categorías/marcas (dona), liderada por el acento + color "Otros". */
export const PALETTE = ['#EE7A21', '#575349', '#837D72', '#ABA598', '#CFC9BC', '#9A8F7E', '#C7C1B4', '#DED9CE'] as const;
export const OTROS_COLOR = '#CFCABF';
