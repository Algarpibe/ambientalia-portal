// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import CelebracionNavidad from './CelebracionNavidad';
import { cargarVista, ErrorApi, guardarVotos, subirMiFoto } from './api';
import { notify } from '../../lib/notify';
import { BRUNO, vistaDePrueba } from './fixtures';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  cargarVista: vi.fn(),
  guardarConfirmacion: vi.fn(),
  guardarVotos: vi.fn(),
  subirMiFoto: vi.fn(),
  cargarResumen: vi.fn(),
}));
vi.mock('./confeti', () => ({ lanzarConfeti: vi.fn(), prefiereMenosMovimiento: vi.fn(() => false) }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../lib/image', () => ({ fileToResizedDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA') }));
vi.mock('../../hooks/useProfile', () => ({ notifyProfileUpdated: vi.fn() }));

beforeEach(() => {
  vi.mocked(cargarVista).mockResolvedValue(vistaDePrueba());
  vi.mocked(guardarVotos).mockResolvedValue();
  vi.mocked(subirMiFoto).mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function abrir() {
  render(<CelebracionNavidad />);
  fireEvent.click(await screen.findByRole('button', { name: /Abrir invitación/ }));
}

describe('CelebracionNavidad · muro', () => {
  it('brindar por un compañero guarda sus cualidades, cierra el modal y recarga', async () => {
    await abrir();
    fireEvent.click(within(screen.getByRole('article', { name: 'Bruno Díaz' })).getByRole('button', { name: /Enviar brindis/ }));
    const dialogo = screen.getByRole('dialog', { name: /Brinda por Bruno/ });
    fireEvent.click(within(dialogo).getByRole('button', { name: /Compromiso/ }));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar brindis' }));
    await waitFor(() => expect(guardarVotos).toHaveBeenCalledWith(BRUNO, ['Compromiso']));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(notify).toHaveBeenCalledWith('🥂 ¡Brindis enviado para Bruno!');
    expect(cargarVista).toHaveBeenCalledTimes(2);
  });

  it('al dar el último brindis que faltaba, baja sola a la confirmación ya encendida', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      vi.mocked(cargarVista)
        .mockResolvedValueOnce(vistaDePrueba({ brindis: { dados: 11, minimo: 12 } }))
        .mockResolvedValue(vistaDePrueba({ brindis: { dados: 12, minimo: 12 } }));
      await abrir();
      expect(scroll).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /Sí voy/ })).toBeNull();
      fireEvent.click(within(screen.getByRole('article', { name: 'Bruno Díaz' })).getByRole('button', { name: /Enviar brindis/ }));
      const dialogo = screen.getByRole('dialog', { name: /Brinda por Bruno/ });
      fireEvent.click(within(dialogo).getByRole('button', { name: /Compromiso/ }));
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar brindis' }));
      await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: /Sí voy/ })).toBeTruthy();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('si la votación cerró mientras tanto (409), avisa, cierra el modal y recarga', async () => {
    vi.mocked(guardarVotos).mockRejectedValue(new ErrorApi('votos_cerrados', 409));
    await abrir();
    fireEvent.click(within(screen.getByRole('article', { name: 'Bruno Díaz' })).getByRole('button', { name: /Enviar brindis/ }));
    const dialogo = screen.getByRole('dialog', { name: /Brinda por Bruno/ });
    fireEvent.click(within(dialogo).getByRole('button', { name: /Compromiso/ }));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar brindis' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('La votación ya se cerró.', 'error'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(cargarVista).toHaveBeenCalledTimes(2));
  });

  it('subir mi foto la redimensiona, la guarda y recarga', async () => {
    await abrir();
    const entrada = within(screen.getByRole('article', { name: 'Ana Ruiz' })).getByLabelText(/Subir mi foto/);
    fireEvent.change(entrada, { target: { files: [new File(['x'], 'yo.png', { type: 'image/png' })] } });
    await waitFor(() => expect(subirMiFoto).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA'));
    await waitFor(() => expect(cargarVista).toHaveBeenCalledTimes(2));
    expect(notify).toHaveBeenCalledWith('📸 Foto actualizada en el muro del equipo.');
  });
});
