/**
 * MÓDULO DE CANDADOS (GATING)
 * 
 * Implementa banderas que bloquean beneficios aunque el score total sea alto.
 * 
 * CANDADOS FUERTES:
 * 1. LateValueRate_6m > 30% => no ampliar crédito, no aumentar descuentos
 * 2. Sev_6m > 45 días => restringido (prepago/50-50), congelar beneficios
 * 3. DPD > 90 días en últimos 6m => congelar beneficios
 * 4. NegValueRate_12m > 20% => no conceder descuentos adicionales
 * 
 * Los thresholds son configurables via ScoringConfig.
 */

import {
  PaymentBehaviorMetrics,
  ProfitabilityMetrics,
  GatingResult,
  ActiveLock,
  GateLock,
  ScoringConfig,
  DEFAULT_SCORING_CONFIG,
  ExtendedScoringConfig,
  SalesHistoryMetrics
} from '../types';

/**
 * Aplica las reglas de gating a las métricas del cliente
 * Retorna los candados activos y el tier máximo de beneficios
 */
export function applyGatingRules(
  profitability: ProfitabilityMetrics | null,
  payments: PaymentBehaviorMetrics | null,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): GatingResult {
  const locks: ActiveLock[] = [];
  const thresholds = config.gatingThresholds;

  // Verificar datos insuficientes
  if (!payments || payments.evidenceLevel === 'none') {
    locks.push({
      type: 'LOCK_INSUFFICIENT_DATA',
      severity: 'medium',
      description: 'Sin datos de pagos suficientes para evaluación',
      value: 0,
      threshold: config.minInvoices12m,
      recommendation: 'Recopilar historial de pagos antes de otorgar beneficios'
    });
  }

  if (!profitability || profitability.evidenceLevel === 'none') {
    locks.push({
      type: 'LOCK_INSUFFICIENT_DATA',
      severity: 'medium',
      description: 'Sin datos de rentabilidad suficientes para evaluación',
      value: 0,
      threshold: config.minOrders12m,
      recommendation: 'Recopilar historial de ventas antes de otorgar beneficios'
    });
  }

  // CANDADO 1: LateValueRate_6m > 30%
  if (payments && payments.raw6m.lateValueRate > thresholds.lateValueRate6m) {
    locks.push({
      type: 'LOCK_HIGH_LATE_VALUE_RATE',
      severity: 'high',
      description: `Tasa de mora por valor (6m) del ${(payments.raw6m.lateValueRate * 100).toFixed(1)}% supera el límite de ${(thresholds.lateValueRate6m * 100).toFixed(0)}%`,
      value: payments.raw6m.lateValueRate,
      threshold: thresholds.lateValueRate6m,
      recommendation: 'No ampliar crédito. No aumentar descuentos. Mantener prioridad baja/media hasta normalizar.'
    });
  }

  // CANDADO 2: Severidad_6m > 45 días
  if (payments && payments.raw6m.severity > thresholds.severity6m) {
    locks.push({
      type: 'LOCK_HIGH_SEVERITY',
      severity: 'high',
      description: `Severidad de mora (6m) de ${payments.raw6m.severity.toFixed(0)} días supera el límite de ${thresholds.severity6m} días`,
      value: payments.raw6m.severity,
      threshold: thresholds.severity6m,
      recommendation: 'Restringido a prepago o esquema 50-50. Congelar todos los beneficios.'
    });
  }

  // CANDADO 3: DPD > 90 días en últimos 6m
  if (payments && payments.raw6m.maxDpd > thresholds.maxDpd6m) {
    locks.push({
      type: 'LOCK_CRITICAL_DPD',
      severity: 'high',
      description: `Factura con ${payments.raw6m.maxDpd} días de mora en últimos 6 meses supera el límite de ${thresholds.maxDpd6m} días`,
      value: payments.raw6m.maxDpd,
      threshold: thresholds.maxDpd6m,
      recommendation: 'Congelar beneficios. Iniciar plan de cobranza urgente.'
    });
  }



  // Determinar severidad y tier máximo
  const hasHighSeverityLock = locks.some(l => l.severity === 'high');
  const hasMediumSeverityLock = locks.some(l => l.severity === 'medium');

  let maxBenefitTier: 'Max' | 'Condicionado' | 'Restringido';
  if (hasHighSeverityLock) {
    maxBenefitTier = 'Restringido';
  } else if (hasMediumSeverityLock) {
    maxBenefitTier = 'Condicionado';
  } else {
    maxBenefitTier = 'Max';
  }

  // Determinar bloqueos específicos
  const creditBlocked = locks.some(l =>
    l.type === 'LOCK_HIGH_LATE_VALUE_RATE' ||
    l.type === 'LOCK_HIGH_SEVERITY' ||
    l.type === 'LOCK_CRITICAL_DPD'
  );

  const discountBlocked = locks.some(l =>
    l.type === 'LOCK_HIGH_LATE_VALUE_RATE'
  );

  const priorityReduced = locks.some(l =>
    l.type === 'LOCK_HIGH_LATE_VALUE_RATE' ||
    l.type === 'LOCK_HIGH_SEVERITY'
  );

  return {
    locks,
    hasHighSeverityLock,
    hasMediumSeverityLock,
    maxBenefitTier,
    creditBlocked,
    discountBlocked,
    priorityReduced
  };
}

/**
 * Genera mensajes de candados para mostrar en UI
 */
