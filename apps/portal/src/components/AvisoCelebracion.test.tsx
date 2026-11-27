// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
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
    vi.mocked(cargarMiEstado).mockResolvedValue({ invitado: true, respondido: false, confirmacionesAbiertas: true });
    pintar();
    const enlace = await screen.findByRole('link', { name: /Confirma tu asistencia/ });
    expect(enlace.getAttribute('href')).toBe('/celebracion-navidad-2026');
  });

  it.each([
    ['ya respondió', () => vi.mocked(cargarMiEstado).mockResolvedValue({ invitado: true, respondido: true, confirmacionesAbiertas: true })],
    ['ya cerró', () => vi.mocked(cargarMiEstado).mockResolvedValue({ invitado: true, respondido: false, confirmacionesAbiertas: false })],
    ['no está invitado', () => vi.mocked(cargarMiEstado).mockResolvedValue({ invitado: false, respondido: false, confirmacionesAbiertas: true })],
    ['falla la consulta', () => vi.mocked(cargarMiEstado).mockRejectedValue(new Error('red'))],
  ])('no sale si %s', async (_caso, preparar) => {
    preparar();
    pintar();
    await waitFor(() => expect(cargarMiEstado).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('link')).toBeNull();
  });
});
