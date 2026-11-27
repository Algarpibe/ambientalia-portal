// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { lanzarConfeti } from './confeti';

function movimientoReducido(reducido: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reducido }) as never;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// El orden importa: el módulo guarda su lienzo entre llamadas.
describe('confeti', () => {
  it('no hace nada si el sistema pide movimiento reducido', () => {
    movimientoReducido(true);
    lanzarConfeti();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('sin contexto 2D no deja el lienzo colgado', () => {
    movimientoReducido(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as never);
    lanzarConfeti();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('pinta en un lienzo fijo que no tapa los clics', () => {
    movimientoReducido(false);
    const ctx = { clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), fillRect: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    lanzarConfeti();
    const lienzo = document.querySelector('canvas');
    expect(lienzo?.style.position).toBe('fixed');
    expect(lienzo?.style.pointerEvents).toBe('none');
    expect(lienzo?.getAttribute('aria-hidden')).toBe('true');
  });
});
