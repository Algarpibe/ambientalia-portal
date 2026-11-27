// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import MuroEquipo from './MuroEquipo';
import { notify } from '../../lib/notify';
import { BRUNO, CARLA, vistaDePrueba, YO } from './fixtures';

vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function pintar(cambios: { votosAbiertos?: boolean; misVotos?: Record<string, string[]> } = {}) {
  const vista = vistaDePrueba();
  const props = {
    equipo: vista.equipo,
    yo: YO,
    misVotos: cambios.misVotos ?? {},
    votosAbiertos: cambios.votosAbiertos ?? true,
    onBrindis: vi.fn(),
    onSubirFoto: vi.fn(async () => {}),
  };
  render(<MuroEquipo {...props} />);
  return props;
}

const tarjeta = (nombre: string) => screen.getByRole('article', { name: nombre });

describe('MuroEquipo', () => {
  it('mi tarjeta va primera y tiene «Subir mi foto» en vez del brindis', () => {
    pintar();
    expect(screen.getAllByRole('article')[0].getAttribute('aria-label')).toBe('Ana Ruiz');
    expect(within(tarjeta('Ana Ruiz')).getByLabelText(/Subir mi foto/)).toBeTruthy();
    expect(within(tarjeta('Ana Ruiz')).queryByRole('button', { name: /brindis/ })).toBeNull();
    expect(within(tarjeta('Ana Ruiz')).getByText('Aún nadie ha brindado por ti.')).toBeTruthy();
  });

  it('las ajenas tienen «Enviar brindis» y sus cualidades con número', () => {
    const props = pintar();
    expect(within(tarjeta('Bruno Díaz')).getByText('✨ Empatía · 4')).toBeTruthy();
    expect(within(tarjeta('Bruno Díaz')).getByText('✨ Liderazgo · 2')).toBeTruthy();
    expect(within(tarjeta('Carla Gómez')).getByText('Sé el primero en brindar por Carla.')).toBeTruthy();
    fireEvent.click(within(tarjeta('Carla Gómez')).getByRole('button', { name: /Enviar brindis/ }));
    expect(props.onBrindis).toHaveBeenCalledWith(expect.objectContaining({ userId: CARLA }));
  });

  it('si ya voté a alguien, su botón dice «Brindis enviado»', () => {
    pintar({ misVotos: { [BRUNO]: ['Empatía'] } });
    expect(within(tarjeta('Bruno Díaz')).getByRole('button', { name: /Brindis enviado/ })).toBeTruthy();
  });

  it('con los votos cerrados no hay botón de brindis', () => {
    pintar({ votosAbiertos: false });
    expect(screen.queryByRole('button', { name: /brindis/i })).toBeNull();
    expect(within(tarjeta('Carla Gómez')).getByText('Sin brindis.')).toBeTruthy();
  });

  it('subir una imagen llama a onSubirFoto; otro tipo de fichero avisa y no sube', async () => {
    const props = pintar();
    const entrada = within(tarjeta('Ana Ruiz')).getByLabelText(/Subir mi foto/);
    fireEvent.change(entrada, { target: { files: [new File(['x'], 'nota.txt', { type: 'text/plain' })] } });
    expect(notify).toHaveBeenCalledWith('El archivo debe ser una imagen.', 'error');
    expect(props.onSubirFoto).not.toHaveBeenCalled();
    const foto = new File(['x'], 'yo.png', { type: 'image/png' });
    fireEvent.change(entrada, { target: { files: [foto] } });
    await waitFor(() => expect(props.onSubirFoto).toHaveBeenCalledWith(foto));
  });
});
