// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import CelebracionNavidad from './CelebracionNavidad';
import { cargarVista, ErrorApi, guardarConfirmacion } from './api';
import { notify } from '../../lib/notify';
import { vistaDePrueba } from './fixtures';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  cargarVista: vi.fn(),
  guardarConfirmacion: vi.fn(),
  guardarVotos: vi.fn(),
  subirMiFoto: vi.fn(),
  cargarResumen: vi.fn(),
}));
vi.mock('./confeti', () => ({ lanzarConfeti: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

beforeEach(() => {
  vi.mocked(cargarVista).mockResolvedValue(vistaDePrueba());
  vi.mocked(guardarConfirmacion).mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function abrir() {
  render(<CelebracionNavidad />);
  fireEvent.click(await screen.findByRole('button', { name: /Abrir invitación/ }));
}

describe('CelebracionNavidad', () => {
  it('enseña la portada y, al abrirla, el evento', async () => {
    await abrir();
    expect(screen.queryByRole('button', { name: /Abrir invitación/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Fecha, hora y lugar' })).toBeTruthy();
    expect(screen.getByText('Viernes, 18 de diciembre de 2026')).toBeTruthy();
    expect(screen.getByText('Restaurante Anfitriona')).toBeTruthy();
    expect(screen.getByRole('timer', { name: 'Cuenta atrás' })).toBeTruthy();
  });

  it('si no carga, ofrece reintentar', async () => {
    vi.mocked(cargarVista).mockRejectedValueOnce(new Error('red'));
    render(<CelebracionNavidad />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: /Abrir invitación/ })).toBeTruthy();
    expect(cargarVista).toHaveBeenCalledTimes(2);
  });

  it('confirmar guarda, avisa y vuelve a cargar', async () => {
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: /Sí voy/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar respuesta/ }));
    await waitFor(() =>
      expect(guardarConfirmacion).toHaveBeenCalledWith({ asiste: true, preferencia: 'general', mensaje: null }),
    );
    await waitFor(() => expect(cargarVista).toHaveBeenCalledTimes(2));
    expect(notify).toHaveBeenCalledWith('🎟️ ¡Asistencia confirmada!');
  });

  it('si el servidor rechaza, avisa con el texto de su código', async () => {
    vi.mocked(guardarConfirmacion).mockRejectedValue(new ErrorApi('confirmaciones_cerradas', 409));
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: /No podré ir/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar respuesta/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Las confirmaciones ya están cerradas.', 'error'));
    expect(cargarVista).toHaveBeenCalledTimes(1);
  });
});
