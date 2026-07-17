// Agregación de conciliación — funciones puras reutilizables por los widgets del
// Dashboard del Portal. Reproducen el cálculo del componente de la app
// (mismos nombres de campo: invoices/payments del hub de Zoho) en una forma
// independiente y sin estado.

import { parseExcelDate } from '../customerAnalysisUtils';

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

// ─── Facturas abiertas (pestaña Conciliación por estado de pago) ─────────────

export type PaymentStatus = 'paid' | 'partial' | 'pending';

/**
 * Estado de pago de una factura. Replica EXACTAMENTE el criterio de la app
 * (App.tsx, filtro `selectedPaymentStatus`): saldo 0 → pagada; saldo menor que
 * el total → parcial; en cualquier otro caso → pendiente. No usar el campo
 * `status` de Zoho: la pantalla no lo usa para este filtro.
 */
export function paymentStatusOf(invoice: any): PaymentStatus {
  const balance = parseNumber(invoice?.balance);
  const total = parseNumber(invoice?.total);
  if (balance === 0) return 'paid';
  if (balance < total) return 'partial';
  return 'pending';
}

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: '✓ Pagado',
  partial: '◐ Parcial',
  pending: '○ Pendiente',
};

/** Una fila de la tabla de conciliación. */
export interface OpenInvoiceRow {
  invoiceNumber: string;
  clientName: string;
  invoiceDate: string;  // ya formateada dd/mm/aaaa
  dueDate: string;      // ya formateada dd/mm/aaaa
  total: number;
  balance: number;
  paidPercent: number;  // fracción pagada [0, 1]
  status: PaymentStatus;
  dueTime: number;      // vencimiento en ms para ordenar; Infinity si no hay fecha
}

/**
 * Facturas filtradas por estado de pago, excluyendo los movimientos internos
 * (igual que reconcile() en la app). Se ordenan por vencimiento ascendente: lo
 * más vencido primero, que es la lectura útil para cobranza.
 */
export function openInvoices(invoices: any[], statuses: PaymentStatus[]): OpenInvoiceRow[] {
  if (!Array.isArray(invoices) || invoices.length === 0) return [];
  const wanted = new Set(statuses);

  return invoices
    .filter((inv) => inv?.clientName !== INTERNAL_CLIENT)
    .filter((inv) => wanted.has(paymentStatusOf(inv)))
    .map((inv) => {
      const total = parseNumber(inv?.total);
      const balance = parseNumber(inv?.balance);
      const due = toDate(inv?.dueDate);
      return {
        invoiceNumber: String(inv?.invoiceNumber ?? ''),
        clientName: inv?.clientName || 'Cliente General',
        invoiceDate: formatDate(inv?.invoiceDate),
        dueDate: formatDate(inv?.dueDate),
        total,
        balance,
        paidPercent: total > 0 ? Math.min(1, Math.max(0, (total - balance) / total)) : 0,
        status: paymentStatusOf(inv),
        dueTime: due ? due.getTime() : Infinity,
      };
    })
    .sort((a, b) => a.dueTime - b.dueTime);
}

// ─── Formateo compartido ─────────────────────────────────────────────────────

/** Normaliza a Date los campos de fecha del hub (Date, serial de Excel o texto). */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = parseExcelDate(value);
  return d && !isNaN(d.getTime()) ? d : null;
}

/** Fecha dd/mm/aaaa; '' si no hay fecha válida. Mismo formato que la app. */
export function formatDate(value: unknown): string {
  const d = toDate(value);
  if (!d) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

export const formatMoney = (value: number): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value || 0);

export const formatPercent = (value: number): string => `${((value || 0) * 100).toFixed(1)}%`;
