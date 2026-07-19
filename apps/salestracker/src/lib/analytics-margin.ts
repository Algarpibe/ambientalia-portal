export interface MarginDerived { margen: number; margenPct: number }

export function deriveMargin(ventas: number, costo: number): MarginDerived {
  const margen = ventas - costo;
  return { margen, margenPct: ventas > 0 ? (margen / ventas) * 100 : 0 };
}
