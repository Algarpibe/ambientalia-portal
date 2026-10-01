import { describe, it, expect } from 'vitest';
import type { ReconciledRow } from '../types';
import { computeReceivablesAging, overdueBalanceByClient, topOverdueClients } from './agingMetrics';
import { clientIdentity } from './clientIdentity';

function row(over: Partial<ReconciledRow> = {}): ReconciledRow {
  return {
    invoiceNumber: 'INV', orderNumber: 'OC', clientName: 'ACME',
    invoiceDate: '1 ene 2026', dueDate: '1 ene 2026', status: 'sent',
    total: 0, balance: 0,
    paymentDates: [], paymentAmounts: [], totalPaid: 0,
    isOverdue: false, maxDelayDays: 0, paymentDetails: [],
    ...over,
  };
}

const TODAY = new Date(2026, 8, 29); // 29 Sep 2026
const owed = (dueDate: string, balance: number, clientName = 'ACME') => row({ dueDate, balance, total: balance, clientName });

describe('computeReceivablesAging', () => {
  it('puts each open balance in its bucket, with the right boundaries', () => {
    const aging = computeReceivablesAging(
      [
        owed('15 oct 2026', 100),       // not due yet
        owed('29 sep 2026', 50),        // due today → not overdue
        owed('19 sep 2026', 200),       // 10 days
        owed('30 ago 2026', 300),       // 30 days
        owed('29 ago 2026', 400),       // 31 days
        owed('31 jul 2026', 10),        // 60 days
        owed('30 jul 2026', 20),        // 61 days
        owed('1 jul 2026', 500),        // 90 days
        owed('30 jun 2026', 30),        // 91 days
        owed('10 mar 2020', 600),       // 2020 is included in the snapshot
      ],
      TODAY,
    );
    const byKey = Object.fromEntries(aging.buckets.map((b) => [b.key, b.balance]));
    expect(aging.buckets.map((b) => b.key)).toEqual(['notDue', 'd1_30', 'd31_60', 'd61_90', 'over90']);
    expect(byKey).toEqual({ notDue: 150, d1_30: 500, d31_60: 410, d61_90: 520, over90: 630 });
    expect(aging.overdueBalance).toBe(2060);
    expect(aging.overdueInvoiceCount).toBe(8);
  });

  it('counts invoices and distinct clients per bucket (spelling variants merged)', () => {
    const aging = computeReceivablesAging(
      [owed('19 sep 2026', 1, 'ACME S.A.S'), owed('20 sep 2026', 1, ' acme  s.a.s '), owed('21 sep 2026', 1, 'Otro')],
      TODAY,
    );
    const d1_30 = aging.buckets.find((b) => b.key === 'd1_30')!;
    expect(d1_30).toMatchObject({ invoiceCount: 3, clientCount: 2, balance: 3 });
  });

  it('ignores paid, void and draft invoices and unreadable due dates', () => {
    const aging = computeReceivablesAging(
      [
        owed('19 sep 2026', 0),
        row({ dueDate: '19 sep 2026', balance: 70, status: 'void' }),
        row({ dueDate: '19 sep 2026', balance: 70, status: 'draft' }),
        row({ dueDate: null, balance: 70 }),
        row({ dueDate: '19 sep 2026', balance: NaN }),
      ],
      TODAY,
    );
    expect(aging.buckets.every((b) => b.invoiceCount === 0 && b.balance === 0)).toBe(true);
    expect(aging.overdueBalance).toBe(0);
  });
});

describe('overdueBalanceByClient', () => {
  it('sums only overdue balances, per normalized client', () => {
    const map = overdueBalanceByClient(
      [owed('19 sep 2026', 100, 'ACME S.A.S'), owed('10 mar 2020', 50, 'acme s.a.s'), owed('15 oct 2026', 999, 'ACME S.A.S')],
      TODAY,
    );
    expect(map.get('ACME S.A.S')).toBe(150);
    expect(map.size).toBe(1);
  });
});

describe('non-COP invoices', () => {
  it('excludes them from buckets and overdue totals and counts them apart', () => {
    const usd = (dueDate: string, balance: number) => row({ dueDate, balance, total: balance, currencyCode: 'USD' });
    const aging = computeReceivablesAging(
      [owed('19 sep 2026', 100), usd('19 sep 2026', 5000), usd('15 oct 2026', 7)],
      TODAY,
    );
    expect(aging.overdueBalance).toBe(100);
    expect(aging.overdueInvoiceCount).toBe(1);
    expect(aging.buckets.reduce((s, b) => s + b.balance, 0)).toBe(100);
    expect(aging.otherCurrencyInvoiceCount).toBe(2);
  });

  it('is 0 when every open invoice is in COP', () => {
    expect(computeReceivablesAging([owed('19 sep 2026', 100)], TODAY).otherCurrencyInvoiceCount).toBe(0);
  });

  it('overdueBalanceByClient ignores non-COP balances', () => {
    const map = overdueBalanceByClient(
      [owed('19 sep 2026', 100), row({ dueDate: '19 sep 2026', balance: 9000, total: 9000, currencyCode: 'USD' })],
      TODAY,
    );
    expect(map.get('ACME')).toBe(100);
  });
});

describe('topOverdueClients', () => {
  it('orders clients by overdue balance, largest first', () => {
    const top = topOverdueClients(
      [owed('19 sep 2026', 100, 'Beta'), owed('19 sep 2026', 500, 'Alfa'), owed('19 sep 2026', 300, 'Gamma')],
      TODAY,
    );
    expect(top).toEqual([
      { name: 'Alfa', overdueBalance: 500 },
      { name: 'Gamma', overdueBalance: 300 },
      { name: 'Beta', overdueBalance: 100 },
    ]);
  });

  it('merges spelling variants and shows the first spelling seen', () => {
    const top = topOverdueClients(
      [owed('19 sep 2026', 100, 'ACME S.A.S'), owed('20 sep 2026', 50, ' acme  s.a.s ')],
      TODAY,
    );
    expect(top).toEqual([{ name: 'ACME S.A.S', overdueBalance: 150 }]);
  });

  it('leaves out not-yet-due and non-COP balances', () => {
    const top = topOverdueClients(
      [
        owed('15 oct 2026', 900, 'Futuro'),
        owed('29 sep 2026', 800, 'Hoy'),
        row({ dueDate: '19 sep 2026', balance: 700, total: 700, clientName: 'Dolares', currencyCode: 'USD' }),
        owed('19 sep 2026', 10, 'Vencido'),
      ],
      TODAY,
    );
    expect(top).toEqual([{ name: 'Vencido', overdueBalance: 10 }]);
  });

  it('breaks ties by name', () => {
    const top = topOverdueClients([owed('19 sep 2026', 5, 'Zeta'), owed('19 sep 2026', 5, 'Alfa')], TODAY);
    expect(top.map((c) => c.name)).toEqual(['Alfa', 'Zeta']);
  });

  it('honors the limit (default 10)', () => {
    const rows = Array.from({ length: 12 }, (_, i) => owed('19 sep 2026', i + 1, `Cliente ${i}`));
    expect(topOverdueClients(rows, TODAY)).toHaveLength(10);
    expect(topOverdueClients(rows, TODAY, 3).map((c) => c.overdueBalance)).toEqual([12, 11, 10]);
  });

  it('returns an empty list when nothing is overdue', () => {
    expect(topOverdueClients([], TODAY)).toEqual([]);
    expect(topOverdueClients([owed('15 oct 2026', 100)], TODAY)).toEqual([]);
  });
});

describe('bucket invoices', () => {
  const inv = (invoiceNumber: string, dueDate: string, balance: number, clientName = 'ACME') =>
    row({ invoiceNumber, dueDate, balance, total: balance, clientName });
  const bucket = (aging: ReturnType<typeof computeReceivablesAging>, key: string) =>
    aging.buckets.find((b) => b.key === key)!;

  it('lists the invoices behind each bucket, matching its count and balance', () => {
    const aging = computeReceivablesAging(
      [
        inv('A-1', '19 sep 2026', 200, 'ACME S.A.S'),
        inv('A-2', '20 sep 2026', 300, 'Otro'),
        inv('B-1', '15 oct 2026', 50),
        inv('C-1', '30 jun 2026', 70),
      ],
      TODAY,
    );
    const d1_30 = bucket(aging, 'd1_30');
    expect(d1_30.invoices).toHaveLength(d1_30.invoiceCount);
    expect(d1_30.invoices.reduce((s, i) => s + i.balance, 0)).toBe(d1_30.balance);
    expect(d1_30.invoices[0]).toMatchObject({ invoiceNumber: 'A-2', clientName: 'Otro', balance: 300, daysPastDue: 9 });
    expect(d1_30.invoices[0].dueDate).toEqual(new Date(2026, 8, 20));
    expect(bucket(aging, 'notDue').invoices).toEqual([
      expect.objectContaining({ invoiceNumber: 'B-1', daysPastDue: -16 }),
    ]);
    expect(bucket(aging, 'over90').invoices.map((i) => i.invoiceNumber)).toEqual(['C-1']);
    expect(bucket(aging, 'd31_60').invoices).toEqual([]);
  });

  it('sorts by balance descending, then invoice number ascending', () => {
    const aging = computeReceivablesAging(
      [inv('Z-9', '19 sep 2026', 100), inv('A-1', '19 sep 2026', 100), inv('M-5', '19 sep 2026', 500)],
      TODAY,
    );
    expect(bucket(aging, 'd1_30').invoices.map((i) => i.invoiceNumber)).toEqual(['M-5', 'A-1', 'Z-9']);
  });

  it('uses the normalized client name and leaves out non-COP invoices', () => {
    const aging = computeReceivablesAging(
      [
        inv('A-1', '19 sep 2026', 100, ' acme  s.a.s '),
        row({ invoiceNumber: 'USD-1', dueDate: '19 sep 2026', balance: 9000, total: 9000, currencyCode: 'USD' }),
      ],
      TODAY,
    );
    const list = bucket(aging, 'd1_30').invoices;
    expect(list.map((i) => i.invoiceNumber)).toEqual(['A-1']);
    expect(list[0].clientName).toBe(clientIdentity(' acme  s.a.s ').name);
  });
});
