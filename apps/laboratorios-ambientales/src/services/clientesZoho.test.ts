import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchClientesZoho } from './clientesZoho';
import { REQUEST_TIMEOUT_MS } from './api';

// NIT y fechas ficticios: el repo es público.
const CABECERAS = () => ({ Authorization: 'Bearer t' });

const respuesta = (cuerpo: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => cuerpo,
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchClientesZoho', () => {
  it('sin NIT no llama a hub-api', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchClientesZoho([], undefined, CABECERAS)).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envía los NIT por POST con la cabecera de autorización', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta({ clientes: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchClientesZoho(['900000001', '900000002'], undefined, CABECERAS);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/api/laboratorios/clientes')).toBe(true);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer t' });
    expect(JSON.parse(init.body as string)).toEqual({ nits: ['900000001', '900000002'] });
  });

  it('convierte la respuesta en un mapa por NIT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respuesta({
          clientes: [{ nit: '900000001', ultimaFactura: '2026-03-10', ocmaVendido: null, ultimosRepuestos: '2025-08-20' }],
        }),
      ),
    );
    const cruce = await fetchClientesZoho(['900000001'], undefined, CABECERAS);
    expect(cruce.get('900000001')).toEqual({ ultimaFactura: '2026-03-10', ocmaVendido: null, ultimosRepuestos: '2025-08-20' });
  });

  it('lanza un error con un 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta({ error: 'internal error' }, 500)));
    await expect(fetchClientesZoho(['900000001'], undefined, CABECERAS)).rejects.toThrow('hub-api respondió 500');
  });

  it('lanza un error si la respuesta no trae la lista de clientes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta({})));
    await expect(fetchClientesZoho(['900000001'], undefined, CABECERAS)).rejects.toThrow('clientes');
  });

  it('corta a los REQUEST_TIMEOUT_MS y lo dice', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
          }),
      ),
    );
    const promesa = fetchClientesZoho(['900000001'], undefined, CABECERAS);
    let resuelta = false;
    promesa.then(
      () => {},
      () => {
        resuelta = true;
      },
    );
    const comprobacion = expect(promesa).rejects.toThrow(`hub-api no respondió en ${REQUEST_TIMEOUT_MS / 1000} s`);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(resuelta).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await comprobacion;
  });

  it('tras una respuesta correcta no deja el temporizador del tope pendiente', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta({ clientes: [] })));
    await fetchClientesZoho(['900000001'], undefined, CABECERAS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('con la señal ya abortada, fetch recibe la señal abortada y falla como aborto, no como tope', async () => {
    let senal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        senal = init.signal ?? undefined;
        return Promise.reject(new DOMException('This operation was aborted', 'AbortError'));
      }),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(fetchClientesZoho(['900000001'], controller.signal, CABECERAS)).rejects.toThrow('aborted');
    expect(senal?.aborted).toBe(true);
  });

  it('si quien llama aborta, la petición se aborta', async () => {
    let senal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            senal = init.signal ?? undefined;
            init.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
          }),
      ),
    );
    const controller = new AbortController();
    const promesa = fetchClientesZoho(['900000001'], controller.signal, CABECERAS);
    controller.abort();
    await expect(promesa).rejects.toThrow('aborted');
    expect(senal?.aborted).toBe(true);
  });
});
