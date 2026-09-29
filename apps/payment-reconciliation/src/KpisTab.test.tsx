import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReconciledRow } from './types';
import KpisTab from './KpisTab';

// Recharts needs real layout; the charts are covered by the build, not here.
vi.mock('./YearlyTrendCharts', () => ({ default: () => <div data-testid="yearly-charts" /> }));

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

describe('KpisTab', () => {
  it('shows one table row per year and marks the current year as partial', async () => {
    render(
      <KpisTab
        reconciledData={[row({ dueDate: '10 mar 2025' }), row({ dueDate: '5 ene 2026' })]}
        today={TODAY}
      />,
    );
    expect(screen.getByText('2025')).toBeInTheDocument();
    expect(screen.getByText('2026 (parcial)')).toBeInTheDocument();
    expect(await screen.findByTestId('yearly-charts')).toBeInTheDocument();
  });

  it('shows the empty state when no invoice is due yet', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '15 oct 2026' })]} today={TODAY} />);
    expect(screen.getByText(/No hay facturas vencidas/)).toBeInTheDocument();
  });

  it('shows no table while loading', () => {
    render(<KpisTab reconciledData={[row()]} loading today={TODAY} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('yearly-charts')).not.toBeInTheDocument();
  });
});
