import { describe, expect, it, vi } from 'vitest';
import { CABECERA_TOKEN, correoAlerta, crearCanalAlerta, destinatarios } from './alerta.js';

// El correo de alerta por el webhook de n8n: contrato de la petición, clasificación de
// la respuesta y que el token no salga nunca. Sin red: `red` es un doble.
const CFG = { url: 'https://n8n.example/webhook/equipos-alerta', token: 'tok-secreto-1' };
const CORREO = { para: ['jefe@ambientalia.com.co'], asunto: 'a', cuerpo: 'c' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

describe('destinatarios', () => {
  it('solo el dominio, sin repetir y en minúsculas', () =>
    expect(destinatarios(['B@ambientalia.com.co', 'b@ambientalia.com.co', 'x@otro.com', 'a@ambientalia.com.co'], 'r@ambientalia.com.co')).toEqual(['a@ambientalia.com.co', 'b@ambientalia.com.co']));
  it('sin ninguno, la dirección de reserva', () => expect(destinatarios(['x@otro.com'], 'comercial@ambientalia.com.co')).toEqual(['comercial@ambientalia.com.co']));
});

describe('correoAlerta', () => {
  it('dice la causa, los fallos y desde cuándo está vieja la foto', () => {
    const c = correoAlerta({ causa: 'drive: HTTP 403', fallosProgramados: 2, fotoBuena: '2026-11-08T11:35:00.000Z' });
    expect(c.asunto).toMatch(/^Equipos en taller: la información no se actualiza desde el /);
    expect(c.cuerpo).toMatch(/ha fallado 2 veces seguidas/);
    expect(c.cuerpo).toMatch(/drive: HTTP 403/);
  });
  it('sin foto buena todavía, lo dice', () => expect(correoAlerta({ causa: 'desk2: sin conexión', fallosProgramados: 2, fotoBuena: null }).cuerpo).toMatch(/Todavía no hay ninguna foto buena/));
});

describe('crearCanalAlerta', () => {
  it('sin configuración queda apagado, lo registra y no llama a la red', async () => {
    const red = vi.fn();
    const log = vi.fn();
    const c = crearCanalAlerta(null, red, log);
    expect(c.encendido).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/alerta apagada/));
    expect(await c.enviar(CORREO, 1)).toEqual({ ok: false, error: expect.stringMatching(/apagada/) });
    expect(red).not.toHaveBeenCalled();
  });

  it('envía POST JSON con el token en su cabecera, sin seguir redirecciones', async () => {
    const red = vi.fn(async () => json({ ok: true }));
    expect(await crearCanalAlerta(CFG, red).enviar(CORREO, 7)).toEqual({ ok: true });
    const [url, init] = red.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CFG.url);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect((init.headers as Record<string, string>)[CABECERA_TOKEN]).toBe(CFG.token);
    expect(JSON.parse(String(init.body))).toEqual({ referencia: 7, para: CORREO.para, asunto: 'a', cuerpo: 'c' });
  });

  it('un 2xx sin { ok: true } no cuenta como enviado', async () =>
    expect(await crearCanalAlerta(CFG, async () => json({})).enviar(CORREO, 1)).toEqual({ ok: false, error: 'n8n respondió 200' }));

  it('el error de n8n se guarda sin el token y cortado', async () => {
    const r = await crearCanalAlerta(CFG, async () => json({ ok: false, error: 'destino fuera del dominio; token tok-secreto-1' }, 422)).enviar(CORREO, 1);
    expect(r).toEqual({ ok: false, error: 'n8n respondió 422: destino fuera del dominio; token [token]' });
  });

  it('sin conexión o sin respuesta a tiempo, un error claro', async () => {
    expect(await crearCanalAlerta(CFG, async () => { throw new TypeError('fetch failed'); }).enviar(CORREO, 1)).toEqual({ ok: false, error: 'sin conexión con n8n' });
    const espera = Object.assign(new Error('x'), { name: 'TimeoutError' });
    expect(await crearCanalAlerta(CFG, async () => { throw espera; }).enviar(CORREO, 1)).toEqual({ ok: false, error: 'n8n no respondió a tiempo' });
  });
});
