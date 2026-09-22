import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AnticiposAtencion from './AnticiposAtencion';
import { fetchAnticiposAtencion, type AnticipoAtencion } from './api';

vi.mock('./api', () => ({ fetchAnticiposAtencion: vi.fn() }));
const mockFetch = fetchAnticiposAtencion as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const aviso = (over: Partial<AnticipoAtencion>): AnticipoAtencion => ({
  numero: 'ANT-2026-050', cliente: 'Secolab S.A.S.', fecha: '2026-07-10', cobrado: 1338645,
  sinAplicar: 1338645, motivo: 'sin_referencia', ov: null, estadoOV: null,
  texto: 'Anticipo 50% del pedido', ...over,
});

describe('AnticiposAtencion', () => {
  it('muestra el recuento plegado y la tabla al desplegar', async () => {
    mockFetch.mockResolvedValue([
      aviso({}),
      aviso({ numero: 'ANT-2026-051', motivo: 'varias_ov', ov: 'OV-2026-150, OV-2026-151', texto: 'Anticipo OV-2026-150 y OV-2026-151' }),
    ]);
    render(<AnticiposAtencion />);
    const boton = await screen.findByRole('button', { name: /2 anticipos requieren atención/ });
    expect(screen.queryByText('ANT-2026-050')).toBeNull();
    fireEvent.click(boton);
    expect(screen.getByText('ANT-2026-050')).toBeInTheDocument();
    expect(screen.getByText('Anticipo 50% del pedido')).toBeInTheDocument();
    expect(screen.getByText(/no nombra ninguna OV/)).toBeInTheDocument();
  });

  it('con un solo anticipo habla en singular', async () => {
    mockFetch.mockResolvedValue([aviso({})]);
    render(<AnticiposAtencion />);
    expect(await screen.findByRole('button', { name: /1 anticipo requiere atención/ })).toBeInTheDocument();
  });

  // Guardas: el aviso no puede estorbar a la tabla de OV que tiene debajo.
  it('con la lista vacía no pinta nada', async () => {
    mockFetch.mockResolvedValue([]);
    const { container } = render(<AnticiposAtencion />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('si la petición falla no pinta nada', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<AnticiposAtencion />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
