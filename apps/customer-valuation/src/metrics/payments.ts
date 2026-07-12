/**
 * MÓDULO B: COMPORTAMIENTO DE PAGOS
 * 
 * Calcula métricas de pagos para valoración histórica de clientes.
 * 
 * MÉTRICAS CALCULADAS:
 * - LateRate: COUNT(DPD_i > 0) / n_facturas
 * - LateValueRate: SUM(ValorFactura WHERE DPD > 0) / SUM(ValorFactura)
 * - AvgDPD: AVG(DPD_i) - promedio global
 * - AvgDPD_mora: AVG(DPD_i WHERE DPD > 0) - solo vencidas
 * - Severidad: SUM(DPD_i * ValorFactura WHERE DPD > 0) / SUM(ValorFactura WHERE DPD > 0)
 * - Volatilidad: desviación estándar muestral de DPD
 * - DSO: Days Sales Outstanding (o AvgDPD como proxy)
 * 
 * RECENCIA:
 * - Calcula métricas para 12m y 6m
 * - Combina con pesos: P_metric = 0.6*metric_6m + 0.4*metric_12m
 */

import { 
  InvoicePaymentJoin, 
  InvoiceRecord, 
  PaymentBehaviorMetrics,
  PaymentPeriodMetrics, 
  PaymentRecord,
  ScoringConfig,
  DEFAULT_SCORING_CONFIG
} from '../types';
import { percentile, sampleStdDev, mean } from '../utils/stats';

const MS_PER_DAY = 86400000;

/**
 * Calcula días entre dos fechas
 */
function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / MS_PER_DAY);
}

/**
 * Une facturas con sus pagos correspondientes
 */
export function joinInvoicesAndPayments(
  invoices: InvoiceRecord[],
  payments: PaymentRecord[],
  today = new Date()
): InvoicePaymentJoin[] {
  const paymentsByInvoice = new Map<string, PaymentRecord[]>();
  payments.forEach((p) => {
    if (!paymentsByInvoice.has(p.factura)) paymentsByInvoice.set(p.factura, []);
    paymentsByInvoice.get(p.factura)!.push(p);
  });

  return invoices.map((invoice) => {
    const relatedPayments = paymentsByInvoice.get(invoice.factura) ?? [];
    const paidAmount = relatedPayments.reduce((sum, p) => sum + p.monto, 0);
    const remaining = Math.max(0, (invoice.saldo ?? invoice.total) - paidAmount);
    
    // Determinar fecha de pago: usar fechaPago del invoice si existe, sino último pago
    let paymentDate: Date;
    if (invoice.fechaPago) {
      paymentDate = invoice.fechaPago;
    } else if (relatedPayments.length > 0) {
      paymentDate = relatedPayments.reduce((latest, p) =>
        p.fechaPago && p.fechaPago > latest ? p.fechaPago : latest,
        relatedPayments[0].fechaPago
      );
    } else {
      paymentDate = today; // No pagada, usar hoy
    }

    // DPD = max(0, fechaPago - fechaVencimiento)
    const referenceDate = remaining > 0 ? today : paymentDate;
    const dpdRaw = daysBetween(referenceDate, invoice.fechaVencimiento);
    const dpd = Math.max(0, dpdRaw);
    const ageMonths = Math.max(0, daysBetween(today, invoice.fechaFactura) / 30);

    return {
      invoice,
      payments: relatedPayments,
      paidAmount,
      remainingBalance: remaining,
      isFullyPaid: remaining === 0,
      dpd,
      dpdFromInvoice: dpdRaw,
      ageMonths
    };
  });
}

/**
 * Filtra joins por período
 */
function filterJoinsByPeriod(
  joins: InvoicePaymentJoin[],
  today: Date,
  months: number
): InvoicePaymentJoin[] {
  const cutoffDate = new Date(today.getTime() - months * 30 * MS_PER_DAY);
  return joins.filter(j => j.invoice.fechaFactura >= cutoffDate);
}

/**
 * Calcula métricas de pagos para un período específico
 */
