import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GeneralAnalysis from './GeneralAnalysis';

const LOAD_ERROR = 'No se pudieron cargar los datos del hub de Zoho. Reintenta.';

// FE-414: una carga fallida deja `reconciledData` vacío; la vista no puede
// presentarlo como «0 clientes», tiene que decir que no se pudo cargar.
describe('GeneralAnalysis when loading failed', () => {
  it('shows the load error instead of an empty client list', () => {
    render(<GeneralAnalysis reconciledData={[]} error={LOAD_ERROR} />);
    expect(screen.getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    expect(screen.queryByText(/Mostrando/)).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('offers a retry when the parent provides one', () => {
    const onRetry = vi.fn();
    render(<GeneralAnalysis reconciledData={[]} error={LOAD_ERROR} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the client list when there is no error', () => {
    render(<GeneralAnalysis reconciledData={[]} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/Mostrando/)).toBeInTheDocument();
  });
});
