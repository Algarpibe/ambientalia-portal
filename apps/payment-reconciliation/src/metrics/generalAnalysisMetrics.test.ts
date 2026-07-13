import { describe, it, expect } from 'vitest';
import type { ReconciledRow, CustomerMetrics } from '../types';
import {
  applyExtraFilters,
  filterAndSortMetrics,
  computeTotalReconciled,
  computePreviousPeriodAmount,
  computeRevenueVariation,
  computeRecoveryRate,
  computeAverageDSO,
  computeOverdueMetrics,
  computeTopCustomersByVolume,
  computeCustomerRetention,
} from './generalAnalysisMetrics';

// Fábrica de ReconciledRow con defaults; se sobreescribe lo relevante por test.
function row(over: Partial<ReconciledRow> = {}): ReconciledRow {
  return {
    invoiceNumber: 'INV', orderNumber: 'OC', clientName: 'ACME',
    invoiceDate: '1 ene 2026', dueDate: '1 ene 2026', status: 'open',
    total: 0, balance: 0,
    paymentDates: [], paymentAmounts: [], totalPaid: 0,
    isOverdue: false, maxDelayDays: 0, paymentDetails: [],
    ...over,
  };
}

function metrics(over: Partial<CustomerMetrics> = {}): CustomerMetrics {
  return {
    customerName: 'ACME', totalInvoices: 1, totalInvoicesWithPayments: 1,
    averageDPD: 0, onTimePercentage: 100,
    latePaymentBands: {
      band1_15: { count: 0, percentage: 0, totalValue: 0 },
      band16_30: { count: 0, percentage: 0, totalValue: 0 },
      band31_60: { count: 0, percentage: 0, totalValue: 0 },
      bandOver60: { count: 0, percentage: 0, totalValue: 0 },
    },
    weightedDPD: 0, volatility: null, volatilityMora: null, totalInvoiceValue: 0,
    ...over,
  };
}

describe('computeTotalReconciled', () => {
  it('suma los totales', () => {
    expect(computeTotalReconciled([row({ total: 100 }), row({ total: 250 })])).toBe(350);
  });
  it('0 en conjunto vacío', () => {
    expect(computeTotalReconciled([])).toBe(0);
  });
});

describe('computeRevenueVariation', () => {
  it('calcula el % de variación', () => {
    expect(computeRevenueVariation(150, 100)).toBe(50);
    expect(computeRevenueVariation(80, 100)).toBeCloseTo(-20);
  });
  it('null si el periodo anterior es 0 (sin base)', () => {
    expect(computeRevenueVariation(100, 0)).toBeNull();
  });
});

describe('computeRecoveryRate', () => {
  it('% de facturas con al menos un pago', () => {
    const data = [
      row({ paymentDetails: [{ date: '5 ene 2026', delay: 0 }] }),
      row({ paymentDetails: [] }),
      row({ paymentDetails: [{ date: '6 ene 2026', delay: 0 }] }),
      row({ paymentDetails: [] }),
    ];
    expect(computeRecoveryRate(data)).toBe(50);
  });
  it('0 en conjunto vacío', () => {
    expect(computeRecoveryRate([])).toBe(0);
  });
});

describe('computeAverageDSO', () => {
  it('promedia los días entre vencimiento y último pago (ignora sin pago)', () => {
    const data = [
      row({ dueDate: '1 ene 2026', paymentDetails: [{ date: '11 ene 2026', delay: 10 }] }), // 10 días
      row({ dueDate: '1 ene 2026', paymentDetails: [] }),                                     // ignorada
      row({ dueDate: '1 ene 2026', paymentDetails: [{ date: '21 ene 2026', delay: 20 }] }), // 20 días
    ];
    expect(computeAverageDSO(data)).toBe(15);
  });
  it('usa el ÚLTIMO pago cuando hay varios', () => {
    const data = [
      row({ dueDate: '1 ene 2026', paymentDetails: [
        { date: '6 ene 2026', delay: 5 }, { date: '16 ene 2026', delay: 15 },
      ] }),
    ];
    expect(computeAverageDSO(data)).toBe(15);
  });
  it('0 si no hay facturas con pago', () => {
    expect(computeAverageDSO([row({ paymentDetails: [] })])).toBe(0);
  });
});

