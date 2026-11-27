// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { entrarPantallaCompleta, salirPantallaCompleta } from './pantallaCompleta';

// jsdom no trae la API de pantalla completa, igual que el iPhone: cada prueba la pone a mano.
const raiz = document.documentElement as unknown as Record<string, unknown>;
const doc = document as unknown as Record<string, unknown>;

afterEach(() => {
  delete raiz.requestFullscreen;
  delete doc.exitFullscreen;
  delete doc.fullscreenElement;
});

describe('pantalla completa', () => {
  it('sin la API no hace nada y no falla', () => {
    expect(() => entrarPantallaCompleta()).not.toThrow();
    expect(() => salirPantallaCompleta()).not.toThrow();
  });

  it('pide la pantalla completa de toda la página y, si el navegador la niega, no falla', async () => {
    const pedir = vi.fn(() => Promise.reject(new Error('denegada')));
    raiz.requestFullscreen = pedir;
    entrarPantallaCompleta();
    expect(pedir).toHaveBeenCalledTimes(1);
    await Promise.resolve(); // Vitest falla ante un rechazo sin capturar: que no falle es la garantía del catch
  });

  it('si el navegador rechaza la salida, tampoco falla', async () => {
    const salir = vi.fn(() => Promise.reject(new Error('ya había salido')));
    doc.exitFullscreen = salir;
    doc.fullscreenElement = document.documentElement;
    expect(() => salirPantallaCompleta()).not.toThrow();
    expect(salir).toHaveBeenCalledTimes(1);
    await Promise.resolve(); // Vitest falla ante un rechazo sin capturar: que no falle es la garantía del catch
  });

  it('sale de la pantalla completa solo si la página está en ella', () => {
    const salir = vi.fn(() => Promise.resolve());
    doc.exitFullscreen = salir;
    salirPantallaCompleta();
    expect(salir).not.toHaveBeenCalled();
    doc.fullscreenElement = document.documentElement;
    salirPantallaCompleta();
    expect(salir).toHaveBeenCalledTimes(1);
  });
});
