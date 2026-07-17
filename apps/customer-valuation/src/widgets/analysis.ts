// Agregación de valoración de clientes — funciones puras reutilizables por los
// widgets del Dashboard del Portal. Reproducen el pipeline de la app (App.tsx +
// hub/loadFromHub.ts): mapean los arreglos crudos de Zoho a los records tipados y
// los pasan por el motor de scoring/segmentación ya existente (clientAggregator).
// Sin estado ni dependencias del Portal.

import { normalizeClientName } from '../utils/normalize';
import {
  aggregateClients,
  aggregateClientsExtended,
  getPopulationStats,
} from '../metrics/clientAggregator';
import {
  DEFAULT_SCORING_CONFIG,
  DEFAULT_EXTENDED_CONFIG,
  type SalesRecord,
  type MasterCostRecord,
  type InvoiceRecord,
  type PaymentRecord,
  type CustomerSalesYearRecord,
  type ClientProfile,
} from '../types';

// ─── Helpers de parseo (idénticos a hub/loadFromHub.ts) ──────────────────────

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => String(v ?? '').trim();
const normInvoice = (v: unknown): string => str(v).toUpperCase().replace(/\s+/g, '');
const isAmbientalia = (name: string): boolean => normalizeClientName(name).includes('ambientalia');

function mapSales(rows: any[]): SalesRecord[] {
  return rows
    .map((r) => {
      const cliente = str(r['Cliente']);
      const sku = str(r['SKU']);
      const cantidad = num(r['Cantidad vendida']);
      const ventasNetas = num(r['Importe']);
      if (!cliente || isAmbientalia(cliente) || !sku || cantidad <= 0 || ventasNetas <= 0) return null;
      const anio = num(r['Anio']) || new Date().getFullYear();
      return {
        cliente,
        clientKey: normalizeClientName(cliente),
        ordenId: `HUB-${anio}-${sku}`,
        fechaOrden: new Date(anio, 0, 1),
        año: anio,
        linea: str(r['Categoria']) || 'general',
        sku,
        familia: str(r['Marca']) || undefined,
        descripcion: str(r['Nombre del articulo']),
        cantidad,
        ventasNetas,
        cogs: 0,
      } as SalesRecord;
    })
    .filter((x): x is SalesRecord => !!x);
}

function mapMaster(rows: any[]): MasterCostRecord[] {
  return rows
    .map((r) => ({
      sku: str(r['Codigo de Producto']),
      costoUnitario: num(r['Costo']),
      fabricante: str(r['Fabricante']) || undefined,
      categoria: str(r['Categoria']) || undefined,
    }))
    .filter((r) => r.sku);
}

function mapInvoices(rows: any[]): InvoiceRecord[] {
  return rows
    .map((r) => {
      const cliente = str(r['Cliente']);
      const factura = normInvoice(r['Numero de factura']);
      if (!cliente || isAmbientalia(cliente) || !factura) return null;
      return {
        factura,
        cliente,
        clientKey: normalizeClientName(cliente),
        fechaFactura: new Date(str(r['Fecha de la factura'])),
        fechaVencimiento: new Date(str(r['Fecha de vencimiento'])),
        estado: str(r['Estado']) || 'Pendiente',
        total: num(r['Total']),
        saldo: num(r['Saldo']),
      } as InvoiceRecord;
    })
    .filter((x): x is InvoiceRecord => !!x);
}

function mapPayments(rows: any[]): PaymentRecord[] {
  return rows
    .map((r, i) => {
      const cliente = str(r['Cliente']);
      const factura = normInvoice(r['Numero de factura']);
      if (!cliente || isAmbientalia(cliente) || !factura) return null;
      return {
        pagoId: str(r['Numero de pago']) || `PAG-${i}`,
        cliente,
        clientKey: normalizeClientName(cliente),
        factura,
        fechaPago: new Date(str(r['Fecha'])),
        monto: num(r['Importe (BCY)']),
      } as PaymentRecord;
    })
    .filter((x): x is PaymentRecord => !!x);
}

function mapSalesHistory(rows: any[]): CustomerSalesYearRecord[] {
  return rows
    .map((r) => {
      const raw = str(r['Cliente']);
      const year = num(r['Anio']);
      if (!raw || isAmbientalia(raw) || !year) return null;
      return {
        customerNameRaw: raw,
        customerNameNorm: normalizeClientName(raw),
        year,
        salesUsd: Math.max(0, num(r['Ventas'])),
      } as CustomerSalesYearRecord;
    })
    .filter((x): x is CustomerSalesYearRecord => !!x);
}

