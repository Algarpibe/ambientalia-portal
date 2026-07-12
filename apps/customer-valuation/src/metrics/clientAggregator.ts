/**
 * AGREGADOR DE CLIENTES
 * 
 * Combina datos de ventas, costos, facturas y pagos para construir
 * perfiles completos de cliente con métricas de rentabilidad,
 * pagos, ventas históricas y scores de valoración.
 * 
 * SOPORTA:
 * - Source A: Ventas Históricas (Score S)
 * - Source B: Rentabilidad (Score V)
 * - Source C: Pagos (Score P)
 * - Source D: Cost-to-Serve (Futuro)
 */

import { joinInvoicesAndPayments, buildPaymentMetrics } from './payments';
import { buildProfitabilityMetrics } from './profitability';
import { scoreSalesHistory } from './salesHistory';
import {
  ClientProfile,
  PaymentBehaviorMetrics,
  ProfitabilityMetrics,
  SalesRecord,
  InvoiceRecord,
  PaymentRecord,
  MasterCostRecord,
  ScoringConfig,
  DEFAULT_SCORING_CONFIG,
  CustomerSalesYearRecord,
  ExtendedClientProfile,
  ExtendedScoringConfig,
  DEFAULT_EXTENDED_CONFIG,
  SalesHistoryMetrics,
  SalesScoreComponents
} from '../types';
import { scoreClients, scoreClientsExtended } from '../scoring/scoreEngine';
import { groupByCustomer } from '../parsers/salesHistory';
import { matchAllCustomers } from '../matching/matchingEngine';

/**
 * Agrega todos los datos de un cliente y produce perfiles completos con scores
 */
export function aggregateClients(
  sales: SalesRecord[],
  master: MasterCostRecord[],
  invoices: InvoiceRecord[],
  payments: PaymentRecord[],
  today = new Date(),
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): ClientProfile[] {
  // Construir métricas de rentabilidad por cliente
  const profitability = buildProfitabilityMetrics(sales, master, config, today);

  // Unir facturas con pagos y construir métricas de pagos
  const invoiceJoins = joinInvoicesAndPayments(invoices, payments, today);
  const paymentMetrics = buildPaymentMetrics(invoiceJoins, config, today);

  // Construir mapa de nombres de display
  const displayNameByKey = new Map<string, string>();
  sales.forEach((s) => {
    if (!displayNameByKey.has(s.clientKey)) displayNameByKey.set(s.clientKey, s.cliente);
  });
  invoices.forEach((i) => {
    if (!displayNameByKey.has(i.clientKey)) displayNameByKey.set(i.clientKey, i.cliente);
  });
  payments.forEach((p) => {
    if (!displayNameByKey.has(p.clientKey)) displayNameByKey.set(p.clientKey, p.cliente);
  });

  // Combinar datos de todos los clientes
  const combined = new Map<
    string,
    { profitability: ProfitabilityMetrics | null; payments: PaymentBehaviorMetrics | null; displayName: string }
  >();

  const keys = new Set<string>([
    ...profitability.keys(),
    ...paymentMetrics.keys(),
    ...displayNameByKey.keys()
  ]);

  keys.forEach((key) => {
    combined.set(key, {
      profitability: profitability.get(key) ?? null,
      payments: paymentMetrics.get(key) ?? null,
      displayName: displayNameByKey.get(key) ?? key
    });
  });

  // Calcular scores y retornar perfiles completos
  return scoreClients(combined, config);
}

/**
 * Recalcula scores para un subconjunto de clientes
 * Útil para re-scoring después de cambiar configuración
 */
export function rescoreClients(
  profiles: ClientProfile[],
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): ClientProfile[] {
  const combined = new Map<
    string,
    { profitability: ProfitabilityMetrics | null; payments: PaymentBehaviorMetrics | null; displayName: string }
  >();

  profiles.forEach(p => {
    combined.set(p.clientKey, {
      profitability: p.profitability,
      payments: p.payments,
      displayName: p.displayName
    });
  });

  return scoreClients(combined, config);
}

/**
 * Obtiene estadísticas resumidas de la población de clientes
 */
export function getPopulationStats(profiles: ClientProfile[]): {
  totalClients: number;
  bySegment: Record<string, number>;
  byDataQuality: Record<string, number>;
  avgValueScore: number;
  avgPaymentScore: number;
  avgTotalScore: number;
  clientsWithLocks: number;
} {
  const bySegment: Record<string, number> = {
    'Premium': 0,
    'Valioso Condicionado': 0,
    'Estándar': 0,
    'Restringido': 0
  };

  const byDataQuality: Record<string, number> = {
    'high': 0,
    'medium': 0,
    'low': 0,
    'insufficient': 0
  };

  let sumValue = 0;
  let sumPayment = 0;
  let sumTotal = 0;
  let clientsWithLocks = 0;
  let countWithScores = 0;

  profiles.forEach(p => {
    if (p.scores) {
      bySegment[p.scores.segment] = (bySegment[p.scores.segment] || 0) + 1;
      byDataQuality[p.scores.dataQuality] = (byDataQuality[p.scores.dataQuality] || 0) + 1;
      sumValue += p.scores.valueScore;
      sumPayment += p.scores.paymentScore;
      sumTotal += p.scores.totalScore;
      countWithScores++;
      if (p.scores.gating.locks.length > 0) clientsWithLocks++;
    }
  });

  return {
    totalClients: profiles.length,
    bySegment,
    byDataQuality,
    avgValueScore: countWithScores > 0 ? sumValue / countWithScores : 0,
    avgPaymentScore: countWithScores > 0 ? sumPayment / countWithScores : 0,
    avgTotalScore: countWithScores > 0 ? sumTotal / countWithScores : 0,
    clientsWithLocks
  };
}
// =========================================================================
// AGREGACIÓN EXTENDIDA (CON SCORE S)
// =========================================================================

