import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    const yearly = within(screen.getByRole('table', { name: 'Tendencia anual de mora por año de vencimiento' }));
    expect(yearly.getByText('2025')).toBeInTheDocument();
    expect(yearly.getByText('2026 (parcial)')).toBeInTheDocument();
    expect(await screen.findByTestId('yearly-charts')).toBeInTheDocument();
  });

  it('shows the empty state when no invoice is due yet', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '15 oct 2026' })]} today={TODAY} />);
    expect(screen.getByText(/No hay facturas vencidas/)).toBeInTheDocument();
  });

  it('leaves out 2020, an incomplete year', () => {
    render(
      <KpisTab
        reconciledData={[row({ dueDate: '10 mar 2020' }), row({ dueDate: '10 mar 2021' })]}
        today={TODAY}
      />,
    );
    const yearly = within(screen.getByRole('table', { name: 'Tendencia anual de mora por año de vencimiento' }));
    const concentration = within(screen.getByRole('table', { name: 'Concentración de la mora por año' }));
    expect(yearly.queryByText('2020')).not.toBeInTheDocument();
    expect(concentration.queryByText('2020')).not.toBeInTheDocument();
    expect(yearly.getByText('2021')).toBeInTheDocument();
  });

  it('shows the empty state when the only due invoices are from 2020', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '10 mar 2020' })]} today={TODAY} />);
    expect(screen.getByText(/No hay facturas vencidas/)).toBeInTheDocument();
  });

  it('explains how the simple and the weighted average DPD are calculated', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '10 mar 2025' })]} today={TODAY} />);
    const help = screen.getByRole('region', { name: '¿Cómo se calculan estos indicadores?' });
    expect(help).toHaveTextContent('DPD promedio');
    expect(help).toHaveTextContent('DPD ponderado por valor');
    expect(help).toHaveTextContent('Σ');
  });

  it('shows the concentration of delinquency per year', () => {
    render(
      <KpisTab
        reconciledData={[
          row({ clientName: 'Cliente A', dueDate: '10 mar 2025', total: 1000, paymentDetails: [{ date: 'x', delay: 30 }] }),
          row({ clientName: 'Cliente B', dueDate: '10 mar 2025', total: 100, paymentDetails: [{ date: 'x', delay: 0 }] }),
        ]}
        today={TODAY}
      />,
    );
    const table = screen.getByRole('table', { name: 'Concentración de la mora por año' });
    expect(table).toHaveTextContent('Cliente A (100,0 %)');
    expect(table).toHaveTextContent('2025');
  });

  it('explains the bands and the concentration in the notes', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '10 mar 2025' })]} today={TODAY} />);
    const help = screen.getByRole('region', { name: '¿Cómo se calculan estos indicadores?' });
    expect(help).toHaveTextContent('Tramos de mora');
    expect(help).toHaveTextContent('80 %');
  });

  it('shows no table while loading', () => {
    render(<KpisTab reconciledData={[row()]} loading today={TODAY} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('yearly-charts')).not.toBeInTheDocument();
  });
});
