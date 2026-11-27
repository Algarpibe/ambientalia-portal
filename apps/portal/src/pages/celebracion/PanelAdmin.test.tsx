// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import PanelAdmin from './PanelAdmin';
import { cargarResumen } from './api';
import { eventoDePrueba, resumenDePrueba } from './fixtures';

vi.mock('./api', () => ({ cargarResumen: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PanelAdmin', () => {
  it('enseña los totales, los menús y la lista con quien no ha respondido', async () => {
    vi.mocked(cargarResumen).mockResolvedValue(resumenDePrueba());
    render(<PanelAdmin evento={eventoDePrueba()} version={0} />);
    expect((await screen.findByTestId('cifra-van')).textContent).toContain('1');
    expect(screen.getByTestId('cifra-no-van').textContent).toContain('1');
    expect(screen.getByTestId('cifra-sin-responder').textContent).toContain('1');
    expect(screen.getByText(/Opción vegetariana:/)).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Carla Gómez' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Descargar Excel/ })).toBeTruthy();
  });

  it('vuelve a pedir el resumen cuando cambia la versión', async () => {
    vi.mocked(cargarResumen).mockResolvedValue(resumenDePrueba());
    const { rerender } = render(<PanelAdmin evento={eventoDePrueba()} version={0} />);
    await waitFor(() => expect(cargarResumen).toHaveBeenCalledTimes(1));
    rerender(<PanelAdmin evento={eventoDePrueba()} version={1} />);
    await waitFor(() => expect(cargarResumen).toHaveBeenCalledTimes(2));
  });

  it('si falla, ofrece reintentar', async () => {
    vi.mocked(cargarResumen).mockRejectedValueOnce(new Error('red')).mockResolvedValue(resumenDePrueba());
    render(<PanelAdmin evento={eventoDePrueba()} version={0} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByTestId('cifra-van')).toBeTruthy();
  });
});