// ─── Segmentos ───────────────────────────────────────────────────────────────

export type Segment = 'Premium' | 'Valioso Condicionado' | 'Estándar' | 'Restringido';

export const SEGMENT_ORDER: Segment[] = ['Premium', 'Valioso Condicionado', 'Estándar', 'Restringido'];

export interface SegmentSlice {
  segment: Segment;
  count: number;
  percent: number; // 0..1 sobre el total de clientes
}

export interface ValuationSummary {
  totalClients: number;
  totalSales: number;        // Suma de ventas netas (facturación del dataset de rentabilidad)
  bySegment: Record<Segment, number>;
  segments: SegmentSlice[];  // en SEGMENT_ORDER, listo para barras HTML
  premiumCount: number;
  premiumPercent: number;    // % de clientes en segmento Premium (0..1)
  highRiskCount: number;     // clientes con riskBand = 'Alto Riesgo'
  avgTotalScore: number;     // score total promedio de la población (0..100)
}

const EMPTY_BY_SEGMENT: Record<Segment, number> = {
  Premium: 0,
  'Valioso Condicionado': 0,
  Estándar: 0,
  Restringido: 0,
};

/**
 * Construye los perfiles de cliente con scores/segmentos a partir de los arreglos
 * crudos del hub, replicando la decisión de App.tsx (modo extendido si hay ventas
 * históricas, estándar en caso contrario).
 */
export function buildClients(
  rawSales: any[],
  rawMaster: any[],
  rawInvoices: any[],
  rawPayments: any[],
  rawSalesHistory: any[],
): ClientProfile[] {
  const sales = mapSales(rawSales || []);
  const master = mapMaster(rawMaster || []);
  const invoices = mapInvoices(rawInvoices || []);
  const payments = mapPayments(rawPayments || []);
  const salesHistory = mapSalesHistory(rawSalesHistory || []);

  if (!sales.length && !invoices.length && !salesHistory.length) return [];

  if (salesHistory.length > 0) {
    return aggregateClientsExtended(
      sales,
      master,
      invoices,
      payments,
      salesHistory,
      new Map(),
      new Date(),
      DEFAULT_EXTENDED_CONFIG,
    );
  }
  return aggregateClients(sales, master, invoices, payments, new Date(), DEFAULT_SCORING_CONFIG);
}

/** Calcula el resumen de KPIs de valoración a partir de los arreglos crudos. */
export function analyze(
  rawSales: any[],
  rawMaster: any[],
  rawInvoices: any[],
  rawPayments: any[],
  rawSalesHistory: any[],
): ValuationSummary {
  const empty: ValuationSummary = {
    totalClients: 0,
    totalSales: 0,
    bySegment: { ...EMPTY_BY_SEGMENT },
    segments: SEGMENT_ORDER.map((segment) => ({ segment, count: 0, percent: 0 })),
    premiumCount: 0,
    premiumPercent: 0,
    highRiskCount: 0,
    avgTotalScore: 0,
  };

  const clients = buildClients(rawSales, rawMaster, rawInvoices, rawPayments, rawSalesHistory);
  if (clients.length === 0) return empty;

  const stats = getPopulationStats(clients);

  const bySegment: Record<Segment, number> = {
    Premium: stats.bySegment['Premium'] || 0,
    'Valioso Condicionado': stats.bySegment['Valioso Condicionado'] || 0,
    Estándar: stats.bySegment['Estándar'] || 0,
    Restringido: stats.bySegment['Restringido'] || 0,
  };

  const totalClients = stats.totalClients;
  const totalSales = clients.reduce((acc, c) => acc + (c.quickMetrics?.salesTotal ?? 0), 0);
  const highRiskCount = clients.reduce(
    (acc, c) => acc + (c.scores?.riskBand === 'Alto Riesgo' ? 1 : 0),
    0,
  );

  const segments: SegmentSlice[] = SEGMENT_ORDER.map((segment) => ({
    segment,
    count: bySegment[segment],
    percent: totalClients ? bySegment[segment] / totalClients : 0,
  }));

  return {
    totalClients,
    totalSales,
    bySegment,
    segments,
    premiumCount: bySegment.Premium,
    premiumPercent: totalClients ? bySegment.Premium / totalClients : 0,
    highRiskCount,
    avgTotalScore: stats.avgTotalScore,
  };
}

// ─── Formateo compartido ─────────────────────────────────────────────────────

export const formatMoney = (value: number): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value || 0);

export const formatPercent = (value: number): string => `${((value || 0) * 100).toFixed(1)}%`;
