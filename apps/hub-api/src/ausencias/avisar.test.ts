import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { avisarN8n } from './avisar.js';

const URL_WEBHOOK = 'https://n8n.example.test/webhook/ausencias-aviso';

describe('avisarN8n', () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    process.env.AUSENCIAS_WEBHOOK_URL = URL_WEBHOOK;
    process.env.AUSENCIAS_CRON_TOKEN = 'secreto-abc';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    delete process.env.AUSENCIAS_WEBHOOK_URL;
    delete process.env.AUSENCIAS_CRON_TOKEN;
    vi.restoreAllMocks();
  });

  it('avisa con el token en la cabecera', async () => {
    const espia = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    globalThis.fetch = espia as unknown as typeof fetch;

    await avisarN8n();

    expect(espia).toHaveBeenCalledOnce();
    const [url, init] = espia.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_WEBHOOK);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Ausencias-Cron-Token']).toBe('secreto-abc');
  });

  it('no hace nada sin URL configurada — en local y en tests el polling basta', async () => {
    delete process.env.AUSENCIAS_WEBHOOK_URL;
    const espia = vi.fn();
    globalThis.fetch = espia as unknown as typeof fetch;

    await avisarN8n();

    expect(espia).not.toHaveBeenCalled();
  });

  it('no hace nada sin token: mejor no avisar que avisar sin autenticar', async () => {
    delete process.env.AUSENCIAS_CRON_TOKEN;
    const espia = vi.fn();
    globalThis.fetch = espia as unknown as typeof fetch;

    await avisarN8n();

    expect(espia).not.toHaveBeenCalled();
  });

  it('se traga un fallo de red: la solicitud ya está guardada y encolada', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(avisarN8n()).resolves.toBeUndefined();
  });

  it('se traga un 500 de n8n', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(avisarN8n()).resolves.toBeUndefined();
  });

  it('se traga un timeout sin dejar la promesa colgada', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
    ) as unknown as typeof fetch;
    await expect(avisarN8n()).resolves.toBeUndefined();
  });

  it('corta la petición con una señal de aborto', async () => {
    // Sin esto, un n8n colgado dejaría sockets abiertos acumulándose en hub-api.
    const espia = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    globalThis.fetch = espia as unknown as typeof fetch;

    await avisarN8n();

    const [, init] = espia.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
