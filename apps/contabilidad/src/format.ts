const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** Formatea un valor en pesos colombianos sin decimales. */
export function formatCOP(n: number): string {
  return cop.format(Number.isFinite(n) ? n : 0);
}

/** Formatea una fracción 0..1 como porcentaje con un decimal. */
export function formatPct(fraccion: number): string {
  const v = Number.isFinite(fraccion) ? fraccion * 100 : 0;
  return `${v.toFixed(1)}%`;
}
