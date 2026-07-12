import type { Pool } from '@algarpibe/zoho-sync';
import { mapInvoiceRow, mapPaymentRow, type InvoiceDetails, type PaymentRecord } from './mappers.js';

export interface ReconciliationData {
  invoices: InvoiceDetails[];
  payments: PaymentRecord[];
}

// ---------------------------------------------------------------------------
// SCHEMA (confirmed via /debug/schema + the zoho-hub-sync worker):
// - books.invoices: invoice_number, reference_number, customer_name, date,
//   due_date, status, total, raw (jsonb). No `balance` column → balance comes
//   from the raw Zoho object (raw->>'balance'), falling back to total.
// - books.customer_payments (payment_id, payment_number, customer_name, date,
//   exchange_rate, amount, ...) + books.customer_payment_invoices
//   (payment_id, invoice_number, amount_applied, ...): one applied-invoice row
//   per (payment, invoice). amount_applied is in the invoice currency (FCY),
//   consistent with invoices.total; BCY = amount_applied * exchange_rate.
// ---------------------------------------------------------------------------

export async function getInvoices(db: Pool, from?: string, to?: string): Promise<InvoiceDetails[]> {
  const hasRange = Boolean(from && to);
  const sql = `
    SELECT i.invoice_number,
           i.reference_number,
           i.customer_name,
           i.date::text          AS date,
           i.due_date::text       AS due_date,
           i.status,
           i.total,
           COALESCE(NULLIF((i.raw::jsonb) ->> 'balance', '')::numeric, i.total, 0) AS balance
      FROM books.invoices i
      ${hasRange ? 'WHERE i.date BETWEEN $1 AND $2' : ''}
      ORDER BY i.date`;
  const { rows } = await db.query(sql, hasRange ? [from, to] : []);
  return rows.map(mapInvoiceRow);
}

export async function getPayments(db: Pool, from?: string, to?: string): Promise<PaymentRecord[]> {
  // One PaymentRecord per applied invoice, joining the payment header with its
  // applied-invoice lines. amount_applied is FCY (invoice currency); BCY is
  // derived with the payment's exchange_rate. Unused amounts are payment-level,
  // not attributable to a single applied invoice, so they are 0 here.
  const hasRange = Boolean(from && to);
  const sql = `
    SELECT p.payment_number,
           p.customer_name,
           cpi.invoice_number,
           p.date::text                                        AS date,
           cpi.amount_applied                                  AS amount_fcy,
           0                                                   AS unused_amount_fcy,
           cpi.amount_applied * COALESCE(p.exchange_rate, 1)   AS amount_bcy,
           0                                                   AS unused_amount_bcy
      FROM books.customer_payments p
      JOIN books.customer_payment_invoices cpi ON cpi.payment_id = p.payment_id
      ${hasRange ? 'WHERE p.date BETWEEN $1 AND $2' : ''}`;
  const { rows } = await db.query(sql, hasRange ? [from, to] : []);
  return rows.map(mapPaymentRow);
}

export async function getReconciliationData(
  db: Pool,
  from?: string,
  to?: string
): Promise<ReconciliationData> {
  const [invoices, payments] = await Promise.all([
    getInvoices(db, from, to),
    getPayments(db, from, to),
  ]);
  return { invoices, payments };
}
