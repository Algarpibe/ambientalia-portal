import { normalizeClientName } from '../utils/normalize';
import type {
  SalesRecord,
  MasterCostRecord,
  InvoiceRecord,
  PaymentRecord,
  CustomerSalesYearRecord,
} from '../types';

const API_BASE = import.meta.env.VITE_HUB_API_URL as string | undefined;
const API_KEY = import.meta.env.VITE_HUB_API_KEY as string | undefined;

export interface HubDatasets {
  sales: SalesRecord[];
  master: MasterCostRecord[];
  invoices: InvoiceRecord[];
  payments: PaymentRecord[];
  salesHistory: CustomerSalesYearRecord[];
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => String(v ?? '').trim();
// Misma normalización de nº de factura que los parsers (para casar facturas↔pagos).
const normInvoice = (v: unknown): string => str(v).toUpperCase().replace(/\s+/g, '');
const isAmbientalia = (name: string): boolean => normalizeClientName(name).includes('ambientalia');

function mapSales(rows: Record<string, unknown>[]): SalesRecord[] {
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

function mapMaster(rows: Record<string, unknown>[]): MasterCostRecord[] {
  return rows
    .map((r) => ({
      sku: str(r['Codigo de Producto']),
      costoUnitario: num(r['Costo']),
      fabricante: str(r['Fabricante']) || undefined,
      categoria: str(r['Categoria']) || undefined,
    }))
    .filter((r) => r.sku);
}

function mapInvoices(rows: Record<string, unknown>[]): InvoiceRecord[] {
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

function mapPayments(rows: Record<string, unknown>[]): PaymentRecord[] {
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

function mapSalesHistory(rows: Record<string, unknown>[]): CustomerSalesYearRecord[] {
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

export async function loadFromHub(): Promise<HubDatasets> {
  if (!API_BASE) throw new Error('Configuración incompleta: falta VITE_HUB_API_URL');
  const res = await fetch(`${API_BASE}/api/customer-valuation/data`, {
    headers: API_KEY ? { 'x-api-key': API_KEY } : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return {
    sales: mapSales(data.sales ?? []),
    master: mapMaster(data.master ?? []),
    invoices: mapInvoices(data.invoices ?? []),
    payments: mapPayments(data.payments ?? []),
    salesHistory: mapSalesHistory(data.salesHistory ?? []),
  };
}
