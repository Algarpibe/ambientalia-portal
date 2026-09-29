import { describe, it, expect } from 'vitest';
import { summarize, pendingByCustomer, openInvoices } from './analysis';

const inv = (over: Record<string, unknown>) => ({
  invoiceNumber: 'F1', clientName: 'ACME', invoiceDate: '2026-01-01', dueDate: '2026-02-01',
  total: 1000, balance: 400, currencyCode: 'COP', ...over,
});

describe('summarize', () => {
  it('sums COP only and counts every invoice', () => {
    const s = summarize([
      inv({ total: 1000, balance: 400 }),
      inv({ invoiceNumber: 'F2', total: 500, balance: 500, currencyCode: 'USD' }),
    ]);
    expect(s.totalInvoiced).toBe(1000);
    expect(s.totalPending).toBe(400);
    expect(s.totalReconciled).toBe(600);
    expect(s.reconciledPercent).toBeCloseTo(0.6);
    expect(s.invoiceCount).toBe(2);
  });

  it('treats a missing currency as COP and skips the internal client', () => {
    const s = summarize([inv({ currencyCode: undefined }), inv({ clientName: 'Ambientalia S.A.S.' })]);
    expect(s.totalInvoiced).toBe(1000);
    expect(s.invoiceCount).toBe(1);
  });
});

describe('pendingByCustomer', () => {
  it('ignores non-COP amounts but still ranks COP debt', () => {
    const rows = pendingByCustomer([
      inv({ balance: 400 }),
      inv({ invoiceNumber: 'F2', total: 9000, balance: 9000, currencyCode: 'USD' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'ACME', pending: 400, invoiced: 1000, count: 2 });
  });

  it('omits a customer whose only pending balance is in another currency', () => {
    expect(pendingByCustomer([inv({ balance: 300, currencyCode: 'EUR' })])).toEqual([]);
  });
});

describe('openInvoices', () => {
  it('carries each invoice currency', () => {
    const rows = openInvoices(
      [inv({}), inv({ invoiceNumber: 'F2', currencyCode: ' usd ' }), inv({ invoiceNumber: 'F3', currencyCode: undefined })],
      ['partial', 'pending'],
    );
    const byNum = Object.fromEntries(rows.map((r) => [r.invoiceNumber, r.currency]));
    expect(byNum).toEqual({ F1: 'COP', F2: 'USD', F3: 'COP' });
  });
});
