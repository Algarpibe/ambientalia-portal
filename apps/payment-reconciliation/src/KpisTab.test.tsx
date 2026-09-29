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

  it('shows the receivables aging snapshot', () => {
    render(
      <KpisTab
        reconciledData={[
          row({ dueDate: '19 sep 2026', total: 200, balance: 200, paymentDetails: [] }),
          row({ dueDate: '15 oct 2026', total: 50, balance: 50, paymentDetails: [] }),
        ]}
        today={TODAY}
      />,
    );
    const aging = screen.getByRole('region', { name: 'Cartera por antigüedad (hoy)' });
    expect(aging).toHaveTextContent('Por vencer');
    expect(aging).toHaveTextContent('1–30 días');
    expect(aging).toHaveTextContent(/Total vencido/);
    expect(aging).toHaveTextContent('1 facturas');
  });

  it('warns about open invoices in another currency below the aging cards', () => {
    render(
      <KpisTab
        reconciledData={[
          row({ dueDate: '19 sep 2026', total: 200, balance: 200, paymentDetails: [] }),
          row({ dueDate: '19 sep 2026', total: 90, balance: 90, currencyCode: 'USD', paymentDetails: [] }),
        ]}
        today={TODAY}
      />,
    );
    const aging = screen.getByRole('region', { name: 'Cartera por antigüedad (hoy)' });
    expect(aging).toHaveTextContent('1 facturas con saldo en otra moneda no están incluidas en estos montos.');
  });

  it('keeps the aging section when the only open balances are in another currency', () => {
    render(
      <KpisTab
        reconciledData={[row({ dueDate: '15 oct 2026', total: 90, balance: 90, currencyCode: 'USD', paymentDetails: [] })]}
        today={TODAY}
      />,
    );
    const aging = screen.getByRole('region', { name: 'Cartera por antigüedad (hoy)' });
    expect(aging).toHaveTextContent('1 facturas con saldo en otra moneda');
  });

  it('does not show the other-currency warning when every invoice is in COP', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '19 sep 2026', total: 200, balance: 200, paymentDetails: [] })]} today={TODAY} />);
    expect(screen.queryByText(/en otra moneda/)).not.toBeInTheDocument();
  });

  it('explains in the notes that other currencies only count by invoice number', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '10 mar 2025' })]} today={TODAY} />);
    expect(screen.getByText(/las facturas en otras monedas \(dólares, euros\) cuentan en los indicadores por número de facturas/)).toBeInTheDocument();
  });

  it('keeps the aging snapshot when no invoice is due yet for the trend', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '15 oct 2026', total: 50, balance: 50, paymentDetails: [] })]} today={TODAY} />);
    expect(screen.getByRole('region', { name: 'Cartera por antigüedad (hoy)' })).toBeInTheDocument();
    expect(screen.getByText(/No hay facturas vencidas/)).toBeInTheDocument();
  });

  it('adds value on time and DSO columns to the yearly table', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '10 mar 2025' })]} today={TODAY} />);
    const yearly = within(screen.getByRole('table', { name: 'Tendencia anual de mora por año de vencimiento' }));
    expect(yearly.getByRole('columnheader', { name: '% a tiempo (valor)' })).toBeInTheDocument();
    expect(yearly.getByRole('columnheader', { name: 'DSO promedio' })).toBeInTheDocument();
    expect(yearly.getByRole('columnheader', { name: 'DSO ponderado' })).toBeInTheDocument();
  });

  it('lists the clients whose DPD worsened', () => {
    const paid = (dueDate: string, delay: number) =>
      row({ clientName: 'Cliente A', dueDate, paymentDetails: [{ date: 'x', delay }] });
    render(
      <KpisTab
        reconciledData={[paid('10 mar 2025', 0), paid('10 abr 2025', 0), paid('5 ene 2026', 20), paid('10 feb 2026', 20)]}
        today={TODAY}
      />,
    );
    const table = screen.getByRole('table', { name: 'Clientes cuyo DPD subió frente al año anterior' });
    expect(table).toHaveTextContent('Cliente A');
    expect(table).toHaveTextContent('+20,0 días');
  });

  it('says so when no client worsened', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '10 mar 2025' })]} today={TODAY} />);
    expect(screen.getByText(/Ningún cliente empeoró frente a 2025/)).toBeInTheDocument();
  });

  it('explains the new indicators in the notes', () => {
    render(<KpisTab reconciledData={[row({ dueDate: '10 mar 2025' })]} today={TODAY} />);
    const help = screen.getByRole('region', { name: '¿Cómo se calculan estos indicadores?' });
    expect(help).toHaveTextContent('DSO');
    expect(help).toHaveTextContent('Cartera por antigüedad');
    expect(help).toHaveTextContent('Clientes que empeoraron');
    expect(help).toHaveTextContent('% del valor a tiempo');
    expect(help).toHaveTextContent('señal clara');
  });

  it('shows no table while loading', () => {
    render(<KpisTab reconciledData={[row()]} loading today={TODAY} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('yearly-charts')).not.toBeInTheDocument();
  });
});
