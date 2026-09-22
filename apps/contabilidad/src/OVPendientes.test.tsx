import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import OVPendientes from './OVPendientes';
import { fetchOVPendientes } from './api';

// Smoke test: las columnas de anticipo dependen SOLO de si el dato trae el campo
// (`traeAnticipos()` en ovTabla.ts), nunca de qué app monta el componente. El portón de
// tipos no puede ver esto: un swap del array que alimenta las columnas visibles seguiría
// compilando y pasando `vite build` limpio.

vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>();
  return { ...real, fetchOVPendientes: vi.fn() };
});

vi.mock('@suite/auth-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@suite/auth-client')>();
  return { ...real, getUserId: () => 'test-user' };
});

const mockFetch = fetchOVPendientes as unknown as ReturnType<typeof vi.fn>;

const OV_BASE = {
  salesorder_number: 'OV-2026-167',
  date: '2026-09-01',
  customer_name: 'SGS',
  status: 'open',
  currency_code: 'COP',
  total: 1000,
  pending: 1000,
  shipment_date: null,
  despachada: false,
  despachoParcial: false,
  soloPaquete: false,
  ticketPorFacturar: false,
  paquetePorCrear: false,
  facturable: false,
  ticket: null,
  trato: '',
  qt: '',
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('OVPendientes — visibilidad de las columnas de anticipo', () => {
  it('con anticipoCobrado en los datos, se ven las dos columnas', async () => {
    mockFetch.mockResolvedValue([{ ...OV_BASE, anticipoCobrado: 1000, anticipoSinAplicar: 1000 }]);
    render(<OVPendientes />);
    await waitFor(() => expect(screen.getByText('ANTICIPO COBRADO ($)')).toBeInTheDocument());
    expect(screen.getByText('ANTICIPO SIN APLICAR ($)')).toBeInTheDocument();
  });

  it('sin anticipoCobrado en los datos (usuario sin Contabilidad), no se ven', async () => {
    mockFetch.mockResolvedValue([OV_BASE]);
    render(<OVPendientes />);
    await waitFor(() => expect(screen.getByText(OV_BASE.salesorder_number)).toBeInTheDocument());
    expect(screen.queryByText('ANTICIPO COBRADO ($)')).not.toBeInTheDocument();
    expect(screen.queryByText('ANTICIPO SIN APLICAR ($)')).not.toBeInTheDocument();
  });
});
