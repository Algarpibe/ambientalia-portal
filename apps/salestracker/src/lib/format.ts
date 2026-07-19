export const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'] as const;
export const formatUSD = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
export function yearRange(desde: number, hasta: number): number[] {
  const out: number[] = [];
  for (let y = hasta; y >= desde; y--) out.push(y);
  return out;
}
