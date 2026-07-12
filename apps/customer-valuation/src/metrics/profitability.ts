/**
 * MÓDULO A: RENTABILIDAD DEL CLIENTE
 * 
 * Calcula métricas de rentabilidad para valoración histórica de clientes.
 * 
 * MÉTRICAS CALCULADAS:
 * - GM% (Margen Bruto %): SUM(VentasNetas - COGS) / SUM(VentasNetas)
 * - GM$ (Margen Bruto Absoluto): SUM(VentasNetas - COGS)
 * - NegRate: COUNT(ordenes con margen < 0) / total ordenes
 * - NegValueRate: SUM(VentasNetas de ordenes con margen < 0) / SUM(VentasNetas)
 * - MixMarginIndex: % del valor en productos de alto margen
 * 
 * RECENCIA:
 * - Calcula métricas para 12m y 6m
 * - Combina con pesos: V_metric = 0.7*metric_12m + 0.3*metric_6m
 */

import {
  MasterCostRecord,
  ProfitabilityMetrics,
  ProfitabilityPeriodMetrics,
  SalesRecord,
  ScoringConfig,
  DEFAULT_SCORING_CONFIG
} from '../types';
import { percentile } from '../utils/stats';

const MS_PER_DAY = 86400000;

/**
 * Filtra registros de ventas por período
 */
function filterByPeriod(
  sales: SalesRecord[],
  today: Date,
  months: number
): SalesRecord[] {
  const cutoffDate = new Date(today.getTime() - months * 30 * MS_PER_DAY);
  return sales.filter(s => s.fechaOrden >= cutoffDate);
}

/**
 * Calcula métricas de rentabilidad para un período específico
 */
