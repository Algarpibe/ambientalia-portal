import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { captureError } from '../sentry.js';
import { CelebracionError } from './dominio.js';
import type { CelebracionActions } from './router.js';

// requireAuth lee JWT_SECRET al cargar auth.ts: se fija antes del import dinámico.
const SECRET = 'test-secret-celebracion';
process.env.JWT_SECRET = SECRET;

// requireAuth consulta la fila del usuario (rol, estado, token_version) con
// params[0] = user_id; aquí el rol sale de este mapa.
const roles = vi.hoisted(() => new Map<string, string>());
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async (_sql: string, params: unknown[] = []) => ({
      rows: [{ role: roles.get(String(params[0] ?? '')) ?? 'reader', status: 'active', apps: [], token_version: 0 }],
      rowCount: 1,
    }),
    on: () => {},
  }),
}));
vi.mock('../sentry.js', () => ({ captureError: vi.fn() }));

const { createCelebracionRouter } = await import('./router.js');

const ANA = '00000000-0000-4000-8000-00000000000a';
const BRUNO = '00000000-0000-4000-8000-00000000000b';
const ADMIN = '00000000-0000-4000-8000-0000000000ad';

function cabecera(userId: string, role = 'reader') {
  roles.set(userId, role);
  const token = jwt.sign({ sub: `${userId}@example.com`, user_id: userId, role, apps: [], token_version: 0 }, SECRET);
  return { Authorization: `Bearer ${token}` };
}

function stub(parcial: Partial<CelebracionActions> = {}): CelebracionActions {
  return {
    vista: vi.fn(async () => ({ hola: 'vista' }) as never),
    miEstado: vi.fn(async () => ({ respondido: false, confirmacionesAbiertas: true })),
    confirmar: vi.fn(async () => {}),
    votar: vi.fn(async () => {}),
    resumen: vi.fn(async () => ({ hola: 'resumen' }) as never),
    ...parcial,
  };
}

function montar(service: CelebracionActions) {
  const app = express();
  app.use(express.json());
  app.use('/api', createCelebracionRouter(service));
  return app;
}

const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');

afterEach(() => {
  vi.mocked(captureError).mockClear();
  roles.clear();
});

describe('router de la invitación', () => {
  it('sin sesión es 401', async () => {
    const res = await request(montar(stub())).get('/api/celebracion');
    expect(res.status).toBe(401);
  });

  it('GET /celebracion pasa quién soy y si soy admin', async () => {
    const service = stub();
    const res = await request(montar(service)).get('/api/celebracion').set(cabecera(ADMIN, 'admin'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hola: 'vista' });
    expect(service.vista).toHaveBeenCalledWith({ userId: ADMIN, esAdmin: true });
  });

  it('GET /celebracion/mi-estado responde el estado de la persona', async () => {
    const service = stub();
    const res = await request(montar(service)).get('/api/celebracion/mi-estado').set(cabecera(ANA));
    expect(res.body).toEqual({ respondido: false, confirmacionesAbiertas: true });
    expect(service.miEstado).toHaveBeenCalledWith(ANA);
  });

  it('PUT /celebracion/confirmacion pasa el cuerpo tal cual', async () => {
    const service = stub();
    const res = await request(montar(service))
      .put('/api/celebracion/confirmacion')
      .set(cabecera(ANA))
      .send({ asiste: true, preferencia: 'general' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'confirmacion_guardada' });
    expect(service.confirmar).toHaveBeenCalledWith(ANA, { asiste: true, preferencia: 'general' });
  });

  it('PUT /celebracion/votos/:userId pasa votante, votado y cuerpo', async () => {
    const service = stub();
    const res = await request(montar(service))
      .put(`/api/celebracion/votos/${BRUNO}`)
      .set(cabecera(ANA))
      .send({ cualidades: ['Empatía'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'votos_guardados' });
    expect(service.votar).toHaveBeenCalledWith(ANA, BRUNO, { cualidades: ['Empatía'] });
  });

  it('un CelebracionError sale con su código: 400 o 409, nunca 401', async () => {
    const service = stub({
      votar: vi.fn(async () => {
        throw new CelebracionError('voto_propio');
      }),
      confirmar: vi.fn(async () => {
        throw new CelebracionError('confirmaciones_cerradas');
      }),
    });
    const app = montar(service);
    const voto = await request(app).put(`/api/celebracion/votos/${ANA}`).set(cabecera(ANA)).send({ cualidades: [] });
    expect(voto.status).toBe(400);
    expect(voto.body).toEqual({ error: 'voto_propio' });
    const conf = await request(app).put('/api/celebracion/confirmacion').set(cabecera(ANA)).send({ asiste: false });
    expect(conf.status).toBe(409);
    expect(conf.body).toEqual({ error: 'confirmaciones_cerradas' });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('cualquier otro error es 500 genérico y va a Sentry', async () => {
    const service = stub({
      vista: vi.fn(async () => {
        throw new Error('la BD se cayó');
      }),
    });
    const res = await request(montar(service)).get('/api/celebracion').set(cabecera(ANA));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal error' });
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { endpoint: 'celebracion_vista' });
  });

  it('GET /celebracion/resumen es solo para admin', async () => {
    const service = stub();
    const app = montar(service);
    expect((await request(app).get('/api/celebracion/resumen').set(cabecera(ANA))).status).toBe(403);
    expect(service.resumen).not.toHaveBeenCalled();
    const res = await request(app).get('/api/celebracion/resumen').set(cabecera(ADMIN, 'admin'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hola: 'resumen' });
  });

  it('index.ts lo monta en /api con el servicio y el repositorio reales', () => {
    expect(leer('../index.ts')).toMatch(
      /app\.use\('\/api', createCelebracionRouter\(new CelebracionService\(\{\s*store: new CelebracionRepository\(getHubPool\(\)\),/,
    );
  });
});
