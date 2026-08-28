import { describe, it, expect } from 'vitest';
import type { ReconciledRow } from './types';
import { moraDays, sortReconciledRows } from './reconciliationSort';

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

const numbers = (rows: ReconciledRow[]) => rows.map((r) => r.invoiceNumber);

describe('moraDays', () => {
  it('usa la mora máxima de la fila', () => {
    expect(moraDays(row({ maxDelayDays: 26 }))).toBe(26);
  });

  it('devuelve 0 cuando la fila no trae mora', () => {
    expect(moraDays(row({ maxDelayDays: undefined as unknown as number }))).toBe(0);
  });
});

describe('sortReconciledRows', () => {
  it('devuelve las filas sin tocar cuando no hay orden activo', () => {
    const rows = [row({ invoiceNumber: 'B' }), row({ invoiceNumber: 'A' })];
    expect(numbers(sortReconciledRows(rows, null))).toEqual(['B', 'A']);
  });

  it('no muta el arreglo original', () => {
    const rows = [row({ invoiceNumber: 'B', total: 2 }), row({ invoiceNumber: 'A', total: 1 })];
    sortReconciledRows(rows, { key: 'total', direction: 'asc' });
    expect(numbers(rows)).toEqual(['B', 'A']);
  });

  describe('por total', () => {
    const rows = [
      row({ invoiceNumber: 'MEDIA', total: 4_621_365 }),
      row({ invoiceNumber: 'ALTA', total: 12_000_000 }),
      row({ invoiceNumber: 'BAJA', total: 350_000 }),
    ];

    it('ordena ascendente por valor, no por texto', () => {
      const sorted = sortReconciledRows(rows, { key: 'total', direction: 'asc' });
      expect(numbers(sorted)).toEqual(['BAJA', 'MEDIA', 'ALTA']);
    });

    it('ordena descendente por valor', () => {
      const sorted = sortReconciledRows(rows, { key: 'total', direction: 'desc' });
      expect(numbers(sorted)).toEqual(['ALTA', 'MEDIA', 'BAJA']);
    });
  });

  describe('por mora (columna Pagos / Mora)', () => {
    const rows = [
      row({ invoiceNumber: 'MORA_26', maxDelayDays: 26 }),
      row({ invoiceNumber: 'SIN_MORA', maxDelayDays: 0 }),
      row({ invoiceNumber: 'MORA_120', maxDelayDays: 120 }),
    ];

    it('ordena descendente: la mora más alta primero', () => {
      const sorted = sortReconciledRows(rows, { key: 'paymentDetails', direction: 'desc' });
      expect(numbers(sorted)).toEqual(['MORA_120', 'MORA_26', 'SIN_MORA']);
    });

    it('ordena ascendente: las facturas sin mora primero', () => {
      const sorted = sortReconciledRows(rows, { key: 'paymentDetails', direction: 'asc' });
      expect(numbers(sorted)).toEqual(['SIN_MORA', 'MORA_26', 'MORA_120']);
    });
  });

  describe('por fecha de factura', () => {
    const rows = [
      row({ invoiceNumber: 'JUL', invoiceDate: '1 jul 2026' }),
      row({ invoiceNumber: 'ENE', invoiceDate: '1 ene 2026' }),
      row({ invoiceNumber: 'DIC', invoiceDate: '1 dic 2026' }),
    ];

    it('ordena ascendente por fecha', () => {
      const sorted = sortReconciledRows(rows, { key: 'invoiceDate', direction: 'asc' });
      expect(numbers(sorted)).toEqual(['ENE', 'JUL', 'DIC']);
    });

    it('ordena descendente por fecha', () => {
      const sorted = sortReconciledRows(rows, { key: 'invoiceDate', direction: 'desc' });
      expect(numbers(sorted)).toEqual(['DIC', 'JUL', 'ENE']);
    });

    it('manda las fechas ilegibles al final en ambas direcciones', () => {
      const conBasura = [
        row({ invoiceNumber: 'SIN_FECHA', invoiceDate: null }),
        row({ invoiceNumber: 'JUL', invoiceDate: '1 jul 2026' }),
        row({ invoiceNumber: 'ENE', invoiceDate: '1 ene 2026' }),
      ];
      expect(numbers(sortReconciledRows(conBasura, { key: 'invoiceDate', direction: 'asc' })))
        .toEqual(['ENE', 'JUL', 'SIN_FECHA']);
      expect(numbers(sortReconciledRows(conBasura, { key: 'invoiceDate', direction: 'desc' })))
        .toEqual(['JUL', 'ENE', 'SIN_FECHA']);
    });
  });
});

describe('nextSortConfig', () => {
  it('arranca una columna nueva en descendente (lo más alto/reciente primero)', async () => {
    const { nextSortConfig } = await import('./reconciliationSort');
    expect(nextSortConfig(null, 'total')).toEqual({ key: 'total', direction: 'desc' });
    expect(nextSortConfig({ key: 'invoiceDate', direction: 'asc' }, 'total'))
      .toEqual({ key: 'total', direction: 'desc' });
  });

  it('alterna la dirección al reclicar la misma columna', async () => {
    const { nextSortConfig } = await import('./reconciliationSort');
    expect(nextSortConfig({ key: 'total', direction: 'desc' }, 'total'))
      .toEqual({ key: 'total', direction: 'asc' });
    expect(nextSortConfig({ key: 'total', direction: 'asc' }, 'total'))
      .toEqual({ key: 'total', direction: 'desc' });
  });
});
