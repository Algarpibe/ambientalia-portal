import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { cabecerasDeSeguridad } from './cabeceras-seguridad.js';

// SEC-235 — hub-api no ponía ninguna cabecera de seguridad. La que importa es
// `nosniff` en las descargas (el PDF de una incapacidad, el CSV y el XLS): sin
// ella, un navegador puede «adivinar» que un fichero subido es HTML y ejecutarlo.
// Hoy lo mitigan `Content-Disposition: attachment` y el mime forzado; esto lo
// cierra para todas las respuestas, incluidas las que nadie ha escrito todavía.

function app() {
  const a = express();
  cabecerasDeSeguridad(a);
  a.get('/json', (_req, res) => res.json({ ok: true }));
  a.get('/adjunto', (_req, res) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="incapacidad.pdf"');
    res.send(Buffer.from('%PDF-1.4'));
  });
  return a;
}

describe('cabecerasDeSeguridad (SEC-235)', () => {
  it('una descarga lleva nosniff y no se puede incrustar', async () => {
    const r = await request(app()).get('/adjunto').expect(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });

  it('una respuesta JSON también, y sin anunciar que es Express', async () => {
    const r = await request(app()).get('/json').expect(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('no toca el tipo ni la disposición que pone la ruta', async () => {
    const r = await request(app()).get('/adjunto').expect(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toBe('attachment; filename="incapacidad.pdf"');
  });
});

describe('index.ts monta las cabeceras (SEC-235)', () => {
  // index.ts arranca la base al importarse, así que no se puede levantar aquí: se
  // mira el fuente. Lo que importa es que vaya ANTES de cualquier router, o las
  // respuestas de ese router saldrían sin cabeceras.
  const fuente = readFileSync(join(__dirname, 'index.ts'), 'utf8');

  it('las aplica antes del primer app.use', () => {
    const cabeceras = fuente.indexOf('cabecerasDeSeguridad(app)');
    const primerUse = fuente.indexOf('app.use(');
    expect(cabeceras).toBeGreaterThan(-1);
    expect(cabeceras).toBeLessThan(primerUse);
  });
});