function calculatePeriodMetrics(
  joins: InvoicePaymentJoin[],
  period: '12m' | '6m'
): PaymentPeriodMetrics {
  const result: PaymentPeriodMetrics = {
    period,
    invoiceCount: joins.length,
    totalValue: 0,
    lateCount: 0,
    lateRate: 0,
    lateValue: 0,
    lateValueRate: 0,
    avgDpd: 0,
    avgDpdMora: 0,
    maxDpd: 0,
    severity: 0,
    volatility: 0,
    volatilityMora: 0,
    dso: 0,
    invoicesOver90Days: 0,
    overdueBalance: 0
  };

  if (joins.length === 0) return result;

  const dpds: number[] = [];
  const dpdsMora: number[] = [];
  let sumDpdValue = 0;   // SUM(DPD_i * ValorFactura WHERE DPD > 0)
  let sumLateValue = 0;  // SUM(ValorFactura WHERE DPD > 0)

  joins.forEach(join => {
    const value = join.invoice.total;
    result.totalValue += value;
    dpds.push(join.dpd);

    if (join.dpd > 0) {
      result.lateCount++;
      result.lateValue += value;
      dpdsMora.push(join.dpd);
      sumDpdValue += join.dpd * value;
      sumLateValue += value;

      if (!join.isFullyPaid) {
        result.overdueBalance += join.remainingBalance;
      }
    }

    if (join.dpd > 90) {
      result.invoicesOver90Days++;
    }

    if (join.dpd > result.maxDpd) {
      result.maxDpd = join.dpd;
    }
  });

  // Tasas de mora
  result.lateRate = joins.length > 0 ? result.lateCount / joins.length : 0;
  result.lateValueRate = result.totalValue > 0 ? result.lateValue / result.totalValue : 0;

  // Promedios de DPD
  result.avgDpd = mean(dpds);
  result.avgDpdMora = dpdsMora.length > 0 ? mean(dpdsMora) : 0;

  // Severidad financiera (ponderada por valor)
  result.severity = sumLateValue > 0 ? sumDpdValue / sumLateValue : 0;

  // Volatilidad (desviación estándar muestral)
  result.volatility = sampleStdDev(dpds);
  result.volatilityMora = dpdsMora.length >= 2 ? sampleStdDev(dpdsMora) : 0;

  // DSO: usar avgDpd como proxy
  result.dso = result.avgDpd;

  return result;
}

/**
 * Construye métricas de pagos para todos los clientes
 * Calcula métricas para 12m y 6m, y combina con pesos de recencia
 */
export function buildPaymentMetrics(
  joins: InvoicePaymentJoin[],
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  today = new Date()
): Map<string, PaymentBehaviorMetrics> {
  const byClient = new Map<string, PaymentBehaviorMetrics>();

  // Agrupar joins por cliente
  const joinsByClient = new Map<string, InvoicePaymentJoin[]>();
  joins.forEach(join => {
    const key = join.invoice.clientKey;
    if (!joinsByClient.has(key)) {
      joinsByClient.set(key, []);
    }
    joinsByClient.get(key)!.push(join);
  });

  // Calcular métricas por cliente
  for (const [clientKey, clientJoins] of joinsByClient) {
    // Filtrar por período
    const joins12m = filterJoinsByPeriod(clientJoins, today, 12);
    const joins6m = filterJoinsByPeriod(clientJoins, today, 6);

    // Calcular métricas por período
    const period12m = calculatePeriodMetrics(joins12m, '12m');
    const period6m = calculatePeriodMetrics(joins6m, '6m');

    // Combinar con pesos de recencia (para pagos, más peso a 6m)
    const w12m = config.recencyWeights.payments12m;
    const w6m = config.recencyWeights.payments6m;

    // Si no hay datos en un período, usar el otro
    const has12m = period12m.invoiceCount > 0;
    const has6m = period6m.invoiceCount > 0;

    let combinedLateValueRate: number, combinedSeverity: number, 
        combinedAvgDpd: number, combinedVolatility: number, combinedDso: number;

    if (has12m && has6m) {
      combinedLateValueRate = w12m * period12m.lateValueRate + w6m * period6m.lateValueRate;
      combinedSeverity = w12m * period12m.severity + w6m * period6m.severity;
      combinedAvgDpd = w12m * period12m.avgDpd + w6m * period6m.avgDpd;
      combinedVolatility = w12m * period12m.volatility + w6m * period6m.volatility;
      combinedDso = w12m * period12m.dso + w6m * period6m.dso;
    } else if (has12m) {
      combinedLateValueRate = period12m.lateValueRate;
      combinedSeverity = period12m.severity;
      combinedAvgDpd = period12m.avgDpd;
      combinedVolatility = period12m.volatility;
      combinedDso = period12m.dso;
    } else if (has6m) {
      combinedLateValueRate = period6m.lateValueRate;
      combinedSeverity = period6m.severity;
      combinedAvgDpd = period6m.avgDpd;
      combinedVolatility = period6m.volatility;
      combinedDso = period6m.dso;
    } else {
      combinedLateValueRate = 0;
      combinedSeverity = 0;
      combinedAvgDpd = 0;
      combinedVolatility = 0;
      combinedDso = 0;
    }

    // Determinar nivel de evidencia
    const hasMinimumData = period12m.invoiceCount >= config.minInvoices12m;
    let evidenceLevel: 'sufficient' | 'insufficient' | 'none';
    if (period12m.invoiceCount >= config.minInvoices12m) {
      evidenceLevel = 'sufficient';
    } else if (period12m.invoiceCount > 0 || period6m.invoiceCount > 0) {
      evidenceLevel = 'insufficient';
    } else {
      evidenceLevel = 'none';
    }

    byClient.set(clientKey, {
      period12m,
      period6m,
      combined: {
        lateValueRate: combinedLateValueRate,
        severity: combinedSeverity,
        avgDpd: combinedAvgDpd,
        volatility: combinedVolatility,
        dso: combinedDso
      },
      raw6m: {
        lateValueRate: period6m.lateValueRate,
        severity: period6m.severity,
        maxDpd: period6m.maxDpd
      },
      hasMinimumData,
      evidenceLevel
    });
  }

  return byClient;
}