/**
 * Agrega todos los datos incluyendo ventas históricas (Score S)
 * Retorna perfiles extendidos con Score S, V, P, T
 */
export function aggregateClientsExtended(
  sales: SalesRecord[],
  master: MasterCostRecord[],
  invoices: InvoiceRecord[],
  payments: PaymentRecord[],
  salesHistory: CustomerSalesYearRecord[],
  manualMatches: Map<string, string> = new Map(),
  today = new Date(),
  config: ExtendedScoringConfig = DEFAULT_EXTENDED_CONFIG
): ExtendedClientProfile[] {
  // 1. Construir métricas de rentabilidad por cliente
  const profitability = buildProfitabilityMetrics(sales, master, config, today);

  // 2. Unir facturas con pagos y construir métricas de pagos
  const invoiceJoins = joinInvoicesAndPayments(invoices, payments, today);
  const paymentMetrics = buildPaymentMetrics(invoiceJoins, config, today);

  // 3. Calcular métricas y scores de ventas históricas (Score S)
  // scoreSalesHistory se encarga de agrupar y calcular scores
  const salesHistoryScored = scoreSalesHistory(
    salesHistory, 
    config.salesWeights, 
    config.includeCurrentYearInHistory
  );

  // 5. Construir mapa de nombres de display
  const displayNameByKey = new Map<string, string>();
  sales.forEach((s) => {
    if (!displayNameByKey.has(s.clientKey)) displayNameByKey.set(s.clientKey, s.cliente);
  });
  invoices.forEach((i) => {
    if (!displayNameByKey.has(i.clientKey)) displayNameByKey.set(i.clientKey, i.cliente);
  });
  payments.forEach((p) => {
    if (!displayNameByKey.has(p.clientKey)) displayNameByKey.set(p.clientKey, p.cliente);
  });

  // 6. Match customers across sources
  const existingClientKeys = new Set([
    ...profitability.keys(),
    ...paymentMetrics.keys(),
    ...displayNameByKey.keys()
  ]);

  // Build candidates from existing keys
  const candidates: Array<{ customerId: string; customerName: string; customerNameNorm: string }> =
    Array.from(existingClientKeys).map(key => ({
      customerId: key,
      customerName: displayNameByKey.get(key) || key,
      customerNameNorm: key // The keys are already normalized by aggregateClients
    }));

  const salesHistoryCustomers = Array.from(salesHistoryScored.keys());

  // Perform matching
  const matchResult = matchAllCustomers(salesHistoryCustomers, candidates, {
    manualMappings: manualMatches,
    fuzzyThreshold: 0.85 // Lower threshold for better matching
  });

  // Build a map: normalized name -> resolved clientKey (or itself if unmatched)
  const matchByNormName = new Map<string, string>();
  for (const record of matchResult.records) {
    matchByNormName.set(record.customerNameNorm, record.customerId ?? record.customerNameNorm);
  }

  const salesHistoryScoredByClientKey = new Map<string, { metrics: SalesHistoryMetrics; score: number | null; components: SalesScoreComponents | null }>();

  for (const [normName, data] of salesHistoryScored.entries()) {
    const matchedKey = matchByNormName.get(normName) ?? normName;
    salesHistoryScoredByClientKey.set(matchedKey, data);

    if (!displayNameByKey.has(matchedKey)) {
      displayNameByKey.set(matchedKey, data.metrics.customerKey || normName);
    }
    existingClientKeys.add(matchedKey);
  }

  // 7. Combinar datos de todos los clientes
  const combined = new Map<
    string,
    {
      profitability: ProfitabilityMetrics | null;
      payments: PaymentBehaviorMetrics | null;
      salesHistory: SalesHistoryMetrics | null;
      salesScore: number | null;
      salesComponents: SalesScoreComponents | null;
      displayName: string
    }
  >();

  existingClientKeys.forEach((key) => {
    const sData = salesHistoryScoredByClientKey.get(key);
    combined.set(key, {
      profitability: profitability.get(key) ?? null,
      payments: paymentMetrics.get(key) ?? null,
      salesHistory: sData?.metrics ?? null,
      salesScore: sData?.score ?? null,
      salesComponents: sData?.components ?? null,
      displayName: displayNameByKey.get(key) ?? key
    });
  });

  // 8. Calcular scores extendidos y retornar perfiles completos
  return scoreClientsExtended(combined, config);
}

/**
 * Obtiene el resumen de matching para mostrar en UI
 */
export function getMatchingSummary(
  salesHistory: CustomerSalesYearRecord[],
  existingClientKeys: Set<string>,
  manualMatches: Map<string, string> = new Map()
): { exact: number; fuzzy: number; manual: number; unmatched: string[] } {
  const salesByCustomer = groupByCustomer(salesHistory);
  const salesHistoryCustomers = Array.from(salesByCustomer.keys());
  const candidates: Array<{ customerId: string; customerName: string; customerNameNorm: string }> =
    Array.from(existingClientKeys).map(key => ({
      customerId: key,
      customerName: key,
      customerNameNorm: key
    }));

  const matchResult = matchAllCustomers(salesHistoryCustomers, candidates, { manualMappings: manualMatches, fuzzyThreshold: 0.90 });

  return {
    exact: matchResult.summary.exactMatches,
    fuzzy: matchResult.summary.fuzzyMatches,
    manual: matchResult.summary.manualMatches,
    unmatched: matchResult.summary.unmatchedNames
  };
}