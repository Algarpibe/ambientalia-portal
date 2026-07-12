/**
 * MOTOR DE SCORING DE CLIENTES
 * 
 * Implementa el sistema completo de valoración histórica de clientes.
 * 
 * SCORES PRINCIPALES (0-100, mayor es mejor):
 * - V (Valor): Basado en rentabilidad
 *   V = 0.45*Score(GM%) + 0.35*Score(GM$) + 0.20*Score(MixMarginIndex)
 * 
 * - P (Pagos): Basado en comportamiento de pagos
 *   P = 0.35*Score(1-LateValueRate) + 0.35*Score(1-Sev) + 0.20*Score(1-AvgDPD) + 0.10*Score(1-Volatilidad)
 * 
 * - T (Total): Score combinado
 *   T = 0.55*V + 0.45*P
 * 
 * SCORING POR PERCENTILES:
 * - Métricas "mayor es mejor" (GM%, GM$): Score = 100 * Percentil(valor)
 * - Métricas "menor es mejor" (Sev, DPD, etc): Score = 100 * (1 - Percentil(valor))
 * - Winsorización P1-P99 para manejar outliers
 */

import {
  ClientProfile,
  PaymentBehaviorMetrics,
  ProfitabilityMetrics,
  ValueScoreComponents,
  PaymentScoreComponents,
  ScoreComponents,
  ScoreResult,
  ScoreDriver,
  ClientSegment,
  SegmentPolicy,
  ScoringConfig,
  DEFAULT_SCORING_CONFIG,
  ExtendedScoringConfig,
  DEFAULT_EXTENDED_CONFIG,
  ExtendedClientProfile,
  ExtendedScoreResult,
  SalesHistoryMetrics,
  SalesScoreComponents
} from '../types';
import { scoreHigherIsBetter, scoreLowerIsBetter, clamp, formatCurrency } from '../utils/stats';
import { applyGatingRules, applyExtendedGatingRules } from './gating';
import { generateActions, generateDriverMessages } from './actions';

// =========================================================================
// CONSTRUCCIÓN DE DISTRIBUCIONES PARA PERCENTILES
// =========================================================================

interface PopulationDistributions {
  // Rentabilidad
  gmPct: number[];
  gmAbs: number[];
  mixMarginIndex: number[];

  // Pagos
  lateValueRate: number[];
  severity: number[];
  avgDpd: number[];
  volatility: number[];
}

function buildDistributions(
  profitabilityMap: Map<string, ProfitabilityMetrics>,
  paymentsMap: Map<string, PaymentBehaviorMetrics>
): PopulationDistributions {
  const dist: PopulationDistributions = {
    gmPct: [],
    gmAbs: [],
    mixMarginIndex: [],
    lateValueRate: [],
    severity: [],
    avgDpd: [],
    volatility: []
  };

  for (const [, prof] of profitabilityMap) {
    if (prof.hasMinimumData) {
      dist.gmPct.push(prof.combined.gmPct);
      dist.gmAbs.push(prof.combined.gmAbs);
      dist.mixMarginIndex.push(prof.combined.mixMarginIndex);
    }
  }

  for (const [, pay] of paymentsMap) {
    if (pay.hasMinimumData) {
      dist.lateValueRate.push(pay.combined.lateValueRate);
      dist.severity.push(pay.combined.severity);
      dist.avgDpd.push(pay.combined.avgDpd);
      dist.volatility.push(pay.combined.volatility);
    }
  }

  return dist;
}

// =========================================================================
// CÁLCULO DE COMPONENTES DE SCORE
// =========================================================================

