import { describe, it, expect } from 'vitest';
import { mapInvoiceRow, mapPaymentRow } from './mappers.js';

describe('mapInvoiceRow', () => {
  it('maps a hub invoice row to InvoiceDetails', () => {
    const row = {
      invoice_number: 'INV-000123',
      reference_number: 'SO-45',
      customer_name: 'ACME S.A.S.',
      date: '2026-01-15',
      due_date: '2026-02-14',
      status: 'overdue',
      total: 1190000,
      balance: 500000,
    };
    expect(mapInvoiceRow(row)).toEqual({
      invoiceNumber: 'INV-000123',
      orderNumber: 'SO-45',
      clientName: 'ACME S.A.S.',
      invoiceDate: '2026-01-15',
      dueDate: '2026-02-14',
      status: 'overdue',
      total: 1190000,
      balance: 500000,
    });
  });

  it('coerces null money/reference to safe defaults', () => {
    const row = {
      invoice_number: 'INV-1', customer_name: 'X', date: '2026-01-01',
      due_date: null, status: null, total: null, balance: null, reference_number: null,
    };
    const out = mapInvoiceRow(row);
    expect(out.total).toBe(0);
    expect(out.balance).toBe(0);
    expect(out.orderNumber).toBe('');
    expect(out.status).toBe('');
  });
});

describe('mapPaymentRow', () => {
  it('maps a hub payment-application row to PaymentRecord', () => {
    const row = {
      payment_number: 'PMT-9',
      customer_name: 'ACME S.A.S.',
      invoice_number: 'INV-000123',
      date: '2026-02-01',
      amount_fcy: 500000,
      unused_amount_fcy: 0,
      amount_bcy: 500000,
      unused_amount_bcy: 0,
    };
    expect(mapPaymentRow(row)).toEqual({
      paymentNumber: 'PMT-9',
      clientName: 'ACME S.A.S.',
      invoiceNumber: 'INV-000123',
      paymentDate: '2026-02-01',
      amountFCY: 500000,
      unusedFCY: 0,
      amountBCY: 500000,
      unusedBCY: 0,
    });
  });

  it('coerces null amounts to 0', () => {
    const row = {
      payment_number: 'PMT-1', customer_name: 'X', invoice_number: 'INV-1', date: '2026-01-01',
      amount_fcy: null, unused_amount_fcy: null, amount_bcy: null, unused_amount_bcy: null,
    };
    const out = mapPaymentRow(row);
    expect(out.amountFCY).toBe(0);
    expect(out.unusedFCY).toBe(0);
    expect(out.amountBCY).toBe(0);
    expect(out.unusedBCY).toBe(0);
  });
});
