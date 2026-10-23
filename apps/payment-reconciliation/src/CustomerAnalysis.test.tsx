import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CustomerAnalysis from './CustomerAnalysis';
import type { ReconciledRow } from './types';

const LOAD_ERROR = 'No se pudieron cargar los datos del hub de Zoho. Reintenta.';

// FE-414: una carga fallida deja `reconciledData` vacío; la vista no puede
// presentarlo como «no hay datos», tiene que decir que no se pudo cargar.
describe('CustomerAnalysis when loading failed', () => {
  it('shows the load error instead of the empty state', () => {
    render(<CustomerAnalysis reconciledData={[]} error={LOAD_ERROR} />);
    expect(screen.getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    expect(screen.queryByText('No hay datos de conciliación disponibles')).not.toBeInTheDocument();
  });

  it('keeps the empty state when there is no error', () => {
    render(<CustomerAnalysis reconciledData={[]} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('No hay datos de conciliación disponibles')).toBeInTheDocument();
  });
});

function row(over: Partial<ReconciledRow> = {}): ReconciledRow {
  return {
    invoiceNumber: 'INV', orderNumber: 'OC', clientName: 'ACME',
    invoiceDate: '1 ene 2025', dueDate: '31 ene 2025', status: 'paid',
    total: 100, balance: 0,
    paymentDates: [], paymentAmounts: [], totalPaid: 100,
    isOverdue: false, maxDelayDays: 0, paymentDetails: [{ date: '01/01/2025', delay: 0 }],
    ...over,
  };
}

// ARQ-611 — los totales en pesos salían en en-US con código ("COP  1,234,568"),
// distintos de los "$ 1.234.568" del resto del Conciliador. Ahora pasan por
// formatMoney → formatCOP. Se compara textContent exacto porque
// toHaveTextContent normaliza el espacio duro (U+00A0) tras "$".
describe('CustomerAnalysis montos en pesos', () => {
  it('pinta el valor total facturado como formatCOP', () => {
    render(<CustomerAnalysis reconciledData={[row({ total: 1234567.6, totalPaid: 1234567.6 })]} selectedCustomer="ACME" />);
    const etiqueta = screen.getByText('Valor Total Facturado');
    expect(etiqueta.nextElementSibling?.textContent).toBe('$\u00a01.234.568');
  });
});