function computeValueComponents(
  profitability: ProfitabilityMetrics | null,
  dist: PopulationDistributions,
  config: ScoringConfig
): ValueScoreComponents {
  const p1 = config.winsorizeP1;
  const p99 = config.winsorizeP99;

  if (!profitability || !profitability.hasMinimumData) {
    return {
      gmPctScore: 50, gmPctPercentile: 0.5,
      gmAbsScore: 50, gmAbsPercentile: 0.5,
      mixMarginScore: 50, mixMarginPercentile: 0.5
    };
  }

  const gmPctResult = scoreHigherIsBetter(profitability.combined.gmPct, dist.gmPct, p1, p99);
  const gmAbsResult = scoreHigherIsBetter(profitability.combined.gmAbs, dist.gmAbs, p1, p99);
  const mixMarginResult = scoreHigherIsBetter(profitability.combined.mixMarginIndex, dist.mixMarginIndex, p1, p99);

  return {
    gmPctScore: gmPctResult.score,
    gmPctPercentile: gmPctResult.percentileRank,
    gmAbsScore: gmAbsResult.score,
    gmAbsPercentile: gmAbsResult.percentileRank,
    mixMarginScore: mixMarginResult.score,
    mixMarginPercentile: mixMarginResult.percentileRank
  };
}

function computePaymentComponents(
  payments: PaymentBehaviorMetrics | null,
  dist: PopulationDistributions,
  config: ScoringConfig
): PaymentScoreComponents {
  const p1 = config.winsorizeP1;
  const p99 = config.winsorizeP99;

  if (!payments || !payments.hasMinimumData) {
    return {
      lateValueRateScore: 50, lateValueRatePercentile: 0.5,
      severityScore: 50, severityPercentile: 0.5,
      avgDpdScore: 50, avgDpdPercentile: 0.5,
      volatilityScore: 50, volatilityPercentile: 0.5
    };
  }

  // Todas las métricas de pagos: menor es mejor
  const lateResult = scoreLowerIsBetter(payments.combined.lateValueRate, dist.lateValueRate, p1, p99);
  const sevResult = scoreLowerIsBetter(payments.combined.severity, dist.severity, p1, p99);
  const dpdResult = scoreLowerIsBetter(payments.combined.avgDpd, dist.avgDpd, p1, p99);
  const volResult = scoreLowerIsBetter(payments.combined.volatility, dist.volatility, p1, p99);

  return {
    lateValueRateScore: lateResult.score,
    lateValueRatePercentile: lateResult.percentileRank,
    severityScore: sevResult.score,
    severityPercentile: sevResult.percentileRank,
    avgDpdScore: dpdResult.score,
    avgDpdPercentile: dpdResult.percentileRank,
    volatilityScore: volResult.score,
    volatilityPercentile: volResult.percentileRank
  };
}

// =========================================================================
// CÁLCULO DE SCORES PRINCIPALES (V, P, T)
// =========================================================================

function computeValueScore(
  components: ValueScoreComponents,
  weights: ScoringConfig['valueWeights']
): number {
  const V =
    weights.gmPct * components.gmPctScore +
    weights.gmAbs * components.gmAbsScore +
    weights.mixMarginIndex * components.mixMarginScore;

  return clamp(Math.round(V), 0, 100);
}

function computePaymentScore(
  components: PaymentScoreComponents,
  weights: ScoringConfig['paymentWeights']
): number {
  const P =
    weights.lateValueRate * components.lateValueRateScore +
    weights.severity * components.severityScore +
    weights.avgDpd * components.avgDpdScore +
    weights.volatility * components.volatilityScore;

  return clamp(Math.round(P), 0, 100);
}

function computeTotalScore(
  valueScore: number,
  paymentScore: number,
  config: ScoringConfig
): number {
  const T = config.totalScoreValueWeight * valueScore + config.totalScorePaymentWeight * paymentScore;
  return clamp(Math.round(T), 0, 100);
}

// =========================================================================
// SEGMENTACIÓN
// =========================================================================

function determineSegment(
  valueScore: number,
  paymentScore: number,
  hasHighSeverityLock: boolean,
  hasMediumSeverityLock: boolean,
  thresholds: ScoringConfig['segmentThresholds'],
  useGatingForSegmentation: boolean
): ClientSegment {
  const safeThresholds = thresholds ?? DEFAULT_SCORING_CONFIG.segmentThresholds;
  const applyGating = useGatingForSegmentation ?? true;

  // Candado fuerte = Restringido
  if (applyGating && hasHighSeverityLock) {
    return 'Restringido';
  }

  if (paymentScore < safeThresholds.estandarMinPayment) {
    return 'Restringido';
  }

  // Premium: V>=threshold AND P>=threshold AND sin candados medianos
  if (valueScore >= safeThresholds.premiumMinValue &&
    paymentScore >= safeThresholds.premiumMinPayment &&
    (!applyGating || !hasMediumSeverityLock)) {
    return 'Premium';
  }

  // Valioso Condicionado: V>=threshold AND P>=threshold (pero no califica Premium)
  if (valueScore >= safeThresholds.condicionadoMinValue &&
    paymentScore >= safeThresholds.condicionadoMinPayment) {
    return 'Valioso Condicionado';
  }

  // Estándar: V>=threshold AND P>=threshold (pero no califica Condicionado)
  if (valueScore >= safeThresholds.estandarMinValue &&
    paymentScore >= safeThresholds.estandarMinPayment) {
    return 'Estándar';
  }

  // Por defecto: Restringido
  return 'Restringido';
}

