// Agregación de conciliación — funciones puras reutilizables por los widgets del
// Dashboard del Portal. Reproducen el cálculo del componente de la app
// (mismos nombres de campo: invoices/payments del hub de Zoho) en una forma
// independiente y sin estado.

export interface ReconciliationSummary {
  totalInvoiced: number;   // suma de total de facturas
  totalReconciled: number; // total conciliado/pagado (total - saldo)
  totalPending: number;    // saldo pendiente por conciliar
  invoiceCount: number;    // nº de facturas
  reconciledPercent: number; // % conciliado (pagado / facturado)
}

export interface CustomerPending {
  name: string;
  pending: number;   // saldo pendiente acumulado
  invoiced: number;  // total facturado acumulado
  count: number;     // nº de facturas
}

function parseNumber(val: unknown): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const clean = String(val).replace(/[^0-9.-]+/g, '');
  return parseFloat(clean) || 0;
}

// Se excluyen los movimientos internos (igual que la app en reconcile()).
const INTERNAL_CLIENT = 'Ambientalia S.A.S.';

/** Calcula el resumen consolidado de conciliación a partir de las facturas del hub. */
export function summarize(invoices: any[]): ReconciliationSummary {
  const empty: ReconciliationSummary = {
    totalInvoiced: 0,
    totalReconciled: 0,
    totalPending: 0,
    invoiceCount: 0,
    reconciledPercent: 0,
  };
  if (!Array.isArray(invoices) || invoices.length === 0) return empty;

  let totalInvoiced = 0;
  let totalPending = 0;
  let invoiceCount = 0;

  for (const inv of invoices) {
    if (inv?.clientName === INTERNAL_CLIENT) continue;
    totalInvoiced += parseNumber(inv?.total);
    totalPending += parseNumber(inv?.balance);
    invoiceCount += 1;
  }

  const totalReconciled = totalInvoiced - totalPending;

  return {
    totalInvoiced,
    totalReconciled,
    totalPending,
    invoiceCount,
    reconciledPercent: totalInvoiced ? totalReconciled / totalInvoiced : 0,
  };
}

/** Agrupa el saldo pendiente por cliente, ordenado de mayor a menor pendiente. */
export function pendingByCustomer(invoices: any[]): CustomerPending[] {
  if (!Array.isArray(invoices) || invoices.length === 0) return [];

  const byCustomer: Record<string, CustomerPending> = {};

  for (const inv of invoices) {
    const name = inv?.clientName || 'Cliente General';
    if (name === INTERNAL_CLIENT) continue;
    const balance = parseNumber(inv?.balance);
    const total = parseNumber(inv?.total);

    const c = (byCustomer[name] ??= { name, pending: 0, invoiced: 0, count: 0 });
    c.pending += balance;
    c.invoiced += total;
    c.count += 1;
  }

  return Object.values(byCustomer)
    .filter((c) => c.pending > 0)
    .sort((a, b) => b.pending - a.pending);
}

// ─── Formateo compartido ─────────────────────────────────────────────────────

export const formatMoney = (value: number): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value || 0);

export const formatPercent = (value: number): string => `${((value || 0) * 100).toFixed(1)}%`;
