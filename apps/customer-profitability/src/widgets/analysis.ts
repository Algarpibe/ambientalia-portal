// Agregación de rentabilidad — función pura reutilizable por los widgets del
// Dashboard del Portal. Reproduce el cálculo del componente Dashboard de la app
// (mismos nombres de campo de Zoho) en una forma independiente y sin estado.

export interface BrandAgg {
  name: string;
  sales: number;
  margin: number;
  marginPercent: number;
}

export interface CustomerAgg {
  name: string;
  sales: number;
  margin: number;
  marginPercent: number;
}

export interface ProfitabilitySummary {
  totalSales: number;
  totalCost: number;
  totalMargin: number;
  marginPercent: number;
  brands: BrandAgg[];    // ordenadas por ventas desc
  customers: CustomerAgg[]; // ordenadas por margen desc
}

function parseCurrency(val: unknown): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const clean = String(val).replace(/[^0-9.-]+/g, '');
  return parseFloat(clean) || 0;
}

/** Calcula el resumen de rentabilidad a partir de ventas y productos de Zoho. */
export function analyze(sales: any[], products: any[]): ProfitabilitySummary {
  const empty: ProfitabilitySummary = {
    totalSales: 0,
    totalCost: 0,
    totalMargin: 0,
    marginPercent: 0,
    brands: [],
    customers: [],
  };
  if (!Array.isArray(sales) || sales.length === 0) return empty;

  // 1. Mapa de productos por SKU.
  const productMap = new Map<string, { cost: number; manufacturer: string; category: string }>();
  if (Array.isArray(products)) {
    for (const p of products) {
      const sku = p['Código de Producto'] || p['SKU'];
      if (sku) {
        productMap.set(String(sku).trim(), {
          cost: parseFloat(p['Precio de Compra por unidad']) || 0,
          manufacturer: p['Fabricante'] || 'Desconocido',
          category: p['Categoría'] || 'Sin Categoría',
        });
      }
    }
  }

  // 2. Detecta la columna de cliente de forma robusta.
  const sample = sales[0] || {};
  const customerKey =
    Object.keys(sample).find((k) =>
      k &&
      (k.toLowerCase().includes('cliente') ||
        k.toLowerCase().includes('customer') ||
        k.toLowerCase().includes('razón social') ||
        k.toLowerCase().includes('razon social')),
    ) || 'Cliente';

  let totalSales = 0;
  let totalCost = 0;
  const byBrand: Record<string, BrandAgg> = {};
  const byCustomer: Record<string, CustomerAgg> = {};

  for (const sale of sales) {
    const customerName = sale[customerKey] || 'Cliente General';
    if (customerName === 'Ambientalia S.A.S.') continue; // excluir movimientos internos

    const sku = String(sale['SKU'] || sale['Código de artículo'] || '').trim();
    const qty = parseFloat(sale['Cantidad vendida']) || 0;
    const amount = parseCurrency(sale['Importe']);
    if (!sku || qty === 0) continue;

    const info = productMap.get(sku);
    const unitCost = info?.cost ?? 0;
    const itemCost = unitCost * qty;
    const margin = amount - itemCost;
    const brand = info?.manufacturer || sale['Marca'] || 'Genérico';

    totalSales += amount;
    totalCost += itemCost;

    const b = (byBrand[brand] ??= { name: brand, sales: 0, margin: 0, marginPercent: 0 });
    b.sales += amount;
    b.margin += margin;

    const c = (byCustomer[customerName] ??= { name: customerName, sales: 0, margin: 0, marginPercent: 0 });
    c.sales += amount;
    c.margin += margin;
  }

  const withPct = <T extends { sales: number; margin: number; marginPercent: number }>(x: T): T => ({
    ...x,
    marginPercent: x.sales ? x.margin / x.sales : x.margin < 0 ? -1 : 0,
  });

  const brands = Object.values(byBrand).map(withPct).sort((a, b) => b.sales - a.sales);
  const customers = Object.values(byCustomer).map(withPct).sort((a, b) => b.margin - a.margin);

  return {
    totalSales,
    totalCost,
    totalMargin: totalSales - totalCost,
    marginPercent: totalSales ? (totalSales - totalCost) / totalSales : 0,
    brands,
    customers,
  };
}

// ─── Formateo compartido ─────────────────────────────────────────────────────

export const formatMoney = (value: number): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value || 0);

export const formatPercent = (value: number): string => `${((value || 0) * 100).toFixed(1)}%`;