function getSegmentExplanation(segment: ClientSegment): string {
  switch (segment) {
    case 'Premium':
      return 'Cliente de alto valor con excelente comportamiento de pagos. Elegible para máximos beneficios.';
    case 'Valioso Condicionado':
      return 'Cliente de alto valor pero con pagos que requieren monitoreo. Beneficios condicionados a mejora.';
    case 'Estándar':
      return 'Cliente con rentabilidad y pagos dentro del promedio. Condiciones comerciales estándar.';
    case 'Restringido':
      return 'Cliente con riesgo elevado o candados activos. Beneficios restringidos hasta regularización.';
  }
}

function getSegmentPolicy(segment: ClientSegment, creditBlocked: boolean, discountBlocked: boolean): SegmentPolicy {
  switch (segment) {
    case 'Premium':
      return {
        segment,
        creditPolicy: 'full',
        creditDescription: 'Crédito completo (30-60 días). Límite ampliado.',
        discountPolicy: 'high',
        discountDescription: 'Descuentos máximos disponibles (hasta 15-20%).',
        servicePriority: 'high',
        priorityDescription: 'Prioridad máxima en servicio y mantenimiento.'
      };
    case 'Valioso Condicionado':
      return {
        segment,
        creditPolicy: creditBlocked ? 'limited' : 'full',
        creditDescription: creditBlocked
          ? 'Crédito limitado (15-30 días). No ampliar hasta regularizar.'
          : 'Crédito estándar (30 días). Monitoreo mensual.',
        discountPolicy: discountBlocked ? 'medium' : 'high',
        discountDescription: discountBlocked
          ? 'Descuentos medios (hasta 10%). Sin incrementos adicionales.'
          : 'Descuentos altos disponibles con seguimiento.',
        servicePriority: 'medium',
        priorityDescription: 'Prioridad media en servicio. Respuesta en 48-72h.'
      };
    case 'Estándar':
      return {
        segment,
        creditPolicy: 'limited',
        creditDescription: 'Crédito estándar (15-30 días). Límite conservador.',
        discountPolicy: 'medium',
        discountDescription: 'Descuentos estándar (5-10%).',
        servicePriority: 'medium',
        priorityDescription: 'Prioridad media en servicio.'
      };
    case 'Restringido':
      return {
        segment,
        creditPolicy: creditBlocked ? 'prepay' : '50-50',
        creditDescription: creditBlocked
          ? 'Solo prepago. Sin crédito hasta regularización.'
          : 'Esquema 50-50 (50% anticipo, 50% contra entrega).',
        discountPolicy: 'none',
        discountDescription: 'Sin descuentos adicionales. Precio de lista.',
        servicePriority: 'low',
        priorityDescription: 'Prioridad baja. Servicio según disponibilidad.'
      };
  }
}

// =========================================================================
// DRIVERS (EXPLICACIÓN DEL SCORE)
// =========================================================================

