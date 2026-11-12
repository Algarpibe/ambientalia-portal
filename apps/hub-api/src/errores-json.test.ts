import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorEnJson } from './errores-json.js';

// Lo que llega a Sentry, sin mandarlo a ningún sitio.
const capturados = vi.hoisted(() => [] as { e: unknown; contexto?: Record<string, unknown> }[]);
vi.mock('./sentry.js', async (original) => ({
  ...(await original<typeof import('./sentry.js')>()),
  captureError: (e: unknown, contexto?: Record<string, unknown>) => void capturados.push({ e, contexto }),
}));

// Sin un manejador final, Express contesta con su página HTML: en cuanto NODE_ENV no
// es «production», con la traza del error dentro (rutas del servidor, versiones). Lo
// hacen los parsers de body-parser (JSON roto, cuerpo demasiado grande) y cualquier
// error que llegue a `next(err)`. Se monta la MISMA pila de parsers que index.ts.
function app(env: string) {
  const a = express();
  a.set('env', env); // es lo que mira el manejador por defecto de Express para poner la traza
  a.use('/api/ausencias/solicitudes', express.json({ limit: '12mb' }));
  a.use(express.json({ limit: '2mb' }));
  a.post('/api/eco', (req, res) => res.json({ ok: true, claves: Object.keys(req.body ?? {}).length }));
  a.post('/api/ausencias/solicitudes', (_req, res) => res.status(201).json({ ok: true }));
  a.get('/api/next', (_req, _res, next) => next(new Error('boom: detalle interno /srv/app')));
  a.get('/api/lanza', () => { throw new TypeError('boom: detalle interno /srv/app'); });
  a.get('/api/no-esta', (_req, _res, next) => next(Object.assign(new Error('no hay tal cosa'), { status: 404 })));
  a.get('/api/caido', (_req, _res, next) => next(Object.assign(new Error('boom'), { statusCode: 503 })));
  a.get('/api/estado-raro', (_req, _res, next) => next(Object.assign(new Error('boom'), { status: 99 })));
  a.use(errorEnJson);
  return a;
}

const sinFugas = (r: request.Response) => {
  expect(r.headers['content-type']).toMatch(/^application\/json/);
  expect(r.text).not.toMatch(/<html|<!DOCTYPE|<pre/i);
  expect(r.text).not.toMatch(/\bat \S+ \(|node_modules|\.ts:\d+|\.js:\d+/); // ninguna traza
  expect(r.text).not.toMatch(/boom|detalle interno|\/srv\/app/);
};

let errores: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  capturados.length = 0;
  errores = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errores.mockRestore());

