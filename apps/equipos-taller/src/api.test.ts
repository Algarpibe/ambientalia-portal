import { describe, expect, it } from 'vitest';
import { apiEquipos } from './api';

// El cliente HTTP con un fetch de mentira: rutas, cabeceras y qué cuenta como error.
function falso(respuestas: Record<string, Response>) {
  const pedidos: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    return respuestas[(init.method || 'GET') + ' ' + url] ?? new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, pedidos };
}
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const B = 'https://hub.example/api/equipos-taller';
const cab = () => ({ Authorization: 'Bearer t' });

describe('apiEquipos', () => {
  it('lleva la sesión y codifica la clave del ajuste', async () => {
    const { f, pedidos } = falso({ ['PUT ' + B + '/ajustes/1BA90417%7C2026-11-01']: J({ ajuste: { t: 'in', m: '', at: '2026-11-10', usuario: 'u', creadoEn: '' } }) });
    expect((await apiEquipos(B, f, cab).guardarAjuste('1BA90417|2026-11-01', 'in')).t).toBe('in');
    expect(pedidos[0].init.headers).toMatchObject({ Authorization: 'Bearer t', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(pedidos[0].init.body))).toEqual({ t: 'in', m: '' });
  });
  it('no tiene «actualizar»: el botón se retiró y la pantalla se actualiza sola', () => {
    expect('actualizar' in apiEquipos(B, falso({}).f, cab)).toBe(false);
  });
  it('un 403 lanza el mensaje del servidor', async () => {
    const { f } = falso({ ['GET ' + B + '/llaves']: J({ error: 'forbidden' }, 403) });
    await expect(apiEquipos(B, f, cab).llaves()).rejects.toThrow('forbidden');
  });
  it('un 409 ya es un error como otro 4xx, y un 503 no enseña su cuerpo (solo los daba el botón)', async () => {
    const { f } = falso({
      ['PUT ' + B + '/ajustes/x']: J({ error: 'conflicto', message: 'Texto fijo del servidor' }, 409),
      ['GET ' + B]: J({ error: 'x', message: 'detalle: password=hunter2' }, 503),
    });
    await expect(apiEquipos(B, f, cab).guardarAjuste('x', 'in')).rejects.toThrow('Texto fijo del servidor');
    await expect(apiEquipos(B, f, cab).estado()).rejects.toThrow('Error 503');
  });
  it('un 400 o un 404 lanzan el texto fijo del servidor', async () => {
    const { f } = falso({
      ['PUT ' + B + '/ajustes/x']: J({ error: 'invalid_input', message: 'Ajuste no válido' }, 400),
      ['PUT ' + B + '/llaves/u1']: J({ error: 'not_found', message: 'Usuario no encontrado' }, 404),
    });
    await expect(apiEquipos(B, f, cab).guardarAjuste('x', 'in')).rejects.toThrow('Ajuste no válido');
    await expect(apiEquipos(B, f, cab).guardarLlaves('u1', { editaAjustes: true, recibeAlertas: false })).rejects.toThrow('Usuario no encontrado');
  });
  it('un 500 o una respuesta que no es JSON no filtran el cuerpo del servidor', async () => {
    const { f } = falso({
      ['GET ' + B]: J({ error: 'internal error', message: 'detalle: password=hunter2' }, 500),
      ['GET ' + B + '/llaves']: new Response('<html>proxy interno 10.0.0.1</html>', { status: 502 }),
    });
    await expect(apiEquipos(B, f, cab).estado()).rejects.toThrow('Error 500');
    await expect(apiEquipos(B, f, cab).llaves()).rejects.toThrow('Error 502');
  });
  it('DELETE responde 204 sin cuerpo', async () => {
    const { f } = falso({ ['DELETE ' + B + '/ajustes/*1BA90417']: new Response(null, { status: 204 }) });
    await expect(apiEquipos(B, f, cab).borrarAjuste('*1BA90417')).resolves.toBeUndefined();
  });
  it('codifica el id del usuario al guardar las llaves y manda las dos', async () => {
    const u = { userId: 'u1', nombre: 'N', email: 'e', esAdmin: false, editaAjustes: true, recibeAlertas: false, actualizadoPor: null, actualizadoEn: null };
    const { f, pedidos } = falso({ ['PUT ' + B + '/llaves/u1']: J(u) });
    expect((await apiEquipos(B, f, cab).guardarLlaves('u1', { editaAjustes: true, recibeAlertas: false })).editaAjustes).toBe(true);
    expect(JSON.parse(String(pedidos[0].init.body))).toEqual({ editaAjustes: true, recibeAlertas: false });
  });
  it('estado() pasa la señal de aborto al fetch (el sondeo del tablero corta a los 20 s)', async () => {
    const { f, pedidos } = falso({ ['GET ' + B]: J({ snap: null }) });
    const control = new AbortController();
    await apiEquipos(B, f, cab).estado(control.signal);
    expect(pedidos[0].init.signal).toBe(control.signal);
  });
  it('el error de un 401 lleva su código para que el tablero muestre «sin acceso»', async () => {
    const { f } = falso({ ['GET ' + B]: J({ error: 'unauthorized' }, 401) });
    await expect(apiEquipos(B, f, cab).estado()).rejects.toMatchObject({ status: 401, message: 'unauthorized' });
    const { f: g } = falso({ ['GET ' + B]: J({}, 503) });
    await expect(apiEquipos(B, g, cab).estado()).rejects.toMatchObject({ status: 503, message: 'Error 503' });
  });
});