function computeDrivers(
  valueComponents: ValueScoreComponents,
  paymentComponents: PaymentScoreComponents,
  profitability: ProfitabilityMetrics | null,
  payments: PaymentBehaviorMetrics | null,
  config: ScoringConfig
): { positive: ScoreDriver[]; negative: ScoreDriver[] } {
  const drivers: ScoreDriver[] = [];
  const vw = config.valueWeights;
  const pw = config.paymentWeights;

  // Drivers de valor
  if (profitability?.hasMinimumData) {
    const gmPctContrib = vw.gmPct * valueComponents.gmPctScore;
    drivers.push({
      metric: 'Margen Bruto %',
      value: profitability.combined.gmPct,
      impact: valueComponents.gmPctScore >= 60 ? 'positive' : valueComponents.gmPctScore < 40 ? 'negative' : 'neutral',
      contribution: gmPctContrib,
      explanation: `Margen del ${profitability.combined.gmPct.toFixed(1)}% (percentil ${(valueComponents.gmPctPercentile * 100).toFixed(0)})`
    });

    const gmAbsContrib = vw.gmAbs * valueComponents.gmAbsScore;
    drivers.push({
      metric: 'Margen Bruto $',
      value: profitability.combined.gmAbs,
      impact: valueComponents.gmAbsScore >= 60 ? 'positive' : valueComponents.gmAbsScore < 40 ? 'negative' : 'neutral',
      contribution: gmAbsContrib,
      explanation: `Margen absoluto de ${formatCurrency(profitability.combined.gmAbs)}`
    });

    const mixContrib = vw.mixMarginIndex * valueComponents.mixMarginScore;
    drivers.push({
      metric: 'Mix de Productos',
      value: profitability.combined.mixMarginIndex,
      impact: valueComponents.mixMarginScore >= 60 ? 'positive' : valueComponents.mixMarginScore < 40 ? 'negative' : 'neutral',
      contribution: mixContrib,
      explanation: `${(profitability.combined.mixMarginIndex * 100).toFixed(1)}% en productos de alto margen`
    });
  }

  // Drivers de pagos
  if (payments?.hasMinimumData) {
    const lateContrib = pw.lateValueRate * paymentComponents.lateValueRateScore;
    drivers.push({
      metric: 'Tasa de Mora',
      value: 1 - payments.combined.lateValueRate,
      impact: paymentComponents.lateValueRateScore >= 60 ? 'positive' : paymentComponents.lateValueRateScore < 40 ? 'negative' : 'neutral',
      contribution: lateContrib,
      explanation: `${(payments.combined.lateValueRate * 100).toFixed(1)}% del valor facturado en mora`
    });

    const sevContrib = pw.severity * paymentComponents.severityScore;
    drivers.push({
      metric: 'Severidad de Mora',
      value: payments.combined.severity,
      impact: paymentComponents.severityScore >= 60 ? 'positive' : paymentComponents.severityScore < 40 ? 'negative' : 'neutral',
      contribution: sevContrib,
      explanation: `Severidad promedio de ${payments.combined.severity.toFixed(1)} días`
    });

    const dpdContrib = pw.avgDpd * paymentComponents.avgDpdScore;
    drivers.push({
      metric: 'Promedio DPD',
      value: payments.combined.avgDpd,
      impact: paymentComponents.avgDpdScore >= 60 ? 'positive' : paymentComponents.avgDpdScore < 40 ? 'negative' : 'neutral',
      contribution: dpdContrib,
      explanation: `Promedio de ${payments.combined.avgDpd.toFixed(1)} días de mora`
    });

    const volContrib = pw.volatility * paymentComponents.volatilityScore;
    drivers.push({
      metric: 'Volatilidad de Pagos',
      value: payments.combined.volatility,
      impact: paymentComponents.volatilityScore >= 60 ? 'positive' : paymentComponents.volatilityScore < 40 ? 'negative' : 'neutral',
      contribution: volContrib,
      explanation: `Desviación estándar de ${payments.combined.volatility.toFixed(1)} días`
    });
  }

  // Separar positivos y negativos, ordenar por contribución
  const positive = drivers
    .filter(d => d.impact === 'positive')
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);

  const negative = drivers
    .filter(d => d.impact === 'negative')
    .sort((a, b) => a.contribution - b.contribution)
    .slice(0, 3);

  return { positive, negative };
}

// =========================================================================
// VALIDACIÓN Y CALIDAD DE DATOS
// =========================================================================

