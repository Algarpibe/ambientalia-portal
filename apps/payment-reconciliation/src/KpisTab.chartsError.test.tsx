import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReconciledRow } from './types';
import KpisTab from './KpisTab';

// Simulates a stale chunk / render failure in the lazy-loaded charts.
vi.mock('./YearlyTrendCharts', () => ({
  default: () => {
    throw new Error('chunk load failed');
  },
}));

function row(over: Partial<ReconciledRow> = {}): ReconciledRow {
  return {
    invoiceNumber: 'INV', orderNumber: 'OC', clientName: 'ACME',
    invoiceDate: '1 ene 2025', dueDate: '1 ene 2025', status: 'paid',
    total: 100, balance: 0,
    paymentDates: [], paymentAmounts: [], totalPaid: 100,
    isOverdue: false, maxDelayDays: 0, paymentDetails: [{ date: '01/01/2025', delay: 0 }],
    ...over,
  };
}

const TODAY = new Date(2026, 8, 29);

describe('KpisTab when the charts fail to load', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a local fallback with a reload button and keeps the table', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<KpisTab reconciledData={[row({ dueDate: '10 mar 2025' })]} today={TODAY} />);

    expect(await screen.findByText('No se pudieron cargar los gráficos.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeInTheDocument();
    const yearly = within(screen.getByRole('table', { name: 'Tendencia anual de mora por año de vencimiento' }));
    expect(yearly.getByText('2025')).toBeInTheDocument();
  });
});
