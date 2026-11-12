// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { borrarNota, crearNota, editarNota, urlDeImagenDeNota } from './notas';

// Los errores de las notas: un 404 tiene que llegar con su código (que
// `textoDeErrorDeNota` pone en palabras) y no como el genérico de
// `mensajeDeError`. Se prueba por las funciones públicas.

const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

const responde = (res: Response) => vi.stubGlobal('fetch', vi.fn(async () => res));

// `authHeaders()` lee el token de localStorage, y con jsdom bajo Node 22+ el
// global no llega a existir (colisión con el de Node): se sustituye, como en
// editarSolicitud.test.ts.
beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null }));
afterEach(() => vi.unstubAllGlobals());

describe('errores de la api de notas', () => {
  it('borrarNota: un 404 conserva su código', async () => {
    responde(json(404, { error: 'nota_no_encontrada' }));
    await expect(borrarNota('n1')).rejects.toThrow(new Error('nota_no_encontrada'));
  });

  it('editarNota: un 404 conserva su código', async () => {
    responde(json(404, { error: 'empleado_no_encontrado' }));
    await expect(editarNota('n1', { empleadoId: 'e9' })).rejects.toThrow(new Error('empleado_no_encontrado'));
  });

  it('urlDeImagenDeNota: un 404 conserva su código', async () => {
    responde(json(404, { error: 'imagen_no_encontrada' }));
    await expect(urlDeImagenDeNota('n1')).rejects.toThrow(new Error('imagen_no_encontrada'));
  });

  it('un 404 que no es JSON sale por el mensaje genérico, no con el cuerpo crudo', async () => {
    responde(new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } }));
    const error = await borrarNota('n1').then(
      () => null,
      (e: Error) => e,
    );
    expect(error?.message).not.toBe('Not Found');
    expect(error?.message).toMatch(/404/);
  });

  it('crearNota: un 400 sigue saliendo con su código', async () => {
    responde(json(400, { error: 'comentario_vacio' }));
    await expect(
      crearNota({ empleadoId: 'e1', categoria: 'otro', fecha: '2026-11-12', comentario: '' }),
    ).rejects.toThrow(new Error('comentario_vacio'));
  });
});