export function getGatingMessages(gating: GatingResult): string[] {
  return gating.locks.map(lock => {
    const icon = lock.severity === 'high' ? '🔒' : '⚠️';
    return `${icon} ${lock.description}`;
  });
}

/**
 * Verifica si un cliente puede recibir un beneficio específico
 */
export function canReceiveBenefit(
  gating: GatingResult,
  benefitType: 'credit' | 'discount' | 'priority'
): { allowed: boolean; reason?: string } {
  switch (benefitType) {
    case 'credit':
      if (gating.creditBlocked) {
        const lock = gating.locks.find(l =>
          l.type === 'LOCK_HIGH_LATE_VALUE_RATE' ||
          l.type === 'LOCK_HIGH_SEVERITY' ||
          l.type === 'LOCK_CRITICAL_DPD'
        );
        return { allowed: false, reason: lock?.recommendation };
      }
      return { allowed: true };

    case 'discount':
      if (gating.discountBlocked) {
        const lock = gating.locks.find(l =>
          l.type === 'LOCK_HIGH_LATE_VALUE_RATE'
        );
        return { allowed: false, reason: lock?.recommendation };
      }
      return { allowed: true };

    case 'priority':
      if (gating.priorityReduced) {
        const lock = gating.locks.find(l =>
          l.type === 'LOCK_HIGH_LATE_VALUE_RATE' ||
          l.type === 'LOCK_HIGH_SEVERITY'
        );
        return { allowed: false, reason: lock?.recommendation };
      }
      return { allowed: true };

    default:
      return { allowed: true };
  }
}
// =========================================================================
// GATING EXTENDIDO (5 GATES)
// =========================================================================

/**
 * Aplica las 5 reglas de gating extendidas incluyendo ventas históricas
 * 
 * Gate 1: LateValueRate_6m > 30% → no ampliar crédito, no descuentos
 * Gate 2: Sev_6m > 45d → prepago / 50-50, sin beneficios
 * Gate 3: MaxDPD_6m > 90d → congelar toda ampliación

 * Gate 5: isDormant (activeYears < 2 && última venta > 18m) → solo mantenimiento, no expansión
 */
export function applyExtendedGatingRules(
  profitability: ProfitabilityMetrics | null,
  payments: PaymentBehaviorMetrics | null,
  salesHistory: SalesHistoryMetrics | null,
  config: ExtendedScoringConfig
): GatingResult {
  // Get base gating result
  const baseGating = applyGatingRules(profitability, payments, config);
  const locks = [...baseGating.locks];

  // GATE 5: Dormant customer (from sales history)
  if (salesHistory?.isDormant) {
    locks.push({
      type: 'LOCK_DORMANT',
      severity: 'high',
      description: `Cliente inactivo: última venta hace más de 18 meses con historial limitado (${salesHistory.activeYears5y} años activos)`,
      value: salesHistory.activeYears5y,
      threshold: 2,
      recommendation: 'Solo servicios de mantenimiento. No expandir línea de crédito ni conceder beneficios nuevos hasta reactivar relación.'
    });
  }

  // GATE 5b: One-shot customer (single transaction)
  if (salesHistory?.isOneShot) {
    locks.push({
      type: 'LOCK_ONE_SHOT',
      severity: 'medium',
      description: 'Cliente de transacción única: solo 1 año con actividad',
      value: 1,
      threshold: 2,
      recommendation: 'Tratar como cliente nuevo. Requiere calificación completa antes de otorgar beneficios.'
    });
  }

  // GATE 5c: New customer (from sales history)
  if (salesHistory?.isNew) {
    locks.push({
      type: 'LOCK_NEW_CUSTOMER',
      severity: 'low',
      description: 'Cliente nuevo: primera compra este año',
      value: 0,
      threshold: 1,
      recommendation: 'Monitorear durante 6 meses antes de ampliar beneficios.'
    });
  }

  // Recalculate severities with new locks
  const hasHighSeverityLock = locks.some(l => l.severity === 'high');
  const hasMediumSeverityLock = locks.some(l => l.severity === 'medium');

  let maxBenefitTier: 'Max' | 'Condicionado' | 'Restringido';
  if (hasHighSeverityLock) {
    maxBenefitTier = 'Restringido';
  } else if (hasMediumSeverityLock) {
    maxBenefitTier = 'Condicionado';
  } else {
    maxBenefitTier = 'Max';
  }

  // Determine specific blocks (extended)
  const creditBlocked = locks.some(l =>
    l.type === 'LOCK_HIGH_LATE_VALUE_RATE' ||
    l.type === 'LOCK_HIGH_SEVERITY' ||
    l.type === 'LOCK_CRITICAL_DPD' ||
    (l.type === 'LOCK_DORMANT' && config.extendedGates.dormantBlockCredit)
  );

  const discountBlocked = locks.some(l =>
    l.type === 'LOCK_HIGH_LATE_VALUE_RATE' ||
    l.type === 'LOCK_DORMANT'
  );

  const priorityReduced = locks.some(l =>
    l.type === 'LOCK_HIGH_LATE_VALUE_RATE' ||
    l.type === 'LOCK_HIGH_SEVERITY' ||
    l.type === 'LOCK_DORMANT'
  );

  return {
    locks,
    hasHighSeverityLock,
    hasMediumSeverityLock,
    maxBenefitTier,
    creditBlocked,
    discountBlocked,
    priorityReduced
  };
}