import { describe, it, expect, vi } from 'vitest';
import { instalarInterceptor401 } from './interceptor401';

// FE-412 — el backend revoca sesiones (token_version, baja del usuario, cambio
// de rol), pero el portal no se enteraba: cada pantalla mostraba su error y el
// usuario se quedaba dentro. Casi todas las sub-apps llaman a `fetch` a pelo con
// `authHeaders()`, así que el único sitio común es el propio `fetch`.

const API = 'https://api.ejemplo.test';

/** Un `fetch` falso que responde con `status` y apunta cada llamada. */
function montar(status: number) {
  const respuesta = new Response(null, { status });
  const original = vi.fn<(...args: unknown[]) => Promise<Response>>(async () => respuesta);
  const objetivo = { fetch: original as unknown as typeof fetch };
  const alExpirar = vi.fn();
  instalarInterceptor401({ apiBase: API, alExpirar, objetivo });
  return { objetivo, original, alExpirar, respuesta };
}

describe('instalarInterceptor401', () => {
  it('un 401 de hub-api cierra la sesión', async () => {
    const { objetivo, alExpirar } = montar(401);
    await objetivo.fetch(`${API}/api/ausencias/contexto`);
    expect(alExpirar).toHaveBeenCalledTimes(1);
  });

  it('varias peticiones que fallan a la vez cierran la sesión UNA vez', async () => {
    const { objetivo, alExpirar } = montar(401);
    await Promise.all([objetivo.fetch(`${API}/api/a`), objetivo.fetch(`${API}/api/b`), objetivo.fetch(`${API}/api/c`)]);
    expect(alExpirar).toHaveBeenCalledTimes(1);
  });

  it('devuelve la respuesta tal cual al que llamó, y le pasa los mismos argumentos al fetch real', async () => {
    const { objetivo, original, respuesta } = montar(401);
    const init = { method: 'POST' };
    expect(await objetivo.fetch(`${API}/api/x`, init)).toBe(respuesta);
    expect(original).toHaveBeenCalledWith(`${API}/api/x`, init);
  });

  it.each(['/api/login', '/api/auth/logout'])(
    'un 401 de %s NO cierra nada: ahí es la respuesta normal a una contraseña mal escrita',
    async (ruta) => {
      const { objetivo, alExpirar } = montar(401);
      await objetivo.fetch(`${API}${ruta}`);
      expect(alExpirar).not.toHaveBeenCalled();
    },
  );

  it('un 401 de otro servidor (datos.gov.co, por ejemplo) no es asunto de la sesión', async () => {
    const { objetivo, alExpirar } = montar(401);
    await objetivo.fetch('https://www.datos.gov.co/resource/x.json');
    expect(alExpirar).not.toHaveBeenCalled();
  });

  it('un 403 tampoco: es «no tienes esta app», y la sesión sigue valiendo', async () => {
    const { objetivo, alExpirar } = montar(403);
    await objetivo.fetch(`${API}/api/x`);
    expect(alExpirar).not.toHaveBeenCalled();
  });

  it('reconoce la URL también cuando llega como URL o como Request', async () => {
    const a = montar(401);
    await a.objetivo.fetch(new URL(`${API}/api/x`));
    expect(a.alExpirar).toHaveBeenCalledTimes(1);
    const b = montar(401);
    await b.objetivo.fetch(new Request(`${API}/api/x`));
    expect(b.alExpirar).toHaveBeenCalledTimes(1);
  });

  it('llama al fetch real con su `this`: window.fetch suelto da «Illegal invocation»', async () => {
    // Imita al navegador: el fetch nativo exige que `this` sea la ventana.
    const objetivo = {
      fetch: function (this: unknown) {
        if (this !== objetivo) throw new TypeError('Illegal invocation');
        return Promise.resolve(new Response(null, { status: 200 }));
      } as unknown as typeof fetch,
    };
    instalarInterceptor401({ apiBase: API, alExpirar: vi.fn(), objetivo });
    await expect(objetivo.fetch(`${API}/api/x`)).resolves.toBeInstanceOf(Response);
  });

  it('instalarlo dos veces no envuelve dos veces (HMR de Vite re-ejecuta main.tsx)', async () => {
    const { objetivo, original, alExpirar } = montar(401);
    instalarInterceptor401({ apiBase: API, alExpirar, objetivo });
    await objetivo.fetch(`${API}/api/x`);
    expect(original).toHaveBeenCalledTimes(1);
    expect(alExpirar).toHaveBeenCalledTimes(1);
  });
});
