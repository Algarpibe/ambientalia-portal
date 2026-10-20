import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

// Recharts necesita layout real; los gráficos no son lo que se prueba aquí.
vi.mock('./YearlyTrendCharts', () => ({ default: () => null }));
vi.mock('./OverdueByClientChart', () => ({ default: () => null }));

const LOAD_ERROR = 'No se pudieron cargar los datos del hub de Zoho. Reintenta.';

// FE-414: el error de carga solo se pintaba en la pestaña de conciliación; en
// las demás los arreglos vacíos se presentaban como «no hay datos».
describe('App when the hub load fails', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the load error in the KPIs tab instead of its empty state', async () => {
    render(<App />);
    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /KPIs/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    expect(screen.queryByText(/No hay facturas vencidas/)).not.toBeInTheDocument();
  });

  it('shows the load error in the general analysis tab instead of 0 clients', async () => {
    render(<App />);
    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Análisis General/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    expect(screen.queryByText(/Mostrando/)).not.toBeInTheDocument();
  });
});
