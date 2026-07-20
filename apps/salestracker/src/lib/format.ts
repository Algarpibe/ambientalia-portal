export const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'] as const;
export const formatUSD = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
export function yearRange(desde: number, hasta: number): number[] {
  const out: number[] = [];
  for (let y = hasta; y >= desde; y--) out.push(y);
  return out;
}

/** USD compacto para ejes/tooltips: $1,2 M / $980 K. */
export const formatCompactUSD = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** Paleta de series por bucket (mano_obra, cr, equipos, operacion). */
export const SERIES = ['#6366f1', '#10b981', '#f59e0b', '#ef4444'] as const;
/** Paleta para categorías/marcas (dona) + color "Otros". */
export const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6'] as const;
export const OTROS_COLOR = '#94a3b8';
