import { describe, it, expect } from 'vitest';
import type { InvoiceDetails, PaymentRecord } from './types';
import { reconcileInvoices, formatExcelDate, INTERNAL_CLIENT } from './reconcile';

function invoice(over: Partial<InvoiceDetails> = {}): InvoiceDetails {
  return {
    invoiceNumber: 'AM100', orderNumber: '', clientName: 'ACME',
    invoiceDate: '2026-09-01', dueDate: '2026-09-15', status: 'sent',
    total: 1000, balance: 0,
    ...over,
  };
}

function payment(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    paymentNumber: 'P1', clientName: 'ACME', invoiceNumber: 'AM100',
    paymentDate: '2026-09-10', amountFCY: 1000, unusedFCY: 0, amountBCY: 1000, unusedBCY: 0,
    ...over,
  };
}

const NOW = new Date(2026, 8, 29); // 29 Sep 2026

describe('formatExcelDate', () => {
  it('formats as dd/mm/yyyy and returns empty for unreadable values', () => {
    expect(formatExcelDate('2026-09-05')).toBe('05/09/2026');
    expect(formatExcelDate(new Date(2026, 0, 2))).toBe('02/01/2026');
    expect(formatExcelDate(null)).toBe('');
    expect(formatExcelDate('no es fecha')).toBe('');
  });
});

describe('reconcileInvoices', () => {
  it('excludes the internal client', () => {
    const rows = reconcileInvoices([invoice(), invoice({ clientName: INTERNAL_CLIENT })], [], NOW);
    expect(rows.map((r) => r.clientName)).toEqual(['ACME']);
  });

  it('matches payments by invoice number ignoring case and spaces', () => {
    const [row] = reconcileInvoices([invoice()], [payment({ invoiceNumber: ' am100 ' })], NOW);
    expect(row.paymentDetails).toHaveLength(1);
    expect(row.totalPaid).toBe(1000);
    expect(row.paymentAmounts).toEqual([1000]);
  });

  it('gives an on-time payment a delay of 0 and a late one its days', () => {
    const [row] = reconcileInvoices(
      [invoice()],
      [payment({ paymentDate: '2026-09-10' }), payment({ paymentNumber: 'P2', paymentDate: '2026-09-20' })],
      NOW,
    );
    expect(row.paymentDetails).toEqual([
      { date: '10/09/2026', delay: 0 },
      { date: '20/09/2026', delay: 5 },
    ]);
    expect(row.paymentDates).toEqual(['10/09/2026', '20/09/2026']);
    expect(row.isOverdue).toBe(true);
    expect(row.maxDelayDays).toBe(5);
  });

  it('ages an unpaid overdue balance up to now', () => {
    const [row] = reconcileInvoices([invoice({ balance: 1000 })], [], NOW);
    expect(row.isOverdue).toBe(true);
    expect(row.maxDelayDays).toBe(14);
    expect(row.paymentDetails).toEqual([]);
  });

  it('does not flag an invoice that is paid on time and has no balance', () => {
    const [row] = reconcileInvoices([invoice()], [payment()], NOW);
    expect(row.isOverdue).toBe(false);
    expect(row.maxDelayDays).toBe(0);
  });

  it('keeps every invoice field', () => {
    const [row] = reconcileInvoices([invoice({ status: 'partially_paid' })], [], NOW);
    expect(row.status).toBe('partially_paid');
    expect(row.invoiceNumber).toBe('AM100');
  });
});
