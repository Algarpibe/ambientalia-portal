// Maps rows returned by the reconciliation queries (books.*) into the exact
// shapes the Conciliador SPA already consumes. Column names below are the
// source keys the queries must SELECT (see reconciliation.ts). `numeric`
// columns arrive as numbers because the hub pool registers a numeric parser.

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v));

export interface InvoiceDetails {
  invoiceNumber: string;
  orderNumber: string;
  clientName: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  total: number;
  balance: number;
}

export interface PaymentRecord {
  paymentNumber: string;
  clientName: string;
  invoiceNumber: string;
  paymentDate: string;
  amountFCY: number;
  unusedFCY: number;
  amountBCY: number;
  unusedBCY: number;
}

export function mapInvoiceRow(row: Record<string, unknown>): InvoiceDetails {
  return {
    invoiceNumber: str(row.invoice_number),
    orderNumber: str(row.reference_number),
    clientName: str(row.customer_name),
    invoiceDate: str(row.date),
    dueDate: str(row.due_date),
    status: str(row.status),
    total: num(row.total),
    balance: num(row.balance),
  };
}

export function mapPaymentRow(row: Record<string, unknown>): PaymentRecord {
  return {
    paymentNumber: str(row.payment_number),
    clientName: str(row.customer_name),
    invoiceNumber: str(row.invoice_number),
    paymentDate: str(row.date),
    amountFCY: num(row.amount_fcy),
    unusedFCY: num(row.unused_amount_fcy),
    amountBCY: num(row.amount_bcy),
    unusedBCY: num(row.unused_amount_bcy),
  };
}
