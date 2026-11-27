// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import CelebracionNavidad from './CelebracionNavidad';
import { cargarVista, ErrorApi, guardarConfirmacion } from './api';
import { notify } from '../../lib/notify';
import { equipoDePrueba, eventoDePrueba, vistaDePrueba } from './fixtures';

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

  it('Google Maps abre la ficha exacta del restaurante y no hay Waze', async () => {
    await abrir();
    const maps = screen.getByRole('link', { name: /Google Maps/ });
    expect(maps.getAttribute('href')).toBe(eventoDePrueba().mapsUrl);
    expect(screen.queryByRole('link', { name: /Waze/ })).toBeNull();
  });

  it('el calendario se agrega solo con Google Calendar: no hay botón ni enlace .ics', async () => {
    await abrir();
    expect(screen.getByRole('link', { name: /Google Calendar/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /\.ics/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /\.ics/ })).toBeNull();
  });

  it('tapa el contenido (inert) hasta abrir y luego enfoca el título', async () => {
    const { container } = render(<CelebracionNavidad />);
    await screen.findByRole('button', { name: /Abrir invitación/ });
    const main = container.querySelector('main') as HTMLElement;
    expect(main.hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Abrir invitación/ }));
    expect(main.hasAttribute('inert')).toBe(false);
    const titulo = screen.getByRole('heading', { name: 'Brindemos por un 2026 extraordinario' });
    await waitFor(() => expect(document.activeElement).toBe(titulo));
  });

  it('si no carga, ofrece reintentar', async () => {
    vi.mocked(cargarVista).mockRejectedValueOnce(new Error('red'));
    render(<CelebracionNavidad />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: /Abrir invitación/ })).toBeTruthy();
    expect(cargarVista).toHaveBeenCalledTimes(2);
  });

  it('si no está invitado, lo dice y lleva al Inicio sin reintentar', async () => {
    vi.mocked(cargarVista).mockRejectedValue(new ErrorApi('no_invitado', 403));
    render(<CelebracionNavidad />);
    expect(await screen.findByText('Esta invitación no está disponible para tu cuenta.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir al Inicio' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
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
    vi.mocked(guardarConfirmacion).mockRejectedValue(new ErrorApi('preferencia_invalida', 400));
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: /No podré ir/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar respuesta/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Elige una preferencia de menú.', 'error'));
    expect(cargarVista).toHaveBeenCalledTimes(1);
  });

  it('si el cierre llegó mientras tanto (409), avisa y recarga la vista', async () => {
    vi.mocked(guardarConfirmacion).mockRejectedValue(new ErrorApi('confirmaciones_cerradas', 409));
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: /No podré ir/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar respuesta/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Las confirmaciones ya están cerradas.', 'error'));
    await waitFor(() => expect(cargarVista).toHaveBeenCalledTimes(2));
  });

  it('con brindis pendientes no hay «Sí voy» ni caja de candado, y «Completa los 2 pasos…» sube al muro', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      vi.mocked(cargarVista).mockResolvedValue(vistaDePrueba({ brindis: { dados: 1, minimo: 12 } }));
      await abrir();
      expect(screen.queryByRole('button', { name: /Sí voy/ })).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByText(/Para responder te falta/)).toBeNull();
      expect(screen.queryByText(/Confirma hasta el/)).toBeNull();
      expect(screen.getByText('Antes de confirmar tu asistencia, completa estos 2 pasos:')).toBeTruthy();
      expect(screen.getByText('1 de 12')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Completa los 2 pasos de «Nuestro equipo» para responder/ }));
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('sin mi foto graciosa la confirmación sigue oculta aunque los brindis estén completos, y la tarjeta ofrece subirla', async () => {
    vi.mocked(cargarVista).mockResolvedValue(
      vistaDePrueba({ equipo: equipoDePrueba(false), brindis: { dados: 2, minimo: 2 } }),
    );
    await abrir();
    expect(screen.getByText('Subir foto')).toBeTruthy();
    expect(screen.queryByText(/Llevas 2 de 2/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Sí voy/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Completa los 2 pasos/ })).toBeTruthy();
  });

  it('quien ya dijo «Sí voy» pero le faltan pasos no ve el pase hasta completarlos', async () => {
    vi.mocked(cargarVista).mockResolvedValue(
      vistaDePrueba({
        brindis: { dados: 1, minimo: 12 },
        miRespuesta: { asiste: true, preferencia: 'general', mensaje: null, actualizadoEn: '2026-11-20T10:00:00Z' },
      }),
    );
    await abrir();
    expect(screen.queryByTestId('pase')).toBeNull();
    expect(screen.queryByRole('button', { name: /Sí voy/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Completa los 2 pasos/ })).toBeTruthy();
  });

  it('con foto y brindis completos no hay candado', async () => {
    await abrir();
    expect(screen.queryByText(/Para responder te falta/)).toBeNull();
    expect(screen.getByRole('button', { name: /Sí voy/ })).toBeTruthy();
  });

  it('con las confirmaciones cerradas no hay candado aunque falten brindis', async () => {
    vi.mocked(cargarVista).mockResolvedValue(
      vistaDePrueba({ evento: eventoDePrueba({ confirmacionesAbiertas: false }), brindis: { dados: 0, minimo: 12 } }),
    );
    await abrir();
    expect(screen.queryByRole('button', { name: /Completa los 2 pasos/ })).toBeNull();
    expect(screen.queryByText('Antes de confirmar tu asistencia, completa estos 2 pasos:')).toBeNull();
  });
});
