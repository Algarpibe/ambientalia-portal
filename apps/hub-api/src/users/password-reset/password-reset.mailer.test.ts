import { describe, it, expect, vi, afterEach } from 'vitest';
import { MAILER_TIMEOUT_MS, TOKEN_HEADER, createResetMailer } from './password-reset.mailer.js';

// El cliente del webhook de n8n de la recuperación de contraseña. Nada de aquí
// llama a la red: la red es de mentira, y el log y captureError también.

const URL_N8N = 'https://n8n.ejemplo.test/webhook/portal-restablecer-contrasena';
const ENV = { PASSWORD_RESET_N8N_URL: URL_N8N, PASSWORD_RESET_N8N_TOKEN: 'token-ficticio' };
const CORREO = { para: 'persona@ejemplo.test', asunto: 'Asunto ficticio', cuerpo: '<p>Cuerpo ficticio</p>' };

/** Una red de mentira que apunta lo que se le pide y contesta lo que se le diga. */
function red(contestar: () => Promise<Response>) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  return {
    llamadas,
    fn: async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      return contestar();
    },
  };
}

/** El log y captureError de mentira. */
function registro() {
  const eventos: { event: string; data: Record<string, unknown> }[] = [];
  const errores: unknown[] = [];
  return {
    eventos,
    errores,
    log: (event: string, data: Record<string, unknown> = {}) => {
      eventos.push({ event, data });
    },
    report: (e: unknown) => {
      errores.push(e);
    },
  };
}

afterEach(() => vi.restoreAllMocks());

/** Todas las formas en que n8n puede fallar. */
const FALLOS: [string, () => Promise<Response>][] = [
  ['un 500', async () => new Response('', { status: 500 })],
  ['un 403 (token malo)', async () => new Response('', { status: 403 })],
  ['un 3xx (no se siguen redirecciones)', async () => new Response('', { status: 307, headers: { Location: 'https://otro.ejemplo.test/' } })],
  ['un fallo de red', async (): Promise<Response> => { throw new TypeError('fetch failed'); }],
  ['la espera agotada', async (): Promise<Response> => { throw new DOMException('La espera se acabó', 'TimeoutError'); }],
];

describe('createResetMailer', () => {
  it('hace POST a la URL con la cabecera del token y el cuerpo {para, asunto, cuerpo}, sin seguir redirecciones', async () => {
    const r = red(async () => new Response('{"ok":true}', { status: 200 }));
    const reg = registro();
    await createResetMailer({ env: ENV, net: r.fn, log: reg.log, report: reg.report }).send(CORREO);
    expect(r.llamadas).toHaveLength(1);
    const { url, init } = r.llamadas[0];
    expect(url).toBe(URL_N8N);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Password-Reset-Token': 'token-ficticio' });
    expect(JSON.parse(String(init.body))).toEqual(CORREO);
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(reg.eventos).toEqual([]);
    expect(reg.errores).toEqual([]);
  });

  it('la espera máxima es de 10 s, con AbortSignal.timeout', async () => {
    const espia = vi.spyOn(AbortSignal, 'timeout');
    const reg = registro();
    await createResetMailer({ env: ENV, net: red(async () => new Response('', { status: 200 })).fn, log: reg.log, report: reg.report }).send(CORREO);
    expect(MAILER_TIMEOUT_MS).toBe(10_000);
    expect(espia).toHaveBeenCalledWith(10_000);
    expect(TOKEN_HEADER).toBe('X-Password-Reset-Token');
  });

  it.each(FALLOS)('%s: no lanza, deja password_reset_envio_fallido y lo manda a captureError', async (_caso, contestar) => {
    const reg = registro();
    await expect(
      createResetMailer({ env: ENV, net: red(contestar).fn, log: reg.log, report: reg.report }).send(CORREO),
    ).resolves.toBeUndefined();
    expect(reg.eventos.map((e) => e.event)).toEqual(['password_reset_envio_fallido']);
    expect(reg.errores).toHaveLength(1);
  });

  it.each(FALLOS)('%s: ni el log ni lo que va a captureError llevan el correo, el cuerpo ni el token', async (_caso, contestar) => {
    const reg = registro();
    await createResetMailer({ env: ENV, net: red(contestar).fn, log: reg.log, report: reg.report }).send(CORREO);
    const errores = reg.errores.map((e) => (e instanceof Error ? `${e.name} ${e.message} ${e.stack ?? ''}` : String(e)));
    const texto = JSON.stringify([reg.eventos, errores]);
    for (const secreto of ['persona@ejemplo.test', 'Cuerpo ficticio', 'token-ficticio']) {
      expect(texto).not.toContain(secreto);
    }
  });

  it.each([
    ['2xx', 200],
    ['no 2xx', 500],
  ])('libera la respuesta de n8n (cancela su cuerpo) con %s', async (_caso, status) => {
    let cancelado = false;
    const cuerpo = new ReadableStream({ cancel: () => { cancelado = true; } });
    const reg = registro();
    await createResetMailer({
      env: ENV,
      net: red(async () => new Response(cuerpo, { status })).fn,
      log: reg.log,
      report: reg.report,
    }).send(CORREO);
    expect(cancelado).toBe(true);
  });

  it.each([
    ['sin ninguna variable', {}],
    ['sin la URL', { PASSWORD_RESET_N8N_TOKEN: 'token-ficticio' }],
    ['sin el token', { PASSWORD_RESET_N8N_URL: URL_N8N }],
    ['con el token en blanco', { ...ENV, PASSWORD_RESET_N8N_TOKEN: '   ' }],
  ])('%s: no llama a la red y deja password_reset_sin_configurar', async (_caso, env) => {
    const r = red(async () => new Response('', { status: 200 }));
    const reg = registro();
    await createResetMailer({ env, net: r.fn, log: reg.log, report: reg.report }).send(CORREO);
    expect(r.llamadas).toEqual([]);
    expect(reg.eventos.map((e) => e.event)).toEqual(['password_reset_sin_configurar']);
    expect(reg.errores).toEqual([]);
  });

  it.each([
    ['sin ninguna variable', {}],
    ['sin la URL', { PASSWORD_RESET_N8N_TOKEN: 'token-ficticio' }],
    ['sin el token', { PASSWORD_RESET_N8N_URL: URL_N8N }],
    ['con la URL en blanco', { ...ENV, PASSWORD_RESET_N8N_URL: '  ' }],
  ])('%s: avisa una sola vez al crearse, antes de que nadie pida un enlace', (_caso, env) => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createResetMailer({ env, net: red(async () => new Response('', { status: 200 })).fn, log: registro().log, report: registro().report });
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(String(aviso.mock.calls[0][0])).toContain('password_reset_sin_configurar_al_arrancar');
  });

  it('configurado: no avisa al crearse', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createResetMailer({ env: ENV, net: red(async () => new Response('', { status: 200 })).fn, log: registro().log, report: registro().report });
    expect(aviso).not.toHaveBeenCalled();
  });
});
