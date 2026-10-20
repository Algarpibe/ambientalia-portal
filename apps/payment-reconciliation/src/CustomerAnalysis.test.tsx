import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CustomerAnalysis from './CustomerAnalysis';

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
