// @suite/format — formateadores de moneda/número compartidos por las apps del
// portal (cierra AI-613: cada app redefinía Intl.NumberFormat, con/ sin guard
// isFinite, USD vs COP inconsistente). Todas las funciones son puras y aplican
// el guard: un valor no finito (NaN/Infinity) formatea como 0, nunca "NaN".

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

/** Devuelve `n` si es finito; si no (NaN/±Infinity), 0. Evita renders "NaN". */
export function safeNumber(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/** Pesos colombianos sin decimales. Ej: $1.234.567 */
export function formatCOP(n: number): string {
  return cop.format(safeNumber(n));
}

/** Dólares sin decimales. Ej: $1,234,568 */
export function formatUSD(n: number): string {
  return usd.format(safeNumber(n));
}

/** USD compacto para ejes/tooltips. Ej: $1,2 M / $980 K */
export function formatCompactUSD(n: number): string {
  return usdCompact.format(safeNumber(n));
}

/** Fracción 0..1 como porcentaje con un decimal. Ej: 0.1234 → "12.3%" */
export function formatPct(fraccion: number): string {
  return `${(safeNumber(fraccion) * 100).toFixed(1)}%`;
}
