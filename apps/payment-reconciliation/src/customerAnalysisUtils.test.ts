// Fijar TZ a Bogotá (UTC-5) ANTES de importar: así el bug de "un día menos" se
// reproduce si se rompe el parseo (en UTC no se manifestaría).
process.env.TZ = 'America/Bogota';

import { describe, it, expect } from 'vitest';
import { parseExcelDate, calculateInvoiceDPD } from './customerAnalysisUtils';
import type { ReconciledRow } from './types';

describe('parseExcelDate', () => {
  it('parsea YYYY-MM-DD como fecha LOCAL (no corre un día en UTC-5)', () => {
    const d = parseExcelDate('2026-04-06')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // abril (0-based)
    expect(d.getDate()).toBe(6);  // clave: NO se corre a 5
  });

  it('la fecha de vencimiento tampoco se corre', () => {
    const d = parseExcelDate('2026-05-06')!;
    expect(d.getMonth()).toBe(4); // mayo
    expect(d.getDate()).toBe(6);
  });

  it('respeta el formato "DD mon YYYY" en español', () => {
    const d = parseExcelDate('6 abr 2026')!;
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(6);
  });

  it('mantiene el parseo de timestamps ISO completos (con hora/zona)', () => {
    // Con hora explícita SÍ se respeta la zona; no debe entrar al branch date-only.
    const d = parseExcelDate('2026-04-06T12:00:00Z')!;
    expect(d instanceof Date).toBe(true);
    expect(isNaN(d.getTime())).toBe(false);
  });

  it('devuelve null para vacío/nulo', () => {
    expect(parseExcelDate('')).toBeNull();
    expect(parseExcelDate(null)).toBeNull();
  });
});

describe('calculateInvoiceDPD with a reference date', () => {
  it('measures an unpaid invoice against the given date', () => {
    const invoice = {
      invoiceNumber: 'X', orderNumber: '', clientName: 'ACME',
      invoiceDate: '1 sep 2026', dueDate: '15 sep 2026', status: 'open',
      total: 50, balance: 50,
      paymentDates: [], paymentAmounts: [], totalPaid: 0,
      isOverdue: true, maxDelayDays: 0, paymentDetails: [],
    } as ReconciledRow;
    expect(calculateInvoiceDPD(invoice, new Date(2026, 8, 29))).toBe(14);
  });
});

describe('calculateInvoiceDPD with payments and an outstanding balance', () => {
  const NOW = new Date(2026, 8, 29);
  const make = (over: Partial<ReconciledRow>) => ({
    invoiceNumber: 'X', orderNumber: '', clientName: 'ACME',
    invoiceDate: '1 sep 2026', dueDate: '15 sep 2026', status: 'partially_paid',
    total: 1000, balance: 900,
    paymentDates: [], paymentAmounts: [], totalPaid: 100,
    isOverdue: true, maxDelayDays: 0,
    paymentDetails: [{ date: '01/09/2026', delay: 0 }],
    ...over,
  }) as ReconciledRow;

  it('counts the overdue balance when the partial payment was on time', () => {
    expect(calculateInvoiceDPD(make({}), NOW)).toBe(14);
  });

  it('keeps the payment delay when it exceeds the days to the reference date', () => {
    expect(calculateInvoiceDPD(make({ paymentDetails: [{ date: 'x', delay: 30 }] }), NOW)).toBe(30);
  });

  it('uses only the payment delay when the invoice is fully paid', () => {
    expect(calculateInvoiceDPD(make({ balance: 0, paymentDetails: [{ date: 'x', delay: 5 }] }), NOW)).toBe(5);
  });

  it('does not penalise a partially paid invoice that is not yet due', () => {
    expect(calculateInvoiceDPD(make({ dueDate: '15 oct 2026', paymentDetails: [{ date: 'x', delay: 0 }] }), NOW)).toBe(0);
  });
});
