/**
 * Módulo de Métricas de Ventas Históricas (Bloque S)
 * Calcula métricas de tracción y score S
 */

import { 
  CustomerSalesYearRecord, 
  SalesHistoryMetrics, 
  SalesScoreComponents,
  SalesScoreWeights 
} from '../types';
import { 
  percentileRank, 
  winsorize, 
  sampleStdDev, 
  mean as calcMean,
  clamp 
} from '../utils/stats';

// =========================================================================
// CONFIGURACIÓN
// =========================================================================

const DEFAULT_WEIGHTS: SalesScoreWeights = {
  rev: 0.45,
  growth: 0.25,
  stability: 0.20,
  loyalty: 0.10
};

// =========================================================================
// CÁLCULO DE MÉTRICAS
// =========================================================================

/**
 * Construye métricas de ventas históricas para un cliente
 */
export function buildSalesHistoryMetrics(
  salesByYear: Record<number, number>,
  customerKey: string,
  includeCurrentYear: boolean = false
): SalesHistoryMetrics {
  const CURRENT_YEAR = new Date().getFullYear();
  
  // Definir los años a considerar según la configuración
  const YEARS_3Y = includeCurrentYear
    ? [CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR]
    : [CURRENT_YEAR - 3, CURRENT_YEAR - 2, CURRENT_YEAR - 1];
  
  const YEARS_5Y = includeCurrentYear
    ? [CURRENT_YEAR - 4, CURRENT_YEAR - 3, CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR]
    : [CURRENT_YEAR - 5, CURRENT_YEAR - 4, CURRENT_YEAR - 3, CURRENT_YEAR - 2, CURRENT_YEAR - 1];
  
  // Filtrar solo años válidos
  const years = Object.keys(salesByYear).map(Number).sort((a, b) => a - b);
  const hasData = years.length > 0 && Object.values(salesByYear).some(v => v > 0);

  if (!hasData) {
    return createEmptyMetrics(customerKey);
  }

  // Métricas de volumen
  const revLast3 = YEARS_3Y.reduce((sum, y) => sum + (salesByYear[y] || 0), 0);
  const revLast5 = YEARS_5Y.reduce((sum, y) => sum + (salesByYear[y] || 0), 0);
  const revLast12m = salesByYear[CURRENT_YEAR] || 0; // Aproximación con año actual

  // Ventas por año para cálculos
  const sales2025 = salesByYear[CURRENT_YEAR] || 0;
  const sales2024 = salesByYear[CURRENT_YEAR - 1] || 0;
  const sales2023 = salesByYear[CURRENT_YEAR - 2] || 0;
  const sales2022 = salesByYear[CURRENT_YEAR - 3] || 0;
  const sales2021 = salesByYear[CURRENT_YEAR - 4] || 0;

  // YoY 2025 vs 2024
  let yoy2025: number | null = null;
  if (sales2024 > 0 && sales2025 > 0) {
    yoy2025 = (sales2025 - sales2024) / sales2024;
  } else if (sales2024 > 0 && sales2025 === 0) {
    // Si año actual es cero, calcular YoY previo (2024 vs 2023)
    if (sales2023 > 0) {
      yoy2025 = (sales2024 - sales2023) / sales2023;
    }
  }

  // CAGR 3 años (2023 -> 2025)
  let cagr3y: number | null = null;
  if (sales2023 > 0 && sales2025 > 0) {
    cagr3y = Math.pow(sales2025 / sales2023, 1 / 2) - 1;
  } else if (sales2023 > 0 && sales2024 > 0 && sales2025 === 0) {
    // Si 2025 es cero, usar 2022-2024
    if (sales2022 > 0) {
      cagr3y = Math.pow(sales2024 / sales2022, 1 / 2) - 1;
    }
  }

  // CAGR 5 años (2021 -> 2025)
  let cagr5y: number | null = null;
  if (sales2021 > 0 && sales2025 > 0) {
    cagr5y = Math.pow(sales2025 / sales2021, 1 / 4) - 1;
  } else if (sales2021 > 0 && sales2024 > 0 && sales2025 === 0) {
    // Si 2025 es cero, usar 2021-2024
    cagr5y = Math.pow(sales2024 / sales2021, 1 / 3) - 1;
  }

  // Coeficiente de variación (últimos 5 años)
  const values5y = YEARS_5Y.map(y => salesByYear[y] || 0);
  const mean5y = calcMean(values5y);
  let cv5y: number | null = null;
  if (mean5y > 0) {
    const std5y = sampleStdDev(values5y);
    cv5y = std5y / mean5y;
  }

  // Años activos
  const activeYears5y = YEARS_5Y.filter(y => (salesByYear[y] || 0) > 0).length;
  const lastActiveYear = years.filter(y => salesByYear[y] > 0).pop() || 0;

  // Flags
  const isDormant = lastActiveYear <= CURRENT_YEAR - 2; // No vendió en 2024 ni 2025
  const firstActiveYear = years.find(y => salesByYear[y] > 0) || 0;
  const isNew = firstActiveYear >= CURRENT_YEAR - 1; // Primera venta en 2024+
  const isOneShot = activeYears5y === 1 && revLast5 > 0;
  const isGrowing = yoy2025 !== null && yoy2025 > 0.10;
  const isDeclining = yoy2025 !== null && yoy2025 < -0.10;

  return {
    customerKey,
    salesByYear,
    revLast3,
    revLast5,
    revLast12m,
    yoy2025,
    cagr3y,
    cagr5y,
    cv5y,
    activeYears5y,
    lastActiveYear,
    isDormant,
    isNew,
    isOneShot,
    isGrowing,
    isDeclining,
    hasData: true,
    evidenceLevel: activeYears5y >= 2 ? 'sufficient' : 'insufficient'
  };
}