describe('computeOverdueMetrics', () => {
  it('cuenta clientes/facturas/monto en mora con saldo > 0', () => {
    const data = [
      row({ clientName: 'A', isOverdue: true, balance: 100 }),
      row({ clientName: 'A', isOverdue: true, balance: 50 }),
      row({ clientName: 'B', isOverdue: true, balance: 30 }),
      row({ clientName: 'C', isOverdue: true, balance: 0 }),   // saldo 0 → fuera
      row({ clientName: 'D', isOverdue: false, balance: 99 }), // no overdue → fuera
    ];
    expect(computeOverdueMetrics(data)).toEqual({ customerCount: 2, invoiceCount: 3, totalAmount: 180 });
  });
});

describe('computeTopCustomersByVolume', () => {
  it('agrupa por cliente, ordena desc y aplica top-N; ignora nombres vacíos', () => {
    const data = [
      row({ clientName: 'A', total: 100 }),
      row({ clientName: 'B', total: 300 }),
      row({ clientName: 'A', total: 100 }),
      row({ clientName: '   ', total: 999 }), // nombre vacío → ignorado
    ];
    expect(computeTopCustomersByVolume(data, 2)).toEqual([
      { name: 'B', total: 300 },
      { name: 'A', total: 200 },
    ]);
  });
});

describe('applyExtraFilters', () => {
  const data = [
    row({ total: 100, balance: 0 }),    // paid
    row({ total: 200, balance: 50 }),   // partial (balance < total)
    row({ total: 300, balance: 300 }),  // pending (balance == total, no es < total ni 0)
  ];
  it('sin filtros devuelve todo', () => {
    expect(applyExtraFilters(data, { selectedPaymentStatus: [], minAmount: '', maxAmount: '' })).toHaveLength(3);
  });
  it('filtra por estado de pago', () => {
    const out = applyExtraFilters(data, { selectedPaymentStatus: ['paid'], minAmount: '', maxAmount: '' });
    expect(out).toHaveLength(1);
    expect(out[0].total).toBe(100);
  });
  it('filtra por rango de monto (total)', () => {
    const out = applyExtraFilters(data, { selectedPaymentStatus: [], minAmount: '150', maxAmount: '250' });
    expect(out.map((r) => r.total)).toEqual([200]);
  });
});

describe('filterAndSortMetrics', () => {
  const base = { selectedCustomer: 'all', searchTerm: '', dpdMin: '', dpdMax: '', onTimeMin: '', onTimeMax: '', sortConfig: null };
  const ms = [
    metrics({ customerName: 'Beta', averageDPD: 30, onTimePercentage: 40 }),
    metrics({ customerName: 'Alfa', averageDPD: 5, onTimePercentage: 90 }),
    metrics({ customerName: 'Gamma', averageDPD: 60, onTimePercentage: 10 }),
  ];
  it('ordena asc por nombre', () => {
    const out = filterAndSortMetrics(ms, { ...base, sortConfig: { key: 'customerName', direction: 'asc' } });
    expect(out.map((m) => m.customerName)).toEqual(['Alfa', 'Beta', 'Gamma']);
  });
  it('ordena desc por averageDPD', () => {
    const out = filterAndSortMetrics(ms, { ...base, sortConfig: { key: 'averageDPD', direction: 'desc' } });
    expect(out.map((m) => m.averageDPD)).toEqual([60, 30, 5]);
  });
  it('filtra por búsqueda de nombre (case-insensitive)', () => {
    const out = filterAndSortMetrics(ms, { ...base, searchTerm: 'al' });
    expect(out.map((m) => m.customerName)).toEqual(['Alfa']);
  });
  it('filtra por rango de DPD', () => {
    const out = filterAndSortMetrics(ms, { ...base, dpdMin: '10', dpdMax: '40' });
    expect(out.map((m) => m.customerName)).toEqual(['Beta']);
  });
});

describe('branches deterministas de periodo', () => {
  it('previousPeriodAmount = 0 para "all" y "custom"', () => {
    const data = [row({ total: 100 })];
    expect(computePreviousPeriodAmount(data, 'all', '', '')).toBe(0);
    expect(computePreviousPeriodAmount(data, 'custom', '', '')).toBe(0);
  });
  it('customerRetention = ceros cuando no hay límite inferior (dateRange "all")', () => {
    const data = [row({ clientName: 'A' })];
    expect(computeCustomerRetention(data, data, 'all', '', '')).toEqual({
      newCustomers: 0, recurringCustomers: 0, retentionRate: 0,
    });
  });
});
