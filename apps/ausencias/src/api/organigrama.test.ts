// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fijarCargo } from './organigrama';

// `mensajeDeError` enseñaría el código crudo `cargo_invalido` en un 400 y «No
// se pudieron cargar los datos (error 404)» en un 404. `fijarCargo` lleva su
// propio lector para decir algo que el admin entienda.

const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

const responde = (res: Response) => {
  const fetchFalso = vi.fn(async () => res);
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
};

// Node 22+ trae un `localStorage` global que choca con el de jsdom; `authHeaders`
// lo lee al montar la petición.
beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null }));
afterEach(() => vi.unstubAllGlobals());

describe('fijarCargo', () => {
  it('manda un PUT con el cargo a la ruta de la ficha y devuelve la ficha', async () => {
    const fetchFalso = responde(json(200, { id: 'e 1', cargo: 'Jefa de taller' }));
    const ficha = await fijarCargo('e 1', 'Jefa de taller');
    expect(ficha).toEqual({ id: 'e 1', cargo: 'Jefa de taller' });
    const [url, opciones] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/ausencias\/empleados\/e%201\/cargo$/);
    expect(opciones.method).toBe('PUT');
    expect(opciones.body).toBe(JSON.stringify({ cargo: 'Jefa de taller' }));
  });

  it('manda null tal cual', async () => {
    const fetchFalso = responde(json(200, { id: 'e1', cargo: null }));
    await fijarCargo('e1', null);
    const [, opciones] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(opciones.body).toBe(JSON.stringify({ cargo: null }));
  });

  it('400 cargo_invalido: dice qué está mal, no el código', async () => {
    responde(json(400, { error: 'cargo_invalido', field: 'cargo' }));
    await expect(fijarCargo('e1', 'x')).rejects.toThrow(
      new Error('El cargo admite hasta 255 caracteres y no puede llevar saltos de línea ni caracteres de control.'),
    );
  });

  it('404 empleado_no_encontrado: la ficha ya no está activa', async () => {
    responde(json(404, { error: 'empleado_no_encontrado' }));
    await expect(fijarCargo('e1', 'x')).rejects.toThrow(new Error('Esa ficha ya no está activa. Recarga la lista.'));
  });

  it('un 404 SIN ese código (hub-api sin la ruta todavía) sale por el mensaje genérico', async () => {
    // Es lo que contestaría un hub-api antiguo si el portal se desplegara antes:
    // decir «la ficha no está activa» sería mentir.
    responde(new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } }));
    const error = await fijarCargo('e1', 'x').then(
      () => null,
      (e: Error) => e,
    );
    expect(error?.message).not.toMatch(/ficha/);
    expect(error?.message).toMatch(/404/);
  });

  it('un 404 JSON con OTRO código tampoco dice que la ficha no está activa', async () => {
    // Si alguien copiara aquí la regla de `errorDeNota` («cualquier `error` de
    // texto»), este 404 acabaría diciendo «Esa ficha ya no está activa».
    responde(json(404, { error: 'not_found' }));
    const error = await fijarCargo('e1', 'x').then(
      () => null,
      (e: Error) => e,
    );
    expect(error?.message).not.toMatch(/ficha/);
    expect(error?.message).toMatch(/404/);
  });

  it('el código solo se traduce con su estado: empleado_no_encontrado en un 400 no dice nada de la ficha', async () => {
    responde(json(400, { error: 'empleado_no_encontrado' }));
    await expect(fijarCargo('e1', 'x')).rejects.toThrow(new Error('empleado_no_encontrado'));
  });

  it('otro 400 sale por el mensaje genérico', async () => {
    responde(json(400, { error: 'otra_cosa' }));
    await expect(fijarCargo('e1', 'x')).rejects.toThrow(new Error('otra_cosa'));
  });
});