function assessDataQuality(
  profitability: ProfitabilityMetrics | null,
  payments: PaymentBehaviorMetrics | null
): { quality: 'high' | 'medium' | 'low' | 'insufficient'; warnings: string[] } {
  const warnings: string[] = [];

  const profSufficient = profitability?.hasMinimumData ?? false;
  const paySufficient = payments?.hasMinimumData ?? false;

  if (!profSufficient && profitability?.evidenceLevel === 'insufficient') {
    warnings.push(`Evidencia insuficiente de rentabilidad (${profitability?.period12m.orderCount ?? 0} órdenes en 12m)`);
  }
  if (!paySufficient && payments?.evidenceLevel === 'insufficient') {
    warnings.push(`Evidencia insuficiente de pagos (${payments?.period12m.invoiceCount ?? 0} facturas en 12m)`);
  }
  if (!profitability || profitability.evidenceLevel === 'none') {
    warnings.push('Sin datos de rentabilidad');
  }
  if (!payments || payments.evidenceLevel === 'none') {
    warnings.push('Sin datos de pagos');
  }

  let quality: 'high' | 'medium' | 'low' | 'insufficient';
  if (profSufficient && paySufficient) {
    quality = 'high';
  } else if (profSufficient || paySufficient) {
    quality = 'medium';
  } else if ((profitability?.evidenceLevel === 'insufficient') || (payments?.evidenceLevel === 'insufficient')) {
    quality = 'low';
  } else {
    quality = 'insufficient';
  }

  return { quality, warnings };
}

// =========================================================================
// SCORING PRINCIPAL
// =========================================================================

function computeScoresForClient(
  clientKey: string,
  profitability: ProfitabilityMetrics | null,
  payments: PaymentBehaviorMetrics | null,
  dist: PopulationDistributions,
  config: ScoringConfig
): ScoreResult {
  // 1. Calcular componentes
  const valueComponents = computeValueComponents(profitability, dist, config);
  const paymentComponents = computePaymentComponents(payments, dist, config);

  // 2. Calcular scores principales
  const valueScore = computeValueScore(valueComponents, config.valueWeights);
  const paymentScore = computePaymentScore(paymentComponents, config.paymentWeights);
  const totalScore = computeTotalScore(valueScore, paymentScore, config);

  // 3. Aplicar gating
  const gating = applyGatingRules(profitability, payments, config);

  // 4. Determinar segmento y política
  const segment = determineSegment(
    valueScore,
    paymentScore,
    gating.hasHighSeverityLock,
    gating.hasMediumSeverityLock,
    config.segmentThresholds,
    config.useGatingForSegmentation
  );
  const segmentExplanation = getSegmentExplanation(segment);
  const policy = getSegmentPolicy(segment, gating.creditBlocked, gating.discountBlocked);

  // 5. Calcular drivers
  const { positive, negative } = computeDrivers(valueComponents, paymentComponents, profitability, payments, config);

  // 6. Generar acciones
  const actions = generateActions(valueScore, paymentScore, profitability, payments, gating);

  // 7. Evaluar calidad de datos
  const { quality, warnings } = assessDataQuality(profitability, payments);

  // 8. Calcular componentes legacy
  const legacyComponents: ScoreComponents = {
    revenueScore: valueComponents.gmAbsScore,
    marginScore: valueComponents.gmPctScore,
    recencyWeightedDpdScore: paymentComponents.avgDpdScore,
    recencyOverdueRateScore: paymentComponents.lateValueRateScore,
    dpdP95Score: paymentComponents.severityScore,
    overdueBalanceScore: paymentComponents.volatilityScore
  };

  // Mapear segmento a quadrant legacy
  const quadrantMap: Record<ClientSegment, ScoreResult['quadrant']> = {
    'Premium': 'Max Beneficios',
    'Valioso Condicionado': 'Condicionado',
    'Estándar': 'Estandar',
    'Restringido': 'Restringido'
  };

  return {
    valueScore,
    paymentScore,
    totalScore,
    valueComponents,
    paymentComponents,
    segment,
    segmentExplanation,
    policy,
    gating,
    topPositiveDrivers: positive,
    topNegativeDrivers: negative,
    actions,
    dataQuality: quality,
    warnings,
    // Legacy fields
    value: valueScore,
    risk: 100 - paymentScore,
    total: totalScore,
    quadrant: quadrantMap[segment],
    maxBenefitTier: gating.maxBenefitTier,
    flags: gating.locks.map(l => l.description),
    drivers: generateDriverMessages(valueComponents, paymentComponents, profitability, payments),
    riskBand: paymentScore >= 60 ? 'Bajo Riesgo' : 'Alto Riesgo',
    components: legacyComponents
  };
}

