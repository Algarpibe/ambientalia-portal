import { describe, it, expect } from 'vitest';
import type { ReconciledRow } from '../types';
import { computeWorseningClients } from './worseningClients';

function row(over: Partial<ReconciledRow> = {}): ReconciledRow {
  return {
    invoiceNumber: 'INV', orderNumber: 'OC', clientName: 'ACME',
    invoiceDate: '1 ene 2025', dueDate: '1 ene 2025', status: 'paid',
    total: 100, balance: 0,
    paymentDates: [], paymentAmounts: [], totalPaid: 0,
    isOverdue: false, maxDelayDays: 0, paymentDetails: [],
    ...over,
  };
}

const paid = (clientName: string, dueDate: string, delay: number) =>
  row({ clientName, dueDate, paymentDetails: [{ date: 'x', delay }] });

const TODAY = new Date(2026, 8, 29);

const DATA: ReconciledRow[] = [
  paid('Cliente A', '10 mar 2025', 5), paid('Cliente A', '10 abr 2025', 15),
  paid('Cliente A', '5 ene 2026', 30),
  row({ clientName: 'Cliente A', dueDate: '19 sep 2026', total: 1000, balance: 1000 }), // 10 days, unpaid
  paid('Cliente B', '10 mar 2025', 20), paid('Cliente B', '10 abr 2025', 20),
  paid('Cliente B', '5 ene 2026', 25), paid('Cliente B', '10 feb 2026', 25),
  paid('Cliente C', '10 mar 2025', 10), paid('Cliente C', '10 abr 2025', 10),
  paid('Cliente C', '5 ene 2026', 0), paid('Cliente C', '10 feb 2026', 0),
  paid('Cliente D', '10 mar 2025', 40),
  paid('Cliente D', '5 ene 2026', 90), paid('Cliente D', '10 feb 2026', 90),
];

describe('computeWorseningClients', () => {
  it('compares the current year to date with the previous full year', () => {
    const result = computeWorseningClients(DATA, TODAY);
    expect(result.previousYear).toBe(2025);
    expect(result.currentYear).toBe(2026);
  });

  it('lists only clients whose average DPD rose, biggest increase first', () => {
    const { clients } = computeWorseningClients(DATA, TODAY);
    expect(clients.map((c) => c.name)).toEqual(['Cliente A', 'Cliente B']);
    expect(clients[0]).toEqual({ name: 'Cliente A', previousDPD: 10, currentDPD: 20, change: 10, overdueBalance: 1000 });
    expect(clients[1]).toMatchObject({ previousDPD: 20, currentDPD: 25, change: 5, overdueBalance: 0 });
  });

  it('requires at least 2 due invoices in each year', () => {
    const { clients } = computeWorseningClients(DATA, TODAY);
    expect(clients.find((c) => c.name === 'Cliente D')).toBeUndefined();
  });

  it('merges spelling variants of a client', () => {
    const { clients } = computeWorseningClients(
      [
        paid('ACME S.A.S', '10 mar 2025', 0), paid('acme  s.a.s', '10 abr 2025', 0),
        paid(' ACME S.A.S ', '5 ene 2026', 20), paid('ACME S.A.S', '10 feb 2026', 20),
      ],
      TODAY,
    );
    expect(clients).toEqual([{ name: 'ACME S.A.S', previousDPD: 0, currentDPD: 20, change: 20, overdueBalance: 0 }]);
  });

  it('honors the limit', () => {
    expect(computeWorseningClients(DATA, TODAY, 1).clients.map((c) => c.name)).toEqual(['Cliente A']);
  });
});
