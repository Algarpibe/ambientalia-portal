// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import PresentacionCualidades from './PresentacionCualidades';
import { cargarCualidades } from './api';
import { cualidadesDePrueba, FOTO_DE_PRUEBA } from './fixtures';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  cargarCualidades: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(cargarCualidades).mockResolvedValue(cualidadesDePrueba());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function pintar() {
  const onCerrar = vi.fn();
  render(<PresentacionCualidades onCerrar={onCerrar} />);
  return { onCerrar };
}

/** La hoja de esa persona, se vea o no en pantalla. */
const hoja = (nombre: string) =>
  screen.getAllByTestId('hoja').find((h) => h.getAttribute('aria-label') === nombre) as HTMLElement;
const contador = () => screen.getByTestId('contador').textContent;
const boton = (nombre: RegExp | string) => screen.getByRole('button', { name: nombre }) as HTMLButtonElement;

describe('PresentacionCualidades', () => {
  it('pide las cualidades al abrirse: «Cargando…» mientras tanto y, si fallan, «Reintentar»', async () => {
    vi.mocked(cargarCualidades).mockRejectedValueOnce(new Error('red'));
    pintar();
    expect(screen.getByText('Cargando…')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Ana Ruiz' })).toBeTruthy();
    expect(cargarCualidades).toHaveBeenCalledTimes(2);
  });

  it('es una capa fija sobre la página, con el foco, que empieza por la primera persona', async () => {
    pintar();
    const capa = screen.getByRole('dialog', { name: 'Presentación de cualidades' });
    expect(capa.className).toContain('fixed inset-0');
    expect(document.activeElement).toBe(capa);
    expect(await screen.findByRole('heading', { name: 'Ana Ruiz' })).toBeTruthy();
    expect(contador()).toBe('1 / 3');
  });

  it('cada persona lleva su foto, su nombre, el top 3 en grande y el resto en pequeño, con número; «Sin brindis» si no tiene', async () => {
    pintar();
    await screen.findByRole('heading', { name: 'Ana Ruiz' });
    const ana = hoja('Ana Ruiz');
    expect(ana.querySelector('img')?.getAttribute('src')).toBe(FOTO_DE_PRUEBA);
    const textos = (lista: string) =>
      within(within(ana).getByRole('list', { name: lista })).getAllByRole('listitem').map((li) => li.textContent);
    expect(textos('Top 3')).toEqual(['✨ Empatía · 5', '✨ Liderazgo · 3', '✨ Compromiso · 2']);
    expect(textos('Más cualidades')).toEqual(['Creatividad · 1', 'Trabajo en equipo · 1']);

    const bruno = hoja('Bruno Díaz');
    expect(bruno.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,PERFIL');
    expect(within(bruno).getByText('✨ Empatía · 4')).toBeTruthy();
    expect(bruno.querySelector('[aria-label="Más cualidades"]')).toBeNull();

    const carla = hoja('Carla Gómez');
    expect(carla.querySelector('img')).toBeNull();
    expect(carla.textContent).toContain('CG');
    expect(within(carla).getByText('Sin brindis')).toBeTruthy();
  });

  it('se mueve con «Anterior», «Siguiente» y las flechas; el contador sigue la posición y los extremos se deshabilitan', async () => {
    pintar();
    await screen.findByRole('heading', { name: 'Ana Ruiz' });
    expect(boton(/Anterior/).disabled).toBe(true);
    fireEvent.click(boton(/Siguiente/));
    expect(screen.getByRole('heading', { name: 'Bruno Díaz' })).toBeTruthy();
    expect(contador()).toBe('2 / 3');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'Carla Gómez' })).toBeTruthy();
    expect(contador()).toBe('3 / 3');
    expect(boton(/Siguiente/).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(contador()).toBe('3 / 3');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(contador()).toBe('1 / 3');
    expect(screen.queryByRole('heading', { name: 'Bruno Díaz' })).toBeNull();
  });

  it('Esc y «Cerrar» la cierran', async () => {
    const { onCerrar } = pintar();
    await screen.findByRole('heading', { name: 'Ana Ruiz' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCerrar).toHaveBeenCalledTimes(1);
    fireEvent.click(boton('Cerrar'));
    expect(onCerrar).toHaveBeenCalledTimes(2);
  });

  it('el resto de la página queda inerte mientras está abierta y se libera al cerrarla', async () => {
    const { container, unmount } = render(<PresentacionCualidades onCerrar={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Ana Ruiz' });
    expect(container.hasAttribute('inert')).toBe(true);
    unmount();
    expect(container.hasAttribute('inert')).toBe(false);
  });

  it('«Pantalla completa» vuelve a pedirla', async () => {
    const pedir = vi.fn(() => Promise.resolve());
    (document.documentElement as unknown as Record<string, unknown>).requestFullscreen = pedir;
    try {
      pintar();
      await screen.findByRole('heading', { name: 'Ana Ruiz' });
      fireEvent.click(boton(/Pantalla completa/));
      expect(pedir).toHaveBeenCalledTimes(1);
    } finally {
      delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
    }
  });

  it('PageDown y PageUp mueven como los mandos de presentación; con Alt, Ctrl o Meta no se mueve', async () => {
    pintar();
    await screen.findByRole('heading', { name: 'Ana Ruiz' });
    fireEvent.keyDown(window, { key: 'PageDown' });
    expect(contador()).toBe('2 / 3');
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    expect(contador()).toBe('2 / 3');
    fireEvent.keyDown(window, { key: 'PageUp' });
    expect(contador()).toBe('1 / 3');
  });

  it('sin nadie en la invitación lo dice y deja deshabilitados mover e imprimir', async () => {
    vi.mocked(cargarCualidades).mockResolvedValue({ equipo: [] });
    pintar();
    expect(await screen.findByText('No hay nadie en la invitación.')).toBeTruthy();
    for (const nombre of [/Anterior/, /Siguiente/, /Imprimir/]) expect(boton(nombre).disabled).toBe(true);
  });

  it('mientras carga, mover e imprimir están deshabilitados y el contador, vacío', () => {
    vi.mocked(cargarCualidades).mockReturnValue(new Promise(() => {}));
    pintar();
    for (const nombre of [/Anterior/, /Siguiente/, /Imprimir/]) expect(boton(nombre).disabled).toBe(true);
    expect(contador()).toBe('');
  });

  it('«Imprimir» abre el diálogo del navegador; la versión imprimible tiene a todos, uno por hoja, sin botones ni el resto del portal', async () => {
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => {});
    try {
      pintar();
      await screen.findByRole('heading', { name: 'Ana Ruiz' });
      fireEvent.click(boton(/Imprimir/));
      expect(imprimir).toHaveBeenCalledTimes(1);

      // Todas están en el DOM: en pantalla solo la actual; en papel todas, cada una en su hoja.
      const hojas = screen.getAllByTestId('hoja');
      expect(hojas.map((h) => h.getAttribute('aria-label'))).toEqual(['Ana Ruiz', 'Bruno Díaz', 'Carla Gómez']);
      expect(hojas.map((h) => h.getAttribute('aria-hidden'))).toEqual(['false', 'true', 'true']);
      for (const h of hojas) expect(h.className).toContain('break-after-page');
      for (const h of hojas.slice(1)) expect(h.className).toContain('hidden print:flex');

      // Sin botones y sin el resto del portal: cuelga de <body> y su regla de impresión oculta a sus hermanos.
      expect(boton(/Imprimir/).closest('.print\\:hidden')).not.toBeNull();
      const raiz = document.querySelector('[data-presentacion-cualidades]');
      expect(raiz?.parentElement).toBe(document.body);
      expect(raiz?.querySelector('style')?.textContent).toContain('body > :not([data-presentacion-cualidades])');
    } finally {
      imprimir.mockRestore();
    }
  });
});