// =========================================================================
// API PÚBLICA
// =========================================================================

/**
 * Calcula scores para todos los clientes
 */
export function scoreClients(
  profiles: Map<string, { profitability: ProfitabilityMetrics | null; payments: PaymentBehaviorMetrics | null; displayName: string }>,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): ClientProfile[] {
  // Construir mapas de métricas
  const profitabilityMap = new Map<string, ProfitabilityMetrics>();
  const paymentsMap = new Map<string, PaymentBehaviorMetrics>();

  for (const [key, value] of profiles.entries()) {
    if (value.profitability) profitabilityMap.set(key, value.profitability);
    if (value.payments) paymentsMap.set(key, value.payments);
  }

  // Construir distribuciones para percentiles
  const dist = buildDistributions(profitabilityMap, paymentsMap);

  // Calcular scores para cada cliente
  const result: ClientProfile[] = [];
  for (const [key, value] of profiles.entries()) {
    const scores = computeScoresForClient(key, value.profitability, value.payments, dist, config);

    // Quick metrics para tabla
    const quickMetrics = {
      salesTotal: value.profitability?.period12m.salesTotal ?? 0,
      gmPct: value.profitability?.combined.gmPct ?? 0,
      gmAbs: value.profitability?.combined.gmAbs ?? 0,
      lateValueRate: value.payments?.combined.lateValueRate ?? 0,
      severity: value.payments?.combined.severity ?? 0,
      avgDpd: value.payments?.combined.avgDpd ?? 0
    };

    result.push({
      clientKey: key,
      displayName: value.displayName,
      profitability: value.profitability,
      payments: value.payments,
      scores,
      quickMetrics
    });
  }

  // Ordenar por score total descendente
  return result.sort((a, b) => (b.scores?.totalScore ?? 0) - (a.scores?.totalScore ?? 0));
}
// =========================================================================
// SCORING EXTENDIDO (CON SCORE S)
// =========================================================================

interface SalesDistributions {
  revLast3: number[];
  yoy: number[];
  cagr: number[];
  cv: number[];
  activeYears: number[];
}

function buildSalesDistributions(
  salesMap: Map<string, SalesHistoryMetrics>
): SalesDistributions {
  const dist: SalesDistributions = {
    revLast3: [],
    yoy: [],
    cagr: [],
    cv: [],
    activeYears: []
  };

  for (const [, sales] of salesMap) {
    if (sales.evidenceLevel === 'sufficient') {
      dist.revLast3.push(sales.revLast3);
      if (sales.yoy2025 !== null) dist.yoy.push(sales.yoy2025);
      if (sales.cagr3y !== null) dist.cagr.push(sales.cagr3y);
      if (sales.cv5y !== null) dist.cv.push(sales.cv5y);
      dist.activeYears.push(sales.activeYears5y);
    }
  }

  return dist;
}

function computeSalesComponents(
  salesMetrics: SalesHistoryMetrics | null,
  dist: SalesDistributions,
  config: ExtendedScoringConfig
): SalesScoreComponents | null {
  const p1 = config.winsorizeP1;
  const p99 = config.winsorizeP99;

  if (!salesMetrics || salesMetrics.evidenceLevel === 'none') {
    return null;
  }

  // Revenue: mayor es mejor
  const revResult = scoreHigherIsBetter(salesMetrics.revLast3, dist.revLast3, p1, p99);

  // Growth (yoy o cagr): mayor es mejor - usamos yoy si existe, sino cagr
  let growthScore = 50;
  let growthPercentile = 0.5;
  if (salesMetrics.yoy2025 !== null && dist.yoy.length > 0) {
    const growthResult = scoreHigherIsBetter(salesMetrics.yoy2025, dist.yoy, p1, p99);
    growthScore = growthResult.score;
    growthPercentile = growthResult.percentileRank;
  } else if (salesMetrics.cagr3y !== null && dist.cagr.length > 0) {
    const cagrResult = scoreHigherIsBetter(salesMetrics.cagr3y, dist.cagr, p1, p99);
    growthScore = cagrResult.score;
    growthPercentile = cagrResult.percentileRank;
  }

  // Stability (1-CV): menor CV es mejor
  const stabilityResult = salesMetrics.cv5y !== null
    ? scoreLowerIsBetter(salesMetrics.cv5y, dist.cv, p1, p99)
    : { score: 50, percentileRank: 0.5 };

  // Loyalty (activeYears): mayor es mejor
  const loyaltyResult = scoreHigherIsBetter(salesMetrics.activeYears5y, dist.activeYears, p1, p99);

  return {
    revScore: revResult.score,
    revPercentile: revResult.percentileRank,
    growthScore,
    growthPercentile,
    stabilityScore: stabilityResult.score,
    stabilityPercentile: stabilityResult.percentileRank,
    loyaltyScore: loyaltyResult.score,
    loyaltyPercentile: loyaltyResult.percentileRank
  };
}

