import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cached, clearCache, CACHE_MAX_ENTRADAS } from './cache.js';

// DATA-333 — la caché nunca soltaba nada: una entrada caducada solo se
// sobrescribía si se repetía su clave, y la clave de conciliación lleva fechas
// que manda el cliente. Cada par distinto dejaba un dataset entero en memoria
// para siempre, y 60 peticiones por minuto bastaban para tumbar hub-api.

const TTL_MS = 120_000;

/** Un productor que cuenta cuántas veces se ha calculado cada clave. */
function productor() {
  const veces = new Map<string, number>();
  const fn = (k: string) => async () => {
    veces.set(k, (veces.get(k) ?? 0) + 1);
    return k;
  };
  return { fn, veces: (k: string) => veces.get(k) ?? 0 };
}

beforeEach(() => {
  clearCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('cached', () => {
  it('sirve de la caché mientras está fresca y recalcula al caducar', async () => {
    const p = productor();
    await cached('a', p.fn('a'));
    await cached('a', p.fn('a'));
    expect(p.veces('a')).toBe(1);
    vi.advanceTimersByTime(TTL_MS + 1);
    await cached('a', p.fn('a'));
    expect(p.veces('a')).toBe(2);
  });

  it('no guarda los errores', async () => {
    await expect(cached('x', async () => { throw new Error('bd caída'); })).rejects.toThrow('bd caída');
    const p = productor();
    await cached('x', p.fn('x'));
    expect(p.veces('x')).toBe(1);
  });

  it(`tiene un tope: pasadas ${CACHE_MAX_ENTRADAS} claves suelta la más antigua`, async () => {
    const p = productor();
    for (let i = 0; i <= CACHE_MAX_ENTRADAS; i++) await cached(`k${i}`, p.fn(`k${i}`));
    // La última sigue guardada; la primera se soltó y hay que recalcularla.
    await cached(`k${CACHE_MAX_ENTRADAS}`, p.fn(`k${CACHE_MAX_ENTRADAS}`));
    expect(p.veces(`k${CACHE_MAX_ENTRADAS}`)).toBe(1);
    await cached('k0', p.fn('k0'));
    expect(p.veces('k0')).toBe(2);
  });

  it('suelta la usada hace más tiempo, no la escrita hace más tiempo', async () => {
    const p = productor();
    for (let i = 0; i < CACHE_MAX_ENTRADAS; i++) await cached(`k${i}`, p.fn(`k${i}`));
    // k0 se lee justo antes de llenar: ahora la más olvidada es k1.
    await cached('k0', p.fn('k0'));
    await cached('nueva', p.fn('nueva'));
    await cached('k0', p.fn('k0'));
    expect(p.veces('k0')).toBe(1);
    await cached('k1', p.fn('k1'));
    expect(p.veces('k1')).toBe(2);
  });

  // No hay test de «barrer las caducadas» porque no hace falta barrerlas: una
  // entrada solo pasa al final del Map si se lee fresca, así que una caducada
  // siempre está por delante de cualquier fresca y el tope la suelta primero.
});
