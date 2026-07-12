/**
 * Utilidades estadísticas para scoring de clientes
 * 
 * DOCUMENTACIÓN DE SCORES:
 * - Todos los scores están en escala 0-100
 * - 100 = mejor resultado posible
 * - 0 = peor resultado posible
 * - Los percentiles se calculan sobre la población de clientes
 */

/**
 * Calcula el percentil de un valor en un array
 * Usa interpolación lineal para valores entre índices
 */
export function percentile(values: number[], p: number): number {
  const cleaned = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (cleaned.length === 0) return 0;
  const rank = (p / 100) * (cleaned.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return cleaned[lower];
  const weight = rank - lower;
  return cleaned[lower] * (1 - weight) + cleaned[upper] * weight;
}

/**
 * Calcula el rango de percentil de un valor dentro de una distribución
 * Retorna un valor entre 0 y 1 indicando en qué percentil está el valor
 */
export function percentileRank(value: number, distribution: number[]): number {
  const cleaned = distribution.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (cleaned.length === 0) return 0.5; // Neutral si no hay datos
  if (!Number.isFinite(value)) return 0.5;
  
  let countBelow = 0;
  for (const v of cleaned) {
    if (v < value) countBelow++;
  }
  
  return countBelow / cleaned.length;
}

/**
 * Winsoriza un array de valores, limitando los extremos a percentiles P1 y P99
 * Esto reduce el impacto de outliers en el scoring
 */
export function winsorize(values: number[], pLow: number = 1, pHigh: number = 99): number[] {
  if (values.length === 0) return [];
  
  const lowerBound = percentile(values, pLow);
  const upperBound = percentile(values, pHigh);
  
  return values.map(v => {
    if (!Number.isFinite(v)) return v;
    if (v < lowerBound) return lowerBound;
    if (v > upperBound) return upperBound;
    return v;
  });
}

/**
 * Winsoriza un único valor dado los límites
 */
export function winsorizeValue(value: number, lowerBound: number, upperBound: number): number {
  if (!Number.isFinite(value)) return value;
  if (value < lowerBound) return lowerBound;
  if (value > upperBound) return upperBound;
  return value;
}

/**
 * Calcula la desviación estándar muestral (dividiendo por n-1)
 * Retorna 0 si hay menos de 2 valores
 */
export function sampleStdDev(values: number[]): number {
  const cleaned = values.filter((v) => Number.isFinite(v));
  if (cleaned.length < 2) return 0;
  
  const mean = cleaned.reduce((a, b) => a + b, 0) / cleaned.length;
  const sumSquaredDiffs = cleaned.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0);
  
  return Math.sqrt(sumSquaredDiffs / (cleaned.length - 1));
}

/**
 * Calcula el promedio de un array de números
 */
export function mean(values: number[]): number {
  const cleaned = values.filter((v) => Number.isFinite(v));
  if (cleaned.length === 0) return 0;
  return cleaned.reduce((a, b) => a + b, 0) / cleaned.length;
}

/**
 * Score por percentil para métricas donde "mayor es mejor" (ej: GM%, GM$)
 * Score = 100 * percentileRank(valor)
 * 
 * @param value El valor a convertir en score
 * @param distribution Distribución de valores de todos los clientes
 * @param winsorizedDistribution Distribución ya winsorizada (opcional)
 */
export function scoreHigherIsBetter(
  value: number, 
  distribution: number[],
  pLow: number = 1,
  pHigh: number = 99
): { score: number; percentileRank: number } {
  if (!Number.isFinite(value) || distribution.length === 0) {
    return { score: 50, percentileRank: 0.5 }; // Neutral
  }
  
  const lowerBound = percentile(distribution, pLow);
  const upperBound = percentile(distribution, pHigh);
  const winsorizedValue = winsorizeValue(value, lowerBound, upperBound);
  const winsorizedDist = winsorize(distribution, pLow, pHigh);
  
  const rank = percentileRank(winsorizedValue, winsorizedDist);
  return {
    score: Math.round(100 * rank),
    percentileRank: rank
  };
}

/**
 * Score por percentil para métricas donde "menor es mejor" (ej: DPD, Severidad, LateRate)
 * Score = 100 * (1 - percentileRank(valor))
 * 
 * @param value El valor a convertir en score
 * @param distribution Distribución de valores de todos los clientes
 */
export function scoreLowerIsBetter(
  value: number, 
  distribution: number[],
  pLow: number = 1,
  pHigh: number = 99
): { score: number; percentileRank: number } {
  if (!Number.isFinite(value) || distribution.length === 0) {
    return { score: 50, percentileRank: 0.5 }; // Neutral
  }
  
  const lowerBound = percentile(distribution, pLow);
  const upperBound = percentile(distribution, pHigh);
  const winsorizedValue = winsorizeValue(value, lowerBound, upperBound);
  const winsorizedDist = winsorize(distribution, pLow, pHigh);
  
  const rank = percentileRank(winsorizedValue, winsorizedDist);
  return {
    score: Math.round(100 * (1 - rank)),
    percentileRank: rank
  };
}

/**
 * Score por bandas (legacy - mantiene compatibilidad)
 * Divide en bandas por percentiles 20, 50, 80
 */
export function bandScore(value: number, bands: [number, number, number], invert = false): number {
  const [p20, p50, p80] = bands;
  if (!Number.isFinite(value)) return 50; // Neutral en lugar de 0
  
  const normalize = (v: number) => {
    if (v <= p20) return 20;
    if (v <= p50) return 50;
    if (v <= p80) return 80;
    return 100;
  };
  
  const score = normalize(value);
  return invert ? 100 - score : score;
}

/**
 * Formatea un número como porcentaje
 */
export function formatPercent(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Formatea un número como moneda USD
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

/**
 * Clamp un valor entre mínimo y máximo
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