function computeSalesScore(
  components: SalesScoreComponents | null,
  weights: ExtendedScoringConfig['salesWeights']
): number | null {
  if (!components) return null;

  const S =
    weights.rev * components.revScore +
    weights.growth * components.growthScore +
    weights.stability * components.stabilityScore +
    weights.loyalty * components.loyaltyScore;

  return clamp(Math.round(S), 0, 100);
}

function computeTotalScoreExtended(
  valueScore: number,
  paymentScore: number,
  salesScore: number | null,
  config: ExtendedScoringConfig
): number {
  const weights = config.totalScoreWeightsExtended;

  // Si el modo es Extendido Y tenemos Score S, usamos la fórmula de 3 componentes (V, P, S)
  if (config.scoringMode === 'extended' && salesScore !== null) {
    // T = wV*V + wP*P + wS*S (donde wV+wP+wS = 1.0)
    const T = weights.value * valueScore + weights.payment * paymentScore + weights.sales * salesScore;
    return clamp(Math.round(T), 0, 100);
  } else {
    // Si el modo es Estándar o no hay Score S, usamos la fórmula base (V, P)
    // T = wV_base*V + wP_base*P (donde wV_base + wP_base = 1.0)
    const T = config.totalScoreValueWeight * valueScore + config.totalScorePaymentWeight * paymentScore;
    return clamp(Math.round(T), 0, 100);
  }
}

function computeExtendedScoresForClient(
  clientKey: string,
  profitability: ProfitabilityMetrics | null,
  payments: PaymentBehaviorMetrics | null,
  salesHistory: SalesHistoryMetrics | null,
  dist: PopulationDistributions,
  salesDist: SalesDistributions,
  config: ExtendedScoringConfig
): ExtendedScoreResult {
  // Get base score result
  const baseResult = computeScoresForClient(clientKey, profitability, payments, dist, config);

  // Compute sales components and score
  const salesComponents = computeSalesComponents(salesHistory, salesDist, config);
  const salesScore = computeSalesScore(salesComponents, config.salesWeights);

  // Recalculate total score with S
  const totalScore = computeTotalScoreExtended(
    baseResult.valueScore,
    baseResult.paymentScore,
    salesScore,
    config
  );

  // Apply extended gating rules (includes dormant check)
  const extendedGating = applyExtendedGatingRules(profitability, payments, salesHistory, config);

  // Redetermine segment with extended data
  const segment = determineSegmentExtended(
    baseResult.valueScore,
    baseResult.paymentScore,
    salesScore,
    extendedGating.hasHighSeverityLock,
    extendedGating.hasMediumSeverityLock,
    salesHistory?.isDormant ?? false,
    config.segmentThresholds,
    config.useGatingForSegmentation
  );

  return {
    ...baseResult,
    totalScore,
    segment,
    segmentExplanation: getSegmentExplanation(segment),
    policy: getSegmentPolicy(segment, extendedGating.creditBlocked, extendedGating.discountBlocked),
    gating: extendedGating,
    salesScore,
    salesComponents,
    salesMetrics: salesHistory
  };
}

