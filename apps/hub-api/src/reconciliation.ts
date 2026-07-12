import type { Pool } from '@algarpibe/zoho-sync';
import { mapInvoiceRow, mapPaymentRow, type InvoiceDetails, type PaymentRecord } from './mappers.js';

export interface ReconciliationData {
  invoices: InvoiceDetails[];
  payments: PaymentRecord[];
}

// ---------------------------------------------------------------------------
// SCHEMA NOTE (verify with /debug/schema against the live hub — see index.ts):
// - books.invoices real columns (from @algarpibe/zoho-sync BooksInvoice):
//   invoice_number, reference_number, customer_name, date, due_date, status,
//   total, bcy_total, raw (full Zoho object), ...  There is NO typed `balance`
//   column, so we read the outstanding balance from the raw Zoho object
//   (raw->>'balance'), falling back to total.
// - Customer payments are NOT typed by the package. The query below assumes a
//   `books.customer_payments` table whose `raw` holds Zoho's `invoices` array
//   (one applied invoice per element). CONFIRM table/columns via /debug/schema
//   and adjust `paymentsSql` if the hub stores them differently.
// ---------------------------------------------------------------------------

export async function getInvoices(db: Pool, from?: string, to?: string): Promise<InvoiceDetails[]> {
  const hasRange = Boolean(from && to);
  const sql = `
    SELECT i.invoice_number,
           i.reference_number,
           i.customer_name,
           i.date,
           i.due_date,
           i.status,
           i.total,
           COALESCE(NULLIF((i.raw::jsonb) ->> 'balance', '')::numeric, i.total, 0) AS balance
      FROM books.invoices i
      ${hasRange ? 'WHERE i.date BETWEEN $1 AND $2' : ''}
      ORDER BY i.date`;
  const { rows } = await db.query(sql, hasRange ? [from, to] : []);
  return rows.map(mapInvoiceRow);
}

export async function getPayments(db: Pool): Promise<PaymentRecord[]> {
  // Best-effort against books.customer_payments with Zoho's applied-invoices
  // array in `raw`. Adjust after confirming the real schema via /debug/schema.
  const sql = `
    SELECT p.payment_number,
           p.customer_name,
           app ->> 'invoice_number'                      AS invoice_number,
           p.date,
           (app ->> 'amount_applied')::numeric           AS amount_fcy,
           0                                             AS unused_amount_fcy,
           (app ->> 'amount_applied')::numeric           AS amount_bcy,
           0                                             AS unused_amount_bcy
      FROM books.customer_payments p
      CROSS JOIN LATERAL jsonb_array_elements((p.raw::jsonb) -> 'invoices') AS app`;
  const { rows } = await db.query(sql, []);
  return rows.map(mapPaymentRow);
}

export async function getReconciliationData(
  db: Pool,
  from?: string,
  to?: string
): Promise<ReconciliationData> {
  const [invoices, payments] = await Promise.all([getInvoices(db, from, to), getPayments(db)]);
  return { invoices, payments };
}
