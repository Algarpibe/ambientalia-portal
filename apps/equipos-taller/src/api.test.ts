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
  it('409 al actualizar es «ocupado», no un error', async () => {
    const { f } = falso({ ['POST ' + B + '/actualizar']: J({ estado: 'ocupado', message: 'Ya se está actualizando' }, 409) });
    expect(await apiEquipos(B, f, cab).actualizar()).toBe('ocupado');
  });
  it('202 al actualizar es «iniciada»', async () => {
    const { f } = falso({ ['POST ' + B + '/actualizar']: J({ estado: 'iniciada' }, 202) });
    expect(await apiEquipos(B, f, cab).actualizar()).toBe('iniciada');
  });
  it('un 503 o un 403 lanzan el mensaje del servidor', async () => {
    const { f } = falso({ ['POST ' + B + '/actualizar']: J({ error: 'sin_configurar', message: 'Falta configurar Google Drive' }, 503), ['GET ' + B + '/llaves']: J({ error: 'forbidden' }, 403) });
    await expect(apiEquipos(B, f, cab).actualizar()).rejects.toThrow('Falta configurar Google Drive');
    await expect(apiEquipos(B, f, cab).llaves()).rejects.toThrow('forbidden');
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
});
