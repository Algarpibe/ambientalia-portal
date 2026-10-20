import { describe, it, expect, vi } from 'vitest';
import { instalarTraduccionDeErroresDeRed, MENSAJE_SIN_CONEXION } from './erroresDeRed';
import { instalarInterceptor401 } from './interceptor401';

// FE-413 — sin conexión, el navegador rechaza `fetch` con un TypeError en inglés
// («Failed to fetch», «NetworkError when attempting to fetch resource.», «Load
// failed») y unas 80 pantallas lo pintan tal cual con `setError(e.message)`.

const API = 'https://api.ejemplo.test';

/** Un `fetch` falso que rechaza con `error`, ya envuelto. */
function montarRechazo(error: unknown) {
  const original = vi.fn<(...args: unknown[]) => Promise<Response>>(async () => {
    throw error;
  });
  const objetivo = { fetch: original as unknown as typeof fetch };
  instalarTraduccionDeErroresDeRed({ objetivo });
  return { objetivo, original };
}

describe('instalarTraduccionDeErroresDeRed', () => {
  it.each(['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed'])(
    'un fallo de red («%s») llega en español, sigue siendo TypeError y conserva el original en `cause`',
    async (mensaje) => {
      const crudo = new TypeError(mensaje);
      const { objetivo } = montarRechazo(crudo);
      const error = await objetivo.fetch(`${API}/api/x`).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).message).toBe(MENSAJE_SIN_CONEXION);
      expect((error as TypeError).cause).toBe(crudo);
    },
  );

  it('vale para cualquier servidor, no solo hub-api (datos.gov.co también se pinta en pantalla)', async () => {
    const { objetivo } = montarRechazo(new TypeError('Failed to fetch'));
    await expect(objetivo.fetch('https://www.datos.gov.co/resource/x.json')).rejects.toThrow(MENSAJE_SIN_CONEXION);
  });

  it('un AbortError pasa intacto: cancelar es deliberado y quien llama lo distingue por `name`', async () => {
    const abortado = new DOMException('The operation was aborted.', 'AbortError');
    const { objetivo } = montarRechazo(abortado);
    await expect(objetivo.fetch(`${API}/api/x`)).rejects.toBe(abortado);
  });

  it('lo que no es TypeError pasa intacto', async () => {
    const otro = new Error('otra cosa');
    const { objetivo } = montarRechazo(otro);
    await expect(objetivo.fetch(`${API}/api/x`)).rejects.toBe(otro);
  });

  it('una respuesta correcta llega tal cual, con los mismos argumentos al fetch real', async () => {
    const respuesta = new Response('ok', { status: 200 });
    const original = vi.fn<(...args: unknown[]) => Promise<Response>>(async () => respuesta);
    const objetivo = { fetch: original as unknown as typeof fetch };
    instalarTraduccionDeErroresDeRed({ objetivo });
    const init = { method: 'POST' };
    expect(await objetivo.fetch(`${API}/api/x`, init)).toBe(respuesta);
    expect(original).toHaveBeenCalledWith(`${API}/api/x`, init);
  });

  it('llama al fetch real con su `this`: window.fetch suelto da «Illegal invocation»', async () => {
    const objetivo = {
      fetch: function (this: unknown) {
        if (this !== objetivo) throw new TypeError('Illegal invocation');
        return Promise.resolve(new Response(null, { status: 200 }));
      } as unknown as typeof fetch,
    };
    instalarTraduccionDeErroresDeRed({ objetivo });
    await expect(objetivo.fetch(`${API}/api/x`)).resolves.toBeInstanceOf(Response);
  });

  it('instalarlo dos veces no envuelve dos veces (HMR de Vite re-ejecuta main.tsx)', async () => {
    const crudo = new TypeError('Failed to fetch');
    const { objetivo, original } = montarRechazo(crudo);
    instalarTraduccionDeErroresDeRed({ objetivo });
    const error = await objetivo.fetch(`${API}/api/x`).catch((e: unknown) => e);
    expect(original).toHaveBeenCalledTimes(1);
    // Una sola capa: `cause` apunta al error del navegador, no a otra traducción.
    expect((error as TypeError).cause).toBe(crudo);
  });

  it('compuesto con el interceptor de FE-412 (como en main.tsx): el 401 sigue sacando y el fallo de red sigue traducido', async () => {
    let siguiente: () => Promise<Response> = async () => new Response(null, { status: 401 });
    const objetivo = { fetch: (() => siguiente()) as unknown as typeof fetch };
    const alExpirar = vi.fn();
    instalarTraduccionDeErroresDeRed({ objetivo });
    instalarInterceptor401({ apiBase: API, alExpirar, objetivo });

    const respuesta = await objetivo.fetch(`${API}/api/x`);
    expect(respuesta.status).toBe(401);
    expect(alExpirar).toHaveBeenCalledTimes(1);

    siguiente = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(objetivo.fetch(`${API}/api/x`)).rejects.toThrow(MENSAJE_SIN_CONEXION);
  });
});
