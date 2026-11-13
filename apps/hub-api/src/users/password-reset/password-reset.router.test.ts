import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import {
  FORGOT_LIMIT,
  LIMIT_WINDOW_MS,
  RESET_LIMIT,
  createPasswordResetRouter,
  type PasswordResetActions,
} from './password-reset.router.js';
import { PasswordResetError, PasswordResetService } from './password-reset.service.js';
import { FakeClock, FakeMailer, FakeStore } from './test-fakes.js';

// Las dos rutas públicas de la recuperación de contraseña. El servicio es el de
// verdad sobre dobles (test-fakes.ts) cuando importa lo que pasa por dentro, y
// un stub cuando solo importa la ruta. Cada `montar` crea un router nuevo, y
// con él limitadores nuevos.

const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const FORGOT = '/api/auth/forgot-password';
const RESET = '/api/auth/reset-password';

// El servicio rechaza, antes de tocar la BD, todo token que no tenga el formato
// real (43 caracteres base64url). Los tokens de prueba lo respetan.
const tokenFijo = (n: number | string) => `token-${n}`.padEnd(43, '_');

afterEach(() => vi.restoreAllMocks());

function montar(service: PasswordResetActions) {
  const app = express();
  app.use(express.json());
  app.use('/api', createPasswordResetRouter(service));
  return app;
}

function conServicioReal() {
  const store = new FakeStore();
  const mailer = new FakeMailer();
  let n = 0;
  const service = new PasswordResetService({
    store,
    mailer,
    now: new FakeClock(Date.parse('2026-11-13T15:00:00.000Z')).now,
    portalUrl: 'https://portal.ejemplo.test',
    bcryptCost: 4,
    randomToken: () => tokenFijo(++n),
    log: () => {},
  });
  return { store, mailer, app: montar(service) };
}

const stub = (parcial: Partial<PasswordResetActions> = {}): PasswordResetActions => ({
  requestReset: vi.fn(async () => {}),
  resetPassword: vi.fn(async () => {}),
  ...parcial,
});

describe('POST /api/auth/forgot-password', () => {
  it('responde idéntico para una cuenta activa, una inactiva y una desconocida; solo la activa recibe el correo', async () => {
    const { store, mailer, app } = conServicioReal();
    store.addUser({ email: 'activa@ejemplo.test' });
    store.addUser({ email: 'inactiva@ejemplo.test', status: 'inactive' });
    const respuestas: { status: number; body: unknown }[] = [];
    for (const email of ['activa@ejemplo.test', 'inactiva@ejemplo.test', 'nadie@ejemplo.test']) {
      const res = await request(app).post(FORGOT).send({ email });
      respuestas.push({ status: res.status, body: res.body });
    }
    expect(respuestas).toEqual(Array(3).fill({ status: 200, body: { message: 'reset_requested' } }));
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
    expect(mailer.sent[0].para).toBe('activa@ejemplo.test');
  });

  it('responde antes de trabajar: no espera a requestReset', async () => {
    const service = stub({ requestReset: vi.fn(() => new Promise<void>(() => {})) });
    const res = await request(montar(service)).post(FORGOT).send({ email: 'ana@ejemplo.test' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'reset_requested' });
    expect(service.requestReset).toHaveBeenCalledWith('ana@ejemplo.test');
  });

  it.each([
    ['sin cuerpo', undefined],
    ['sin email', {}],
    ['con un email que no es texto', { email: 42 }],
    ['con el email en blanco', { email: '   ' }],
  ])('%s → 400 missing_email, y no trabaja', async (_caso, cuerpo) => {
    const service = stub();
    const peticion = request(montar(service)).post(FORGOT);
    const res = cuerpo === undefined ? await peticion : await peticion.send(cuerpo);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'missing_email' });
    expect(service.requestReset).not.toHaveBeenCalled();
  });

  it('si el trabajo de después falla, la respuesta ya salió y el error va al log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = stub({
      requestReset: vi.fn(async () => {
        throw new Error('BD caída');
      }),
    });
    const res = await request(montar(service)).post(FORGOT).send({ email: 'ana@ejemplo.test' });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('forgot_password error', expect.any(Error)));
  });

  it(`más de ${FORGOT_LIMIT} en 15 minutos desde la misma IP → 429`, async () => {
    const app = montar(stub());
    for (let i = 0; i < FORGOT_LIMIT; i++) {
      expect((await request(app).post(FORGOT).send({ email: 'ana@ejemplo.test' })).status).toBe(200);
    }
    const res = await request(app).post(FORGOT).send({ email: 'ana@ejemplo.test' });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'too many requests' });
    expect(FORGOT_LIMIT).toBe(5);
    expect(LIMIT_WINDOW_MS).toBe(15 * 60_000);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('con un enlace válido → 200 password_reset, y la clave cambia', async () => {
    const { store, mailer, app } = conServicioReal();
    const ana = store.addUser({ email: 'ana@ejemplo.test' });
    await request(app).post(FORGOT).send({ email: 'ana@ejemplo.test' });
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
    const res = await request(app).post(RESET).send({ token: tokenFijo(1), newPassword: 'clave-nueva-1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'password_reset' });
    expect(store.userById(ana.id).tokenVersion).toBe(1);
  });

  it('clave corta → 400 password_too_short', async () => {
    const { app } = conServicioReal();
    const res = await request(app).post(RESET).send({ token: tokenFijo(1), newPassword: 'corta' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'password_too_short' });
  });

  it.each([
    // Bien formado pero que nadie pidió: llega hasta el almacén y no lo encuentra.
    ['desconocido', { token: tokenFijo('nadie'), newPassword: 'clave-nueva-1' }],
    ['con formato inválido', { token: 'token-que-nadie-pidio', newPassword: 'clave-nueva-1' }],
    ['vacío', { token: '', newPassword: 'clave-nueva-1' }],
    ['ausente', { newPassword: 'clave-nueva-1' }],
  ])('token %s → 400 invalid_or_expired_token (400 y no 401: no es una sesión caducada)', async (_caso, cuerpo) => {
    const { app } = conServicioReal();
    const res = await request(app).post(RESET).send(cuerpo);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_or_expired_token' });
  });

  it('un error inesperado → 500 genérico, sin el detalle', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = stub({
      resetPassword: vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.1:5432');
      }),
    });
    const res = await request(montar(service)).post(RESET).send({ token: 't', newPassword: 'clave-nueva-1' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal error' });
  });

  it(`más de ${RESET_LIMIT} intentos en 15 minutos desde la misma IP → 429`, async () => {
    const app = montar(
      stub({
        resetPassword: vi.fn(async () => {
          throw new PasswordResetError('invalid_or_expired_token');
        }),
      }),
    );
    for (let i = 0; i < RESET_LIMIT; i++) {
      expect((await request(app).post(RESET).send({ token: 't', newPassword: 'clave-nueva-1' })).status).toBe(400);
    }
    const res = await request(app).post(RESET).send({ token: 't', newPassword: 'clave-nueva-1' });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'too many requests' });
    expect(RESET_LIMIT).toBe(10);
  });
});

describe('sin sesión', () => {
  it('ninguna de las dos rutas pide sesión: el router no usa la autenticación de auth.ts', () => {
    // Las peticiones de arriba van sin Authorization y reciben 200/400/429;
    // esto vigila que nadie le añada después un requireAuth.
    expect(leer('./password-reset.router.ts')).not.toMatch(/\brequire(Auth|Admin)\b|getPayload|auth\.js/);
  });
});
