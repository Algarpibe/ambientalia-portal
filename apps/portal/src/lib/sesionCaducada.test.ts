// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { salirPorSesionCaducada } from './sesionCaducada';

// FE-412 — al caducar la sesion se vuelve a /auth. Quien llega ahi ya tiene
// cuenta, asi que debe abrir en «Iniciar sesion» y no en «Crear cuenta».

const clearToken = vi.hoisted(() => vi.fn());
vi.mock('../auth', async (orig) => ({ ...(await orig<typeof import('../auth')>()), clearToken }));

const locationOriginal = window.location;

/** jsdom no deja espiar `assign`: se sustituye `location` entera y se restaura. */
function colocarEn(pathname: string) {
  const assign = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { pathname, assign } });
  return assign;
}

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: locationOriginal });
  vi.clearAllMocks();
});

describe('salirPorSesionCaducada', () => {
  it('borra el token y manda a iniciar sesion', () => {
    const assign = colocarEn('/dashboard');
    salirPorSesionCaducada();
    expect(clearToken).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/auth?modo=login');
  });

  it('si ya esta en /auth borra el token pero no recarga (evita un bucle)', () => {
    const assign = colocarEn('/auth');
    salirPorSesionCaducada();
    expect(clearToken).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });
});
