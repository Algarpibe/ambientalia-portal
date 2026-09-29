import type { InvoiceDetails, PaymentRecord, ReconciledRow } from './types';
import { parseExcelDate } from './customerAnalysisUtils';

// Invoice ↔ payment matching shared by the app and the Dashboard widgets, so
// both compute identical rows.

/** Internal movements, excluded from every analysis. */
export const INTERNAL_CLIENT = 'Ambientalia S.A.S.';

const DAY_MS = 1000 * 60 * 60 * 24;

const invoiceKey = (value: string) => value.trim().toUpperCase();

/** dd/mm/yyyy, or '' when the value is not a readable date. */
export function formatExcelDate(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : parseExcelDate(value);
  if (!date || isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

export function reconcileInvoices(
  invoices: InvoiceDetails[],
  payments: PaymentRecord[],
  now: Date = new Date(),
): ReconciledRow[] {
  const paymentsByInvoice = new Map<string, PaymentRecord[]>();
  for (const p of payments) {
    const key = invoiceKey(p.invoiceNumber);
    const list = paymentsByInvoice.get(key);
    if (list) list.push(p);
    else paymentsByInvoice.set(key, [p]);
  }

  return invoices
    .filter((invoice) => invoice.clientName !== INTERNAL_CLIENT)
    .map((invoice) => {
      const matchingPayments = paymentsByInvoice.get(invoiceKey(invoice.invoiceNumber)) ?? [];
      const dueDate = invoice.dueDate instanceof Date ? invoice.dueDate : parseExcelDate(invoice.dueDate);

      let isOverdue = false;
      let maxDelayDays = 0;

      const paymentDetails = matchingPayments.map((p) => {
        const pDate = p.paymentDate instanceof Date ? p.paymentDate : parseExcelDate(p.paymentDate);
        let delay = 0;
        if (pDate && dueDate && pDate > dueDate) {
          isOverdue = true;
          delay = Math.ceil(Math.abs(pDate.getTime() - dueDate.getTime()) / DAY_MS);
          if (delay > maxDelayDays) maxDelayDays = delay;
        }
        return { date: formatExcelDate(pDate), delay };
      });

      // An outstanding balance past its due date keeps aging, with or without payments.
      if (dueDate && now > dueDate && invoice.balance > 0) {
        isOverdue = true;
        const currentDelay = Math.ceil(Math.abs(now.getTime() - dueDate.getTime()) / DAY_MS);
        if (currentDelay > maxDelayDays) maxDelayDays = currentDelay;
      }

      return {
        ...invoice,
        paymentDates: paymentDetails.map((pd) => pd.date),
        paymentAmounts: matchingPayments.map((p) => p.amountFCY),
        totalPaid: matchingPayments.reduce((sum, p) => sum + p.amountFCY, 0),
        isOverdue,
        maxDelayDays,
        paymentDetails,
      };
    });
}
