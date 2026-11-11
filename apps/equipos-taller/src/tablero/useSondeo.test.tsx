// @vitest-environment jsdom
// Sondeo de 60 s con setTimeout encadenado: última foto buena, aviso de datos viejos, acceso
// denegado, aborto a los 20 s y limpieza total (sin acumular temporizadores ni nodos en 24 h).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { useSondeo } from './useSondeo';

const T0 = Date.parse('2026-11-11T20:00:00Z');
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const avanzar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const errorHttp = (status: number) => Object.assign(new Error('Error ' + status), { status });

/** Pedido simulado: cada llamada toma el siguiente resultado de la lista (el último se repite). */
function guion(...pasos: (string | Error)[]) {
  const pedir = vi.fn(async (_s: AbortSignal) => {
    const p = pasos[Math.min(pedir.mock.calls.length - 1, pasos.length - 1)];
    if (p instanceof Error) throw p;
    return p;
  });
  return pedir;
}

describe('useSondeo', () => {
  it('pide al montar y luego cada 60 s', async () => {
    const pedir = guion('a');
    const { result } = renderHook(() => useSondeo(pedir));
    await avanzar(0);
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(result.current.datos).toBe('a');
    expect(result.current.okEn).toBe(T0);
    await avanzar(59_000);
    expect(pedir).toHaveBeenCalledTimes(1);
    await avanzar(1_000);
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it('si falla, conserva la última foto buena y avisa de la red', async () => {
    const pedir = guion('buena', new Error('red caída'));
    const { result } = renderHook(() => useSondeo(pedir));
    await avanzar(0);
    await avanzar(60_000);
    expect(result.current.datos).toBe('buena');
    expect(result.current.fallo).toBe('red');
    expect(result.current.okEn).toBe(T0);
  });

  it('solo es obsoleto pasados 5 minutos desde el último acierto, y se recupera con el siguiente', async () => {
    const pedir = guion('buena', new Error('x'), new Error('x'), new Error('x'), new Error('x'), new Error('x'), new Error('x'), 'nueva');
    const { result } = renderHook(() => useSondeo(pedir));
    await avanzar(0);
    await avanzar(300_000); // 5 min exactos desde el acierto, con fallos: aún no
    expect(result.current.fallo).toBe('red');
    expect(result.current.obsoleto).toBe(false);
    await avanzar(60_000); // 6 min
    expect(result.current.obsoleto).toBe(true);
    expect(result.current.datos).toBe('buena');
    await avanzar(60_000); // llega el acierto
    expect(result.current.obsoleto).toBe(false);
    expect(result.current.datos).toBe('nueva');
  });

  it('con aciertos cada minuto nunca es obsoleto (la edad de la foto no cuenta)', async () => {
    const pedir = guion('foto de hace 50 minutos');
    const { result } = renderHook(() => useSondeo(pedir));
    await avanzar(0);
    await avanzar(600_000);
    expect(pedir.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(result.current.obsoleto).toBe(false);
  });

  it('un primer intento fallido deja datos nulos y fallo visible; un 401 se distingue como acceso', async () => {
    const { result: r1 } = renderHook(() => useSondeo(guion(new Error('x'))));
    await avanzar(0);
    expect(r1.current.datos).toBeNull();
    expect(r1.current.fallo).toBe('red');
    const { result: r2 } = renderHook(() => useSondeo(guion(errorHttp(401))));
    await avanzar(0);
    expect(r2.current.fallo).toBe('acceso');
  });

  it('aborta un pedido colgado a los 20 s y sigue sondeando', async () => {
    let senal: AbortSignal | undefined;
    const pedir = vi.fn((s: AbortSignal) => {
      senal = s;
      return new Promise<string>((_, rechazar) => s.addEventListener('abort', () => rechazar(new Error('abortado'))));
    });
    const { result } = renderHook(() => useSondeo(pedir));
    await avanzar(19_000);
    expect(senal!.aborted).toBe(false);
    await avanzar(1_000);
    expect(senal!.aborted).toBe(true);
    expect(result.current.fallo).toBe('red');
    await avanzar(60_000);
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it('al desmontar no queda ningún temporizador, ni siquiera con un pedido colgado', async () => {
    const colgado = vi.fn(() => new Promise<string>(() => {}));
    const { unmount } = renderHook(() => useSondeo(colgado));
    await avanzar(1_000);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    const ok = guion('a');
    const { unmount: u2 } = renderHook(() => useSondeo(ok));
    await avanzar(0);
    u2();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('1.440 ciclos (24 h) mantienen constantes los temporizadores y los nodos del DOM', async () => {
    const pedir = guion('a');
    function Sonda() {
      const { datos } = useSondeo(pedir);
      return <ul>{datos ? <li>{datos}</li> : null}</ul>;
    }
    const { container } = render(<Sonda />);
    await avanzar(0);
    const nodos = container.querySelectorAll('*').length;
    const timers = vi.getTimerCount();
    for (let i = 0; i < 1_440; i++) await avanzar(60_000);
    expect(pedir.mock.calls.length).toBeGreaterThanOrEqual(1_441);
    expect(vi.getTimerCount()).toBe(timers);
    expect(container.querySelectorAll('*').length).toBe(nodos);
  }, 60_000);
});
