// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AvisoCelebracion from './AvisoCelebracion';
import { cargarMiEstado } from '../pages/celebracion/api';

vi.mock('../pages/celebracion/api', () => ({ cargarMiEstado: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function pintar() {
  render(
    <MemoryRouter>
      <AvisoCelebracion />
    </MemoryRouter>,
  );
}

describe('AvisoCelebracion', () => {
  it('invita a confirmar a quien no ha respondido, con el enlace de la invitación', async () => {
    vi.mocked(cargarMiEstado).mockResolvedValue({ respondido: false, confirmacionesAbiertas: true });
    pintar();
    const enlace = await screen.findByRole('link', { name: /Confirma tu asistencia/ });
    expect(enlace.getAttribute('href')).toBe('/celebracion-navidad-2026');
  });

  it('no sale si ya respondió, si ya cerró o si falla la consulta', async () => {
    for (const preparar of [
      () => vi.mocked(cargarMiEstado).mockResolvedValue({ respondido: true, confirmacionesAbiertas: true }),
      () => vi.mocked(cargarMiEstado).mockResolvedValue({ respondido: false, confirmacionesAbiertas: false }),
      () => vi.mocked(cargarMiEstado).mockRejectedValue(new Error('red')),
    ]) {
      preparar();
      pintar();
      await waitFor(() => expect(cargarMiEstado).toHaveBeenCalled());
      await Promise.resolve();
      expect(screen.queryByRole('link')).toBeNull();
      cleanup();
      vi.mocked(cargarMiEstado).mockReset();
    }
  });
});
