import { describe, it, expect } from 'vitest';
import { mensajeDeError } from './index';

// TEST-711 — `mensajeDeError` traduce los errores de hub-api para varias apps
// (ausencias, contabilidad, el consolidador de inventario) y no tenía ni un
// test: un cambio aquí rompía a la vez lo que ve el usuario en todas ellas.

const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
const sinCuerpo = (status: number) => new Response(null, { status });
const noJson = (status: number) => new Response('<html>Bad Gateway</html>', { status });

describe('mensajeDeError (@suite/http)', () => {
  it('401: la sesión caducó, hay que volver a entrar', async () => {
    expect(await mensajeDeError(sinCuerpo(401))).toBe(
      'Tu sesión ha caducado. Vuelve a entrar en el portal e inténtalo de nuevo.',
    );
  });

  it('403: dice qué hacer, pedir la app a un administrador', async () => {
    expect(await mensajeDeError(sinCuerpo(403))).toBe(
      'No tienes esta aplicación asignada. Pide acceso a un administrador del portal.',
    );
  });

  it('409 y 400: usan el `error` que manda hub-api, que es el que sabe qué falló', async () => {
    expect(await mensajeDeError(json(409, { error: 'Ese correo ya existe.' }))).toBe('Ese correo ya existe.');
    expect(await mensajeDeError(json(400, { error: 'La fecha de fin es anterior.' }))).toBe(
      'La fecha de fin es anterior.',
    );
  });

  it('409 y 400 sin `error` (o sin cuerpo JSON): un texto genérico, nunca vacío ni el HTML del proxy', async () => {
    expect(await mensajeDeError(json(409, {}))).toBe('Ya existe un registro con ese nombre.');
    expect(await mensajeDeError(noJson(409))).toBe('Ya existe un registro con ese nombre.');
    expect(await mensajeDeError(json(400, { otra: 'cosa' }))).toBe(
      'Datos inválidos. Revisa el formulario e inténtalo de nuevo.',
    );
    expect(await mensajeDeError(sinCuerpo(400))).toBe('Datos inválidos. Revisa el formulario e inténtalo de nuevo.');
  });

  it('cualquier otro estado: en castellano y con el número, para poder reportarlo', async () => {
    for (const status of [404, 500, 502, 503]) {
      const m = await mensajeDeError(noJson(status));
      expect(m).toBe(`No se pudieron cargar los datos (error ${status}). Inténtalo de nuevo en un momento.`);
      expect(m).not.toMatch(/HTTP|<html>/);
    }
  });

  it('en un 500 no lee el cuerpo: un mensaje interno del servidor no llega a la pantalla', async () => {
    const m = await mensajeDeError(json(500, { error: 'relation "portal.x" does not exist' }));
    expect(m).not.toMatch(/relation|portal\./);
  });
});
