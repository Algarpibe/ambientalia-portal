// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import CelebracionNavidad from './CelebracionNavidad';
import { cargarVista, ErrorApi, guardarVotos, subirFotoCelebracion } from './api';
import { notify } from '../../lib/notify';
import { notifyProfileUpdated } from '../../hooks/useProfile';
import { fileToResizedDataUrl } from '../../lib/image';
import { BRUNO, CARLA, equipoDePrueba, eventoDePrueba, vistaDeEmpleado, vistaDePrueba } from './fixtures';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  cargarVista: vi.fn(),
  guardarConfirmacion: vi.fn(),
  guardarVotos: vi.fn(),
  subirFotoCelebracion: vi.fn(),
  cargarResumen: vi.fn(),
}));
vi.mock('./confeti', () => ({ lanzarConfeti: vi.fn(), prefiereMenosMovimiento: vi.fn(() => false) }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../lib/image', () => ({ fileToResizedDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA') }));
vi.mock('../../hooks/useProfile', () => ({ notifyProfileUpdated: vi.fn() }));

beforeEach(() => {
  vi.mocked(cargarVista).mockResolvedValue(vistaDePrueba());
  vi.mocked(guardarVotos).mockResolvedValue();
  vi.mocked(subirFotoCelebracion).mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function abrir() {
  render(<CelebracionNavidad />);
  fireEvent.click(await screen.findByRole('button', { name: /Abrir invitación/ }));
}

const LINEA_OCULTA = '🤫 Los resultados de los brindis se desvelarán el día del almuerzo';

/** Brinda por Bruno con «Compromiso» desde su tarjeta. */
function brindarPorBruno() {
  fireEvent.click(within(screen.getByRole('article', { name: 'Bruno Díaz' })).getByRole('button', { name: /Enviar brindis/ }));
  const dialogo = screen.getByRole('dialog', { name: /Brinda por Bruno/ });
  fireEvent.click(within(dialogo).getByRole('button', { name: /Compromiso/ }));
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar brindis' }));
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
        // (la foto ya está subida en las dos vistas: solo cambian los brindis)
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

  it('subir mi foto graciosa la redimensiona a 256, la guarda sin tocar el perfil y recarga', async () => {
    await abrir();
    const entrada = within(screen.getByRole('article', { name: 'Ana Ruiz' })).getByLabelText(/foto graciosa/);
    fireEvent.change(entrada, { target: { files: [new File(['x'], 'yo.png', { type: 'image/png' })] } });
    await waitFor(() => expect(subirFotoCelebracion).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA'));
    expect(fileToResizedDataUrl).toHaveBeenCalledWith(expect.any(File), 256, 0.75);
    await waitFor(() => expect(cargarVista).toHaveBeenCalledTimes(2));
    expect(notify).toHaveBeenCalledWith('📸 ¡Foto graciosa lista!');
    expect(notifyProfileUpdated).not.toHaveBeenCalled();
  });

  it('con los brindis completos, subir la foto que faltaba enciende la confirmación y baja a ella una vez', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      vi.mocked(cargarVista)
        .mockResolvedValueOnce(vistaDePrueba({ equipo: equipoDePrueba(false), brindis: { dados: 2, minimo: 2 } }))
        .mockResolvedValue(vistaDePrueba({ brindis: { dados: 2, minimo: 2 } }));
      await abrir();
      expect(scroll).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /Sí voy/ })).toBeNull();
      const entrada = within(screen.getByRole('article', { name: 'Ana Ruiz' })).getByLabelText(/foto graciosa/);
      fireEvent.change(entrada, { target: { files: [new File(['x'], 'yo.png', { type: 'image/png' })] } });
      await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: /Sí voy/ })).toBeTruthy();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('al empleado, las tarjetas le dicen que las cualidades se desvelan el día del almuerzo', async () => {
    vi.mocked(cargarVista).mockResolvedValue(vistaDeEmpleado());
    await abrir();
    expect(within(screen.getByRole('article', { name: 'Bruno Díaz' })).getByText('🤫 Se desvelan el día del almuerzo')).toBeTruthy();
  });

  it('con las cualidades ocultas, el brindis que completa el mínimo avisa de que los resultados se desvelarán', async () => {
    vi.mocked(cargarVista)
      .mockResolvedValueOnce(vistaDeEmpleado({ brindis: { dados: 1, minimo: 2 }, misVotos: { [CARLA]: ['Empatía'] } }))
      .mockResolvedValue(
        vistaDeEmpleado({ brindis: { dados: 2, minimo: 2 }, misVotos: { [CARLA]: ['Empatía'], [BRUNO]: ['Compromiso'] } }),
      );
    await abrir();
    brindarPorBruno();
    await waitFor(() => expect(guardarVotos).toHaveBeenCalledWith(BRUNO, ['Compromiso']));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('🥂 ¡Ya brindaste por todos! Los resultados se desvelarán el día del almuerzo'),
    );
    expect(notify).not.toHaveBeenCalledWith('🥂 ¡Brindis enviado para Bruno!');
  });

  it('el admin, que ve las cualidades, recibe el aviso de siempre aunque complete el mínimo', async () => {
    vi.mocked(cargarVista).mockResolvedValue(
      vistaDePrueba({ esAdmin: true, brindis: { dados: 1, minimo: 2 }, misVotos: { [CARLA]: ['Empatía'] } }),
    );
    await abrir();
    brindarPorBruno();
    await waitFor(() => expect(notify).toHaveBeenCalledWith('🥂 ¡Brindis enviado para Bruno!'));
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('desvelarán'));
  });

  it('con los brindis completos, «Nuestro equipo» dice que los resultados se desvelarán, también tras el cierre', async () => {
    vi.mocked(cargarVista).mockResolvedValue(vistaDeEmpleado());
    await abrir();
    expect(screen.getByText(LINEA_OCULTA)).toBeTruthy();
    cleanup();
    vi.mocked(cargarVista).mockResolvedValue(vistaDeEmpleado({ evento: eventoDePrueba({ confirmacionesAbiertas: false }) }));
    await abrir();
    expect(screen.queryByText('🎉 ¡Listo! Ya puedes confirmar tu asistencia')).toBeNull();
    expect(screen.getByText(LINEA_OCULTA)).toBeTruthy();
  });

  it('sin los brindis completos, o para el admin, no sale la línea', async () => {
    vi.mocked(cargarVista).mockResolvedValue(vistaDeEmpleado({ brindis: { dados: 1, minimo: 2 } }));
    await abrir();
    expect(screen.queryByText(LINEA_OCULTA)).toBeNull();
    cleanup();
    vi.mocked(cargarVista).mockResolvedValue(vistaDePrueba({ esAdmin: true }));
    await abrir();
    expect(screen.queryByText(LINEA_OCULTA)).toBeNull();
  });
});