function calculatePeriodMetrics(
  sales: SalesRecord[],
  master: Map<string, MasterCostRecord>,
  period: '12m' | '6m',
  highMarginThreshold: number
): ProfitabilityPeriodMetrics {
  const result: ProfitabilityPeriodMetrics = {
    period,
    orderCount: 0,
    salesTotal: 0,
    cogsTotal: 0,
    grossProfit: 0,
    grossMarginPct: 0,
    negativeOrderCount: 0,
    negRate: 0,
    negativeOrdersValue: 0,
    mixMarginIndex: 0,
    highMarginSales: 0,
    lowMarginSales: 0,
    unknownCostCount: 0,
    topSkus: [],
    topFamilias: [],
    topLineas: []
  };

  if (sales.length === 0) return result;

  // Agrupar ventas por orden
  const orderMap = new Map<string, { sales: number; cogs: number; items: SalesRecord[] }>();

  sales.forEach(sale => {
    const orderId = sale.ordenId || `${sale.fechaOrden.getTime()}-${sale.sku}`;

    if (!orderMap.has(orderId)) {
      orderMap.set(orderId, { sales: 0, cogs: 0, items: [] });
    }

    const order = orderMap.get(orderId)!;
    const masterRecord = master.get(sale.sku);

    // Calcular COGS: usar el valor del registro o calcular desde master
    const cogs = sale.cogs > 0 ? sale.cogs :
      (masterRecord ? sale.cantidad * masterRecord.costoUnitario : 0);

    order.sales += sale.ventasNetas;
    order.cogs += cogs;
    order.items.push(sale);

    if (!masterRecord && sale.cogs === 0) {
      result.unknownCostCount++;
    }
  });

  result.orderCount = orderMap.size;

  // Calcular totales y órdenes negativas
  for (const [, order] of orderMap) {
    result.salesTotal += order.sales;
    result.cogsTotal += order.cogs;

    const orderMargin = order.sales - order.cogs;

    if (orderMargin < 0) {
      result.negativeOrderCount++;
      result.negativeOrdersValue += order.sales;
    }
  }

  result.grossProfit = result.salesTotal - result.cogsTotal;
  result.grossMarginPct = result.salesTotal > 0
    ? (result.grossProfit / result.salesTotal) * 100
    : 0;
  result.negRate = result.orderCount > 0
    ? result.negativeOrderCount / result.orderCount
    : 0;

  // Calcular margen por SKU
  const skuMetrics = new Map<string, { sales: number; margin: number }>();
  const familiaMetrics = new Map<string, { sales: number; margin: number }>();
  const lineaMetrics = new Map<string, { sales: number; margin: number }>();

  sales.forEach(sale => {
    const masterRecord = master.get(sale.sku);
    const cogs = sale.cogs > 0 ? sale.cogs :
      (masterRecord ? sale.cantidad * masterRecord.costoUnitario : 0);
    const margin = sale.ventasNetas - cogs;

    // SKU
    if (!skuMetrics.has(sale.sku)) {
      skuMetrics.set(sale.sku, { sales: 0, margin: 0 });
    }
    const skuData = skuMetrics.get(sale.sku)!;
    skuData.sales += sale.ventasNetas;
    skuData.margin += margin;

    // Familia
    const familia = sale.familia || masterRecord?.familia || 'Sin familia';
    if (!familiaMetrics.has(familia)) {
      familiaMetrics.set(familia, { sales: 0, margin: 0 });
    }
    const famData = familiaMetrics.get(familia)!;
    famData.sales += sale.ventasNetas;
    famData.margin += margin;

    // Línea
    const linea = sale.linea || 'Sin línea';
    if (!lineaMetrics.has(linea)) {
      lineaMetrics.set(linea, { sales: 0, margin: 0 });
    }
    const lineaData = lineaMetrics.get(linea)!;
    lineaData.sales += sale.ventasNetas;
    lineaData.margin += margin;
  });

  // Top SKUs
  result.topSkus = [...skuMetrics.entries()]
    .map(([sku, data]) => ({
      sku,
      sales: data.sales,
      margin: data.margin,
      marginPct: data.sales > 0 ? (data.margin / data.sales) * 100 : 0
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 10);

  // Top Familias
  result.topFamilias = [...familiaMetrics.entries()]
    .map(([familia, data]) => ({
      familia,
      sales: data.sales,
      marginPct: data.sales > 0 ? (data.margin / data.sales) * 100 : 0
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 5);

  // Top Líneas
  result.topLineas = [...lineaMetrics.entries()]
    .map(([linea, data]) => ({
      linea,
      sales: data.sales,
      marginPct: data.sales > 0 ? (data.margin / data.sales) * 100 : 0
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 3);

  // Calcular MixMarginIndex
  // Ordenar SKUs por margen % y dividir en alto/bajo margen
  const allSkuMargins = [...skuMetrics.entries()]
    .map(([sku, data]) => ({
      sku,
      sales: data.sales,
      marginPct: data.sales > 0 ? (data.margin / data.sales) * 100 : 0
    }));

  const marginPcts = allSkuMargins.map(s => s.marginPct);
  const highMarginCutoff = percentile(marginPcts, highMarginThreshold);

  allSkuMargins.forEach(sku => {
    if (sku.marginPct >= highMarginCutoff) {
      result.highMarginSales += sku.sales;
    } else {
      result.lowMarginSales += sku.sales;
    }
  });

  result.mixMarginIndex = result.salesTotal > 0
    ? result.highMarginSales / result.salesTotal
    : 0;

  return result;
}

/**
 * Construye métricas de rentabilidad para todos los clientes
 * Calcula métricas para 12m y 6m, y combina con pesos de recencia
 */
export function buildProfitabilityMetrics(
  sales: SalesRecord[],
  master: MasterCostRecord[],
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  today = new Date()
): Map<string, ProfitabilityMetrics> {
  const masterBySku = new Map(master.map((m) => [m.sku, m]));
  const byClient = new Map<string, ProfitabilityMetrics>();

  // Agrupar ventas por cliente
  const salesByClient = new Map<string, SalesRecord[]>();
  sales.forEach(sale => {
    if (!salesByClient.has(sale.clientKey)) {
      salesByClient.set(sale.clientKey, []);
    }
    salesByClient.get(sale.clientKey)!.push(sale);
  });

  // Calcular métricas por cliente
  for (const [clientKey, clientSales] of salesByClient) {
    // Filtrar por período
    const sales12m = filterByPeriod(clientSales, today, 12);
    const sales6m = filterByPeriod(clientSales, today, 6);

    // Calcular métricas por período
    const period12m = calculatePeriodMetrics(
      sales12m,
      masterBySku,
      '12m',
      config.highMarginThresholdPct
    );
    const period6m = calculatePeriodMetrics(
      sales6m,
      masterBySku,
      '6m',
      config.highMarginThresholdPct
    );

    // Combinar con pesos de recencia
    const w12m = config.recencyWeights.profitability12m;
    const w6m = config.recencyWeights.profitability6m;

    // Si no hay datos en 6m, usar solo 12m (y viceversa)
    const has12m = period12m.orderCount > 0;
    const has6m = period6m.orderCount > 0;

    let combinedGmPct: number, combinedGmAbs: number, combinedMixMarginIndex: number;

    if (has12m && has6m) {
      combinedGmPct = w12m * period12m.grossMarginPct + w6m * period6m.grossMarginPct;
      // GM$ absoluto NO debe ponderarse: usar el total de 12m (que incluye 6m)
      combinedGmAbs = period12m.grossProfit;
      combinedMixMarginIndex = w12m * period12m.mixMarginIndex + w6m * period6m.mixMarginIndex;
    } else if (has12m) {
      combinedGmPct = period12m.grossMarginPct;
      combinedGmAbs = period12m.grossProfit;
      combinedMixMarginIndex = period12m.mixMarginIndex;
    } else if (has6m) {
      combinedGmPct = period6m.grossMarginPct;
      combinedGmAbs = period6m.grossProfit;
      combinedMixMarginIndex = period6m.mixMarginIndex;
    } else {
      combinedGmPct = 0;
      combinedGmAbs = 0;
      combinedMixMarginIndex = 0;
    }

    // Determinar nivel de evidencia
    const hasMinimumData = period12m.orderCount >= config.minOrders12m;
    let evidenceLevel: 'sufficient' | 'insufficient' | 'none';
    if (period12m.orderCount >= config.minOrders12m) {
      evidenceLevel = 'sufficient';
    } else if (period12m.orderCount > 0 || period6m.orderCount > 0) {
      evidenceLevel = 'insufficient';
    } else {
      evidenceLevel = 'none';
    }

    byClient.set(clientKey, {
      period12m,
      period6m,
      combined: {
        gmPct: combinedGmPct,
        gmAbs: combinedGmAbs,
        mixMarginIndex: combinedMixMarginIndex
      },
      hasMinimumData,
      evidenceLevel
    });
  }

  return byClient;
}
