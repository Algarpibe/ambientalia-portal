import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FacturasPorEntregar from './FacturasPorEntregar';
import * as api from './api';

vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>();
  return { ...real, fetchFacturasPorEntregar: vi.fn() };
});

// DATA-334 — el total de unidades es una suma en coma flotante: con cantidades
// fraccionarias (0,1 + 0,2) la cabecera pintaba «0.30000000000000004».
describe('FacturasPorEntregar: total de unidades sin empaquetar', () => {
  it('muestra la suma sin residuo de coma flotante', async () => {
    vi.mocked(api.fetchFacturasPorEntregar).mockResolvedValue([
      { invoiceNumber: 'FV-1', cliente: 'ACME', fecha: '2026-09-01', ov: 'OV-1', unidadesPorDespachar: 0.1 },
      { invoiceNumber: 'FV-2', cliente: 'ACME', fecha: '2026-09-02', ov: 'OV-2', unidadesPorDespachar: 0.2 },
    ]);
    render(<FacturasPorEntregar />);
    const total = await screen.findByText(/Unidades sin empaquetar/);
    expect(total).toHaveTextContent(/^Unidades sin empaquetar: 0\.3$/);
  });
});
