import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReconciliationData } from './useReconciliationData';
import DpdTrendWidget from './DpdTrendWidget';

const hook = vi.fn<() => ReconciliationData>();
vi.mock('./useReconciliationData', () => ({ useReconciliationData: () => hook() }));
vi.mock('../DpdByYearChart', () => ({
  default: ({ rows }: { rows: { year: number }[] }) => <div data-testid="dpd-chart">{rows.map((r) => r.year).join(',')}</div>,
}));

const state = (over: Partial<ReconciliationData>): ReconciliationData => ({
  invoices: [], payments: [], loading: false, error: null, reload: () => {}, ...over,
});

const invoice = (invoiceNumber: string, dueDate: string) => ({
  invoiceNumber, orderNumber: '', clientName: 'ACME', invoiceDate: dueDate, dueDate,
  status: 'paid', total: 100, balance: 0,
});

describe('DpdTrendWidget', () => {
  beforeEach(() => hook.mockReset());

  it('shows a loading message', () => {
    hook.mockReturnValue(state({ loading: true }));
    render(<DpdTrendWidget />);
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });

  it('shows the error', () => {
    hook.mockReturnValue(state({ error: 'No se pudieron cargar los datos de conciliación.' }));
    render(<DpdTrendWidget />);
    expect(screen.getByText('No se pudieron cargar los datos de conciliación.')).toBeInTheDocument();
  });

  it('shows an empty message when no invoice is due', () => {
    hook.mockReturnValue(state({ invoices: [] }));
    render(<DpdTrendWidget />);
    expect(screen.getByText('Sin facturas vencidas.')).toBeInTheDocument();
  });

  it('charts the due years, without 2020 and without the internal client', async () => {
    hook.mockReturnValue(state({
      invoices: [
        invoice('A1', '2020-03-10'),
        invoice('A2', '2023-03-10'),
        invoice('A3', '2024-03-10'),
        { ...invoice('A4', '2022-03-10'), clientName: 'Ambientalia S.A.S.' },
      ],
    }));
    render(<DpdTrendWidget />);
    expect(await screen.findByTestId('dpd-chart')).toHaveTextContent('2023,2024');
  });
});