describe.each(['development', 'production', 'test'])('errorEnJson con NODE_ENV=%s', (env) => {
  it('JSON roto → 400 invalid_json, sin repetir el cuerpo ni el mensaje del parser', async () => {
    const r = await request(app(env)).post('/api/eco').set('Content-Type', 'application/json').send('{"clave": "secreto-del-cuerpo",');
    expect(r.status).toBe(400);
    sinFugas(r);
    expect(r.body).toEqual({ error: 'invalid_json', message: expect.any(String) });
    expect(r.text).not.toMatch(/secreto-del-cuerpo|Unexpected|JSON at position/);
    expect(capturados).toEqual([]); // un 4xx es culpa del cliente: ni Sentry ni log
    expect(errores).not.toHaveBeenCalled();
  });

  it('cuerpo por encima del límite de 2mb → 413 payload_too_large', async () => {
    const grande = JSON.stringify({ x: 'a'.repeat(2 * 1024 * 1024 + 10) });
    const r = await request(app(env)).post('/api/eco').set('Content-Type', 'application/json').send(grande);
    expect(r.status).toBe(413);
    sinFugas(r);
    expect(r.body).toEqual({ error: 'payload_too_large', message: expect.any(String) });
  });

  it('la excepción de ausencias (12mb) sigue aceptando lo que el global rechazaría', async () => {
    const r = await request(app(env)).post('/api/ausencias/solicitudes').set('Content-Type', 'application/json').send(JSON.stringify({ x: 'a'.repeat(3 * 1024 * 1024) }));
    expect(r.status).toBe(201);
  });

  it('juego de caracteres no soportado → 415 unsupported_charset', async () => {
    const r = await request(app(env)).post('/api/eco').set('Content-Type', 'application/json; charset=klingon').send('{}');
    expect(r.status).toBe(415);
    sinFugas(r);
    expect(r.body).toEqual({ error: 'unsupported_charset', message: expect.any(String) });
  });

  it('Content-Encoding no soportado → 415 unsupported_encoding', async () => {
    const r = await request(app(env)).post('/api/eco').set('Content-Type', 'application/json').set('Content-Encoding', 'klingon').send('{}');
    expect(r.status).toBe(415);
    sinFugas(r);
    expect(r.body).toEqual({ error: 'unsupported_encoding', message: expect.any(String) });
  });

  it('next(new Error()) → 500 { error: "internal error" }, a Sentry y al log solo el NOMBRE', async () => {
    const r = await request(app(env)).get('/api/next');
    expect(r.status).toBe(500);
    sinFugas(r);
    expect(r.body).toEqual({ error: 'internal error' });
    expect(capturados).toHaveLength(1);
    expect((capturados[0].e as Error).message).toMatch(/^boom/);
    expect(errores).toHaveBeenCalledTimes(1);
    const log = errores.mock.calls[0].map(String).join(' ');
    expect(log).toMatch(/\(Error\)/);
    expect(log).not.toMatch(/boom|detalle|\/srv\/app|\bat /);
  });

  it('una ruta que lanza → 500 igual', async () => {
    const r = await request(app(env)).get('/api/lanza');
    expect(r.status).toBe(500);
    sinFugas(r);
    expect(r.body).toEqual({ error: 'internal error' });
    expect(errores.mock.calls[0].map(String).join(' ')).toMatch(/\(TypeError\)/);
  });

  it('un error con status 404 → 404 not_found, con un texto fijo y no el del error', async () => {
    const r = await request(app(env)).get('/api/no-esta');
    expect(r.status).toBe(404);
    sinFugas(r);
    expect(r.body).toEqual({ error: 'not_found', message: expect.any(String) });
    expect(r.text).not.toMatch(/no hay tal cosa/);
  });

  it('un statusCode 5xx se respeta, con el mismo cuerpo genérico', async () => {
    const r = await request(app(env)).get('/api/caido');
    expect(r.status).toBe(503);
    sinFugas(r);
    expect(r.body).toEqual({ error: 'internal error' });
    expect(capturados).toHaveLength(1);
  });

  it('un status que no es un código de error HTTP → 500', async () => {
    const r = await request(app(env)).get('/api/estado-raro');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'internal error' });
  });
});

describe('errorEnJson con la respuesta ya empezada', () => {
  it('delega en Express (que corta la conexión) en vez de intentar escribir otra respuesta', async () => {
    const siguiente = vi.fn();
    const res = { headersSent: true, status: vi.fn(), json: vi.fn() };
    const err = new Error('boom');
    errorEnJson(err, {} as express.Request, res as unknown as express.Response, siguiente);
    expect(siguiente).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('index.ts monta errorEnJson el último', () => {
  // index.ts arranca la base al importarse, así que no se puede levantar aquí: se mira
  // el fuente. Un manejador de errores de Express solo ve lo que se montó ANTES que él,
  // y los routers se montan dentro del `.then` de initDb: tiene que ir tras el último
  // y antes de `app.listen`.
  const fuente = readFileSync(join(__dirname, 'index.ts'), 'utf8');

  it('tras el último router y antes de app.listen', () => {
    const monta = fuente.indexOf('app.use(errorEnJson)');
    expect(monta).toBeGreaterThan(-1);
    expect(fuente.lastIndexOf('app.use(')).toBe(monta);
    expect(monta).toBeLessThan(fuente.indexOf('app.listen('));
  });
});
