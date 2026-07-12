/**
 * MÓDULO DE ACCIONES Y DRIVERS
 * 
 * Genera recomendaciones de acción y mensajes explicativos
 * basados en los scores y métricas del cliente.
 */

import {
  PaymentBehaviorMetrics,
  ProfitabilityMetrics,
  ValueScoreComponents,
  PaymentScoreComponents,
  GatingResult
} from '../types';

/**
 * Genera lista de acciones recomendadas basadas en el análisis
 */
export function generateActions(
  valueScore: number,
  paymentScore: number,
  profitability: ProfitabilityMetrics | null,
  payments: PaymentBehaviorMetrics | null,
  gating: GatingResult
): string[] {
  const actions: string[] = [];

  // Acciones por candados activos
  if (gating.hasHighSeverityLock) {
    actions.push('⚠️ URGENTE: Revisar plan de regularización de pagos');
    actions.push('Congelar todos los beneficios hasta normalización');
  }

  // Acciones por score de pagos bajo
  if (paymentScore < 40) {
    actions.push('Migrar a esquema prepago o 50-50');
    actions.push('Establecer plan de pagos estructurado');
    actions.push('Aumentar frecuencia de seguimiento de cobranza');
  } else if (paymentScore < 60) {
    actions.push('Revisar límites de crédito actuales');
    actions.push('Programar reunión de revisión comercial');
  }

  // Acciones por score de valor
  if (valueScore >= 80 && paymentScore >= 80) {
    actions.push('✓ Mantener condiciones preferenciales');
    actions.push('Explorar oportunidades de upsell');
  } else if (valueScore >= 80 && paymentScore < 80) {
    actions.push('Alto potencial - condicionar beneficios a mejora de pagos');
    actions.push('Ofrecer descuentos por pronto pago');
  } else if (valueScore < 60) {
    actions.push('Revisar estrategia de pricing');
    actions.push('Identificar oportunidades de productos de mayor margen');
  }



  // Acciones por severidad alta
  if (payments && payments.raw6m.severity > 30) {
    actions.push('Implementar recordatorios proactivos de pago');
    actions.push('Evaluar términos de crédito más estrictos');
  }

  // Acciones por volatilidad alta
  if (payments && payments.combined.volatility > 30) {
    actions.push('Cliente impredecible: aumentar monitoreo');
  }

  // Si no hay acciones específicas
  if (actions.length === 0) {
    actions.push('Mantener condiciones actuales y monitoreo regular');
  }

  return [...new Set(actions)].slice(0, 5);
}

/**
 * Genera mensajes de drivers para display (legacy format)
 */
export function generateDriverMessages(
  valueComponents: ValueScoreComponents,
  paymentComponents: PaymentScoreComponents,
  profitability: ProfitabilityMetrics | null,
  payments: PaymentBehaviorMetrics | null
): string[] {
  const drivers: string[] = [];

  if (profitability?.hasMinimumData) {
    drivers.push(`GM% ${profitability.combined.gmPct.toFixed(1)}% (score ${valueComponents.gmPctScore})`);
    drivers.push(`GM$ $${profitability.combined.gmAbs.toLocaleString()} (score ${valueComponents.gmAbsScore})`);

  }

  if (payments?.hasMinimumData) {
    drivers.push(`Mora ${(payments.combined.lateValueRate * 100).toFixed(1)}% (score ${paymentComponents.lateValueRateScore})`);
    drivers.push(`Severidad ${payments.combined.severity.toFixed(0)} días (score ${paymentComponents.severityScore})`);
    if (payments.raw6m.maxDpd > 60) {
      drivers.push(`⚠️ Max DPD 6m: ${payments.raw6m.maxDpd} días`);
    }
  }

  return drivers.slice(0, 5);
}

/**
 * Legacy: suggestActions compatible con código anterior
 */
export function suggestActions(
  valueScore: number,
  riskScore: number,
  profitability: ProfitabilityMetrics | null,
  payments: PaymentBehaviorMetrics | null,
  flags: string[]
): string[] {
  const actions: string[] = [];
  const paymentScore = 100 - riskScore;

  if (valueScore >= 60 && riskScore >= 40) {
    actions.push('Migrar a esquema 50-50 o crédito 30 días con control');
    actions.push('Revisar límites de crédito y plan de pagos');
  } else if (valueScore < 60 && riskScore < 40) {
    actions.push('Upsell: paquetes y automatizar atención');
  }

  if (profitability?.hasMinimumData && profitability.combined.gmPct < 20) {
    actions.push('Revisar pricing y descuentos; fijar margen mínimo');
  }

  if (payments?.hasMinimumData && payments.period12m.overdueBalance > 0) {
    actions.push('Congelar descuentos y aplicar prepago temporal');
  }

  if (riskScore >= 70) {
    actions.push('Plan de pagos y renegociar SLA de cobranza');
  }

  if (flags.length > 0) {
    actions.push('Atender candados activos antes de ampliar beneficios');
  }

  if (actions.length === 0) actions.push('Mantener condiciones actuales y monitorear');
  return [...new Set(actions)];
}

/**
 * Legacy: driverMessages compatible con código anterior
 */
export function driverMessages(
  components: { revenueScore: number; marginScore: number; recencyWeightedDpdScore: number; recencyOverdueRateScore: number; dpdP95Score: number; overdueBalanceScore: number },
  profitability: ProfitabilityMetrics | null,
  payments: PaymentBehaviorMetrics | null
): string[] {
  const drivers: string[] = [];

  if (profitability?.hasMinimumData) {
    drivers.push(`Ventas totales $${profitability.period12m.salesTotal.toLocaleString()}`);
    drivers.push(`Margen bruto ${profitability.combined.gmPct.toFixed(1)}%`);
  }

  if (payments?.hasMinimumData) {
    drivers.push(`Severidad ${payments.combined.severity.toFixed(0)} días`);
    drivers.push(`Mora ${(payments.combined.lateValueRate * 100).toFixed(1)}%`);
    if (payments.period12m.overdueBalance > 0) {
      drivers.push(`Saldo vencido $${payments.period12m.overdueBalance.toLocaleString()}`);
    }
  }

  return drivers.slice(0, 3);
}