function createEmptyMetrics(customerKey: string): SalesHistoryMetrics {
  return {
    customerKey,
    salesByYear: {},
    revLast3: 0,
    revLast5: 0,
    revLast12m: 0,
    yoy2025: null,
    cagr3y: null,
    cagr5y: null,
    cv5y: null,
    activeYears5y: 0,
    lastActiveYear: 0,
    isDormant: true,
    isNew: false,
    isOneShot: false,
    isGrowing: false,
    isDeclining: false,
    hasData: false,
    evidenceLevel: 'none'
  };
}

// =========================================================================
// DISTRIBUCIONES PARA SCORING
// =========================================================================

export interface SalesDistributions {
  revLast3: number[];
  growth: number[];       // yoy o cagr
  stability: number[];    // 1 - cv
  loyalty: number[];      // activeYears
}

/**
 * Construye distribuciones para percentiles
 */
export function buildSalesDistributions(
  allMetrics: SalesHistoryMetrics[]
): SalesDistributions {
  const withData = allMetrics.filter(m => m.hasData);

  return {
    revLast3: winsorize(withData.map(m => m.revLast3), 1, 99),
    growth: winsorize(
      withData
        .map(m => m.cagr3y ?? m.cagr5y ?? m.yoy2025 ?? 0)
        .filter(v => v !== null) as number[],
      1, 99
    ),
    stability: winsorize(
      withData
        .filter(m => m.cv5y !== null)
        .map(m => 1 - (m.cv5y ?? 0)), // Invertir: menos CV = más estable
      1, 99
    ),
    loyalty: withData.map(m => m.activeYears5y)
  };
}

// =========================================================================
// CÁLCULO DE SCORE S
// =========================================================================

/**
 * Calcula el score S y sus componentes para un cliente
 */
export function computeSalesScore(
  metrics: SalesHistoryMetrics,
  distributions: SalesDistributions,
  weights: SalesScoreWeights = DEFAULT_WEIGHTS
): { score: number; components: SalesScoreComponents } | null {
  if (!metrics.hasData) {
    return null;
  }

  // Score de volumen (higher is better)
  const revPercentile = percentileRank(metrics.revLast3, distributions.revLast3);
  const revScore = revPercentile * 100;

  // Score de crecimiento (higher is better)
  // Priorizar CAGR sobre YoY para mayor estabilidad, especialmente si el cliente tiene datos limitados
  const growthValue = metrics.cagr3y ?? metrics.cagr5y ?? metrics.yoy2025 ?? 0;
  const growthPercentile = distributions.growth.length > 0
    ? percentileRank(growthValue, distributions.growth)
    : 0.5; // Neutral si no hay datos
  const growthScore = growthPercentile * 100;

  // Score de estabilidad (higher is better, CV bajo = bueno)
  let stabilityPercentile = 0.5;
  let stabilityScore = 50;
  if (metrics.cv5y !== null) {
    const stabilityValue = 1 - metrics.cv5y;
    stabilityPercentile = distributions.stability.length > 0
      ? percentileRank(stabilityValue, distributions.stability)
      : 0.5;
    stabilityScore = stabilityPercentile * 100;
  }

  // Score de lealtad (activeYears)
  const loyaltyPercentile = percentileRank(metrics.activeYears5y, distributions.loyalty);
  const loyaltyScore = loyaltyPercentile * 100;

  // Score S combinado
  const totalWeight = weights.rev + weights.growth + weights.stability + weights.loyalty;
  const score = clamp(
    (weights.rev * revScore +
     weights.growth * growthScore +
     weights.stability * stabilityScore +
     weights.loyalty * loyaltyScore) / totalWeight,
    0,
    100
  );

  return {
    score,
    components: {
      revScore,
      revPercentile,
      growthScore,
      growthPercentile,
      stabilityScore,
      stabilityPercentile,
      loyaltyScore,
      loyaltyPercentile
    }
  };
}

/**
 * Procesa todos los clientes y calcula scores S
 */
export function scoreSalesHistory(
  salesRecords: CustomerSalesYearRecord[],
  weights: SalesScoreWeights = DEFAULT_WEIGHTS,
  includeCurrentYear: boolean = false
): Map<string, { metrics: SalesHistoryMetrics; score: number | null; components: SalesScoreComponents | null }> {
  // Agrupar por cliente normalizado
  const byCustomer = new Map<string, Record<number, number>>();
  
  for (const rec of salesRecords) {
    if (!byCustomer.has(rec.customerNameNorm)) {
      byCustomer.set(rec.customerNameNorm, {});
    }
    const years = byCustomer.get(rec.customerNameNorm)!;
    years[rec.year] = (years[rec.year] || 0) + rec.salesUsd;
  }

  // Calcular métricas para cada cliente
  const allMetrics: SalesHistoryMetrics[] = [];
  const metricsMap = new Map<string, SalesHistoryMetrics>();

  for (const [customerKey, salesByYear] of byCustomer) {
    const metrics = buildSalesHistoryMetrics(salesByYear, customerKey, includeCurrentYear);
    allMetrics.push(metrics);
    metricsMap.set(customerKey, metrics);
  }

  // Construir distribuciones
  const distributions = buildSalesDistributions(allMetrics);

  // Calcular scores
  const result = new Map<string, { 
    metrics: SalesHistoryMetrics; 
    score: number | null; 
    components: SalesScoreComponents | null 
  }>();

  for (const [customerKey, metrics] of metricsMap) {
    const scoreResult = computeSalesScore(metrics, distributions, weights);
    result.set(customerKey, {
      metrics,
      score: scoreResult?.score ?? null,
      components: scoreResult?.components ?? null
    });
  }

  return result;
}