function determineSegmentExtended(
  valueScore: number,
  paymentScore: number,
  salesScore: number | null,
  hasHighSeverityLock: boolean,
  hasMediumSeverityLock: boolean,
  isDormant: boolean,
  thresholds: ScoringConfig['segmentThresholds'],
  useGatingForSegmentation: boolean
): ClientSegment {
  const safeThresholds = thresholds ?? DEFAULT_SCORING_CONFIG.segmentThresholds;
  const applyGating = useGatingForSegmentation ?? true;

  // Candado fuerte o dormant = Restringido (solo si gating está habilitado)
  if (applyGating && (hasHighSeverityLock || isDormant)) {
    return 'Restringido';
  }

  if (paymentScore < safeThresholds.estandarMinPayment) {
    return 'Restringido';
  }

  // Usar solo V (no combinar con S) para determinar segmento
  // S es solo informativo y se usa para Score Total T, no para segmentación

  // Premium: V>=threshold AND P>=threshold AND sin candados medianos
  if (valueScore >= safeThresholds.premiumMinValue &&
    paymentScore >= safeThresholds.premiumMinPayment &&
    (!applyGating || !hasMediumSeverityLock)) {
    return 'Premium';
  }

  // Valioso Condicionado: V>=threshold AND P>=threshold (pero no califica Premium)
  if (valueScore >= safeThresholds.condicionadoMinValue &&
    paymentScore >= safeThresholds.condicionadoMinPayment) {
    return 'Valioso Condicionado';
  }

  // Estándar: V>=threshold AND P>=threshold (pero no califica Condicionado)
  if (valueScore >= safeThresholds.estandarMinValue &&
    paymentScore >= safeThresholds.estandarMinPayment) {
    return 'Estándar';
  }

  // Por defecto: Restringido
  return 'Restringido';
}

/**
 * Calcula scores extendidos para todos los clientes (con Score S)
 */
export function scoreClientsExtended(
  profiles: Map<string, {
    profitability: ProfitabilityMetrics | null;
    payments: PaymentBehaviorMetrics | null;
    salesHistory: SalesHistoryMetrics | null;
    displayName: string
  }>,
  config: ExtendedScoringConfig = DEFAULT_EXTENDED_CONFIG
): ExtendedClientProfile[] {
  // Construir mapas de métricas
  const profitabilityMap = new Map<string, ProfitabilityMetrics>();
  const paymentsMap = new Map<string, PaymentBehaviorMetrics>();
  const salesMap = new Map<string, SalesHistoryMetrics>();

  for (const [key, value] of profiles.entries()) {
    if (value.profitability) profitabilityMap.set(key, value.profitability);
    if (value.payments) paymentsMap.set(key, value.payments);
    if (value.salesHistory) salesMap.set(key, value.salesHistory);
  }

  // Construir distribuciones para percentiles
  const dist = buildDistributions(profitabilityMap, paymentsMap);
  const salesDist = buildSalesDistributions(salesMap);

  // Calcular scores para cada cliente
  const result: ExtendedClientProfile[] = [];
  for (const [key, value] of profiles.entries()) {
    const scores = computeExtendedScoresForClient(
      key,
      value.profitability,
      value.payments,
      value.salesHistory,
      dist,
      salesDist,
      config
    );

    // Quick metrics para tabla
    const quickMetrics = {
      salesTotal: value.profitability?.period12m.salesTotal ?? 0,
      gmPct: value.profitability?.combined.gmPct ?? 0,
      gmAbs: value.profitability?.combined.gmAbs ?? 0,
      lateValueRate: value.payments?.combined.lateValueRate ?? 0,
      severity: value.payments?.combined.severity ?? 0,
      avgDpd: value.payments?.combined.avgDpd ?? 0,
      // Extended metrics
      revLast3: value.salesHistory?.revLast3 ?? 0,
      yoy: value.salesHistory?.yoy2025 ?? null,
      activeYears: value.salesHistory?.activeYears5y ?? 0
    };

    result.push({
      clientKey: key,
      displayName: value.displayName,
      profitability: value.profitability,
      payments: value.payments,
      salesHistory: value.salesHistory,
      costToServe: null, // Future
      customerMap: null, // Set by aggregator if needed
      scores,
      quickMetrics
    });
  }

  // Ordenar por score total descendente
  return result.sort((a, b) => (b.scores?.totalScore ?? 0) - (a.scores?.totalScore ?? 0));
}