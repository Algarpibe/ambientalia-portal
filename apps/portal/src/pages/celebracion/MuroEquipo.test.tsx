// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import MuroEquipo from './MuroEquipo';
import { notify } from '../../lib/notify';
import { BRUNO, CARLA, equipoDePrueba, FOTO_DE_PRUEBA, vistaDeEmpleado, vistaDePrueba, YO } from './fixtures';
import type { Miembro } from './tipos';

vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function pintar(
  cambios: { votosAbiertos?: boolean; misVotos?: Record<string, string[]>; equipo?: Miembro[]; cualidadesOcultas?: boolean } = {},
) {
  const vista = vistaDePrueba();
  const props = {
    equipo: cambios.equipo ?? vista.equipo,
    yo: YO,
    misVotos: cambios.misVotos ?? {},
    votosAbiertos: cambios.votosAbiertos ?? true,
    cualidadesOcultas: cambios.cualidadesOcultas ?? false,
    onBrindis: vi.fn(),
    onSubirFoto: vi.fn(async () => {}),
  };
  render(<MuroEquipo {...props} />);
  return props;
}

const tarjeta = (nombre: string) => screen.getByRole('article', { name: nombre });

describe('MuroEquipo', () => {
  it('el botón dice «Subir mi foto graciosa» si aún no la tengo y «Cambiar…» si ya la subí', () => {
    pintar({ equipo: equipoDePrueba(false) });
    expect(within(tarjeta('Ana Ruiz')).getByText('📷 Subir mi foto graciosa')).toBeTruthy();
    cleanup();
    pintar();
    expect(within(tarjeta('Ana Ruiz')).getByText('📷 Cambiar mi foto graciosa')).toBeTruthy();
  });

  it('el avatar muestra la foto graciosa antes que la del perfil', () => {
    const equipo = equipoDePrueba().map((m) =>
      m.userId === BRUNO ? { ...m, avatar: 'data:image/jpeg;base64,PERFIL', foto: 'data:image/jpeg;base64,GRACIOSA' } : m,
    );
    pintar({ equipo });
    expect(tarjeta('Bruno Díaz').querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,GRACIOSA');
    expect(tarjeta('Ana Ruiz').querySelector('img')?.getAttribute('src')).toBe(FOTO_DE_PRUEBA);
    const sinFoto = equipoDePrueba().map((m) => (m.userId === BRUNO ? { ...m, avatar: 'data:image/jpeg;base64,PERFIL' } : m));
    cleanup();
    pintar({ equipo: sinFoto });
    expect(tarjeta('Bruno Díaz').querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,PERFIL');
  });

  it('mi tarjeta va primera y tiene el botón de la foto en vez del brindis', () => {
    pintar();
    expect(screen.getAllByRole('article')[0].getAttribute('aria-label')).toBe('Ana Ruiz');
    expect(within(tarjeta('Ana Ruiz')).getByLabelText(/foto graciosa/)).toBeTruthy();
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
    const entrada = within(tarjeta('Ana Ruiz')).getByLabelText(/foto graciosa/);
    fireEvent.change(entrada, { target: { files: [new File(['x'], 'nota.txt', { type: 'text/plain' })] } });
    expect(notify).toHaveBeenCalledWith('El archivo debe ser una imagen.', 'error');
    expect(props.onSubirFoto).not.toHaveBeenCalled();
    const foto = new File(['x'], 'yo.png', { type: 'image/png' });
    fireEvent.change(entrada, { target: { files: [foto] } });
    await waitFor(() => expect(props.onSubirFoto).toHaveBeenCalledWith(foto));
  });

  it('con las cualidades ocultas, cada tarjeta dice que se desvelan el día del almuerzo, sin pistas, y los botones siguen', () => {
    pintar({ cualidadesOcultas: true, equipo: vistaDeEmpleado().equipo });
    for (const nombre of ['Ana Ruiz', 'Bruno Díaz', 'Carla Gómez']) {
      expect(within(tarjeta(nombre)).getByText('🤫 Se desvelan el día del almuerzo')).toBeTruthy();
    }
    expect(screen.queryByText('Aún nadie ha brindado por ti.')).toBeNull();
    expect(screen.queryByText(/Sé el primero en brindar/)).toBeNull();
    expect(screen.queryByText(/✨/)).toBeNull();
    expect(within(tarjeta('Bruno Díaz')).getByRole('button', { name: /Enviar brindis/ })).toBeTruthy();
    expect(within(tarjeta('Ana Ruiz')).getByLabelText(/foto graciosa/)).toBeTruthy();
  });

  it('con las cualidades ocultas y los votos cerrados tampoco dice «Sin brindis.»', () => {
    pintar({ cualidadesOcultas: true, votosAbiertos: false, equipo: vistaDeEmpleado().equipo });
    expect(screen.queryByText('Sin brindis.')).toBeNull();
    expect(screen.getAllByText('🤫 Se desvelan el día del almuerzo')).toHaveLength(3);
  });
});
