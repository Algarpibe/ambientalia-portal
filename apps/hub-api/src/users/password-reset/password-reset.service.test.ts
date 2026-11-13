import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  MAX_REQUESTS_PER_HOUR,
  MIN_REQUEST_INTERVAL_MS,
  PasswordResetError,
  PasswordResetService,
  RESET_TOKEN_TTL_MS,
  generateToken,
  hashToken,
  type ResetLog,
} from './password-reset.service.js';
import { FakeClock, FakeMailer, FakeStore } from './test-fakes.js';

// Las reglas de la recuperación de contraseña sin BD ni red: repositorio,
// correo y reloj son dobles (test-fakes.ts). Los tokens salen de una secuencia
// fija (token-1, token-2…) salvo en el test que mira el generador de verdad.

const PORTAL = 'https://portal.ejemplo.test';
const T0 = Date.parse('2026-11-13T15:00:00.000Z');
const MIN = 60_000;
const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');
/** El error con el que rechaza una promesa, o null si resuelve. */
const fallo = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

function montar({ tokenReal = false }: { tokenReal?: boolean } = {}) {
  const store = new FakeStore();
  const mailer = new FakeMailer();
  const reloj = new FakeClock(T0);
  const eventos: { event: string; data: Record<string, unknown> }[] = [];
  const log: ResetLog = (event, data = {}) => {
    eventos.push({ event, data });
  };
  let n = 0;
  const service = new PasswordResetService({
    store,
    mailer,
    now: reloj.now,
    portalUrl: PORTAL,
    bcryptCost: 4,
    log,
    randomToken: tokenReal ? undefined : () => `token-${++n}`,
  });
  return { store, mailer, reloj, eventos, service };
}

/** Una cuenta activa con un enlace ya pedido (token-1), y correo y log vacíos. */
async function conEnlace() {
  const m = montar();
  const ana = m.store.addUser({ email: 'ana@ejemplo.test', fullName: 'Ana Ruiz' });
  await m.service.requestReset('ana@ejemplo.test');
  m.mailer.sent.length = 0;
  m.eventos.length = 0;
  return { ...m, ana };
}

describe('generateToken y hashToken', () => {
  it('el token son 32 bytes aleatorios en base64url (43 caracteres) y no se repite', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it('la huella es SHA-256 en hex', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('requestReset', () => {
  it('una cuenta active recibe el enlace, con el correo normalizado y el token tras #t=', async () => {
    const { store, mailer, eventos, service } = montar();
    const ana = store.addUser({ email: 'ana@ejemplo.test', fullName: 'Ana Ruiz' });
    await service.requestReset('  ANA@Ejemplo.test ');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].para).toBe('ana@ejemplo.test');
    expect(mailer.sent[0].asunto).toBe('Restablecer tu contraseña del Portal Ambientalia');
    expect(mailer.sent[0].cuerpo).toContain(`href="${PORTAL}/auth/restablecer#t=token-1"`);
    // El log lleva el id, nunca el correo.
    expect(eventos).toEqual([{ event: 'password_reset_requested', data: { user_id: ana.id } }]);
  });

  it.each(['pending', 'inactive'] as const)('una cuenta %s no recibe nada', async (status) => {
    const { store, mailer, eventos, service } = montar();
    store.addUser({ email: 'ana@ejemplo.test', status });
    await service.requestReset('ana@ejemplo.test');
    expect(mailer.sent).toEqual([]);
    expect(store.tokens).toEqual([]);
    expect(eventos).toEqual([]);
  });

  it('un correo desconocido no recibe nada y no falla', async () => {
    const { store, mailer, eventos, service } = montar();
    await service.requestReset('nadie@ejemplo.test');
    expect(mailer.sent).toEqual([]);
    expect(store.tokens).toEqual([]);
    expect(eventos).toEqual([]);
  });

  it('al repositorio solo llega la huella SHA-256, nunca el token', async () => {
    const { store, service } = montar();
    store.addUser({ email: 'ana@ejemplo.test' });
    await service.requestReset('ana@ejemplo.test');
    expect(store.tokens).toHaveLength(1);
    expect(store.tokens[0].tokenHash).toBe(sha256('token-1'));
    expect(JSON.stringify(store.tokens)).not.toContain('token-1');
  });

  it('el enlace caduca a los 30 minutos de pedirlo', async () => {
    const { store, service } = montar();
    store.addUser({ email: 'ana@ejemplo.test' });
    await service.requestReset('ana@ejemplo.test');
    expect(RESET_TOKEN_TTL_MS).toBe(30 * MIN);
    expect(store.tokens[0].expiresAt.getTime()).toBe(T0 + 30 * MIN);
  });

  it('freno: si el último salió hace menos de 2 minutos no crea ni envía (password_reset_frenado)', async () => {
    const { store, mailer, reloj, eventos, service } = montar();
    const ana = store.addUser({ email: 'ana@ejemplo.test' });
    await service.requestReset('ana@ejemplo.test');
    reloj.advance(2 * MIN - 1);
    await service.requestReset('ana@ejemplo.test');
    expect(mailer.sent).toHaveLength(1);
    expect(store.tokens).toHaveLength(1);
    expect(eventos.at(-1)).toEqual({ event: 'password_reset_frenado', data: { user_id: ana.id } });

    reloj.advance(1);
    await service.requestReset('ana@ejemplo.test');
    expect(mailer.sent).toHaveLength(2);
    expect(MIN_REQUEST_INTERVAL_MS).toBe(2 * MIN);
  });

  it('freno: como mucho 5 en una hora; el sexto sale cuando el primero deja la ventana', async () => {
    const { store, mailer, reloj, eventos, service } = montar();
    store.addUser({ email: 'ana@ejemplo.test' });
    for (let i = 0; i < 5; i++) {
      await service.requestReset('ana@ejemplo.test');
      reloj.advance(3 * MIN);
    }
    expect(mailer.sent).toHaveLength(5);

    await service.requestReset('ana@ejemplo.test');
    expect(mailer.sent).toHaveLength(5);
    expect(eventos.at(-1)?.event).toBe('password_reset_frenado');

    // A los 60 minutos justos el primero (T0) sigue dentro de la ventana.
    reloj.set(T0 + 60 * MIN);
    await service.requestReset('ana@ejemplo.test');
    expect(mailer.sent).toHaveLength(5);

    reloj.set(T0 + 60 * MIN + 1);
    await service.requestReset('ana@ejemplo.test');
    expect(mailer.sent).toHaveLength(6);
    expect(MAX_REQUESTS_PER_HOUR).toBe(5);
  });

  it('un enlace nuevo anula el anterior: el primero deja de valer', async () => {
    const { store, reloj, service } = montar();
    store.addUser({ email: 'ana@ejemplo.test' });
    await service.requestReset('ana@ejemplo.test');
    reloj.advance(3 * MIN);
    await service.requestReset('ana@ejemplo.test');

    expect(await fallo(service.resetPassword('token-1', 'clave-nueva-1'))).toMatchObject({ code: 'invalid_or_expired_token' });
    expect(await fallo(service.resetPassword('token-2', 'clave-nueva-1'))).toBeNull();
  });

  it('sin randomToken usa generateToken: 32 bytes en base64url, y a la BD va su huella', async () => {
    const { store, mailer, service } = montar({ tokenReal: true });
    store.addUser({ email: 'ana@ejemplo.test' });
    await service.requestReset('ana@ejemplo.test');
    const token = /#t=([^"<]+)"/.exec(mailer.sent[0].cuerpo)?.[1] ?? '';
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.tokens[0].tokenHash).toBe(sha256(token));
  });
});

describe('resetPassword', () => {
  it('clave de menos de 8 caracteres → password_too_short (400), y el enlace sigue sin gastar', async () => {
    const { store, service, ana } = await conEnlace();
    const error = await fallo(service.resetPassword('token-1', '1234567'));
    expect(error).toBeInstanceOf(PasswordResetError);
    expect(error).toMatchObject({ code: 'password_too_short', status: 400 });
    expect(store.tokens[0].usedAt).toBeNull();
    expect(store.userById(ana.id).passwordHash).toBe('hash-viejo');
  });

  it('una clave que no es texto → password_too_short', async () => {
    const { service } = await conEnlace();
    expect(await fallo(service.resetPassword('token-1', 12345678))).toMatchObject({ code: 'password_too_short' });
  });

  it.each([
    ['vacío', ''],
    ['que no es texto', 42],
    ['ausente', undefined],
    ['desconocido', 'token-que-nadie-pidio'],
  ])('token %s → invalid_or_expired_token (400)', async (_caso, token) => {
    const { service } = await conEnlace();
    expect(await fallo(service.resetPassword(token, 'clave-nueva-1'))).toMatchObject({
      code: 'invalid_or_expired_token',
      status: 400,
    });
  });

  it('restablece: guarda el bcrypt de la clave nueva, sube token_version y gasta el enlace', async () => {
    const { store, eventos, service, ana } = await conEnlace();
    await service.resetPassword('token-1', 'clave-nueva-1');
    const u = store.userById(ana.id);
    expect(await bcrypt.compare('clave-nueva-1', u.passwordHash)).toBe(true);
    expect(u.tokenVersion).toBe(1);
    expect(store.tokens[0].usedAt).toEqual(new Date(T0));
    expect(eventos).toContainEqual({ event: 'password_reset_completed', data: { user_id: ana.id } });
  });

  it('tras restablecer avisa por correo a la propia cuenta', async () => {
    const { mailer, service } = await conEnlace();
    await service.resetPassword('token-1', 'clave-nueva-1');
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
    expect(mailer.sent[0]).toMatchObject({
      para: 'ana@ejemplo.test',
      asunto: 'Tu contraseña del Portal Ambientalia se ha cambiado',
    });
  });

  it('vale hasta un milisegundo antes de los 30 minutos', async () => {
    const { reloj, service } = await conEnlace();
    reloj.advance(30 * MIN - 1);
    expect(await fallo(service.resetPassword('token-1', 'clave-nueva-1'))).toBeNull();
  });

  it('a los 30 minutos ya no vale, y la clave no cambia', async () => {
    const { store, reloj, service, ana } = await conEnlace();
    reloj.advance(30 * MIN);
    expect(await fallo(service.resetPassword('token-1', 'clave-nueva-1'))).toMatchObject({ code: 'invalid_or_expired_token' });
    expect(store.userById(ana.id).passwordHash).toBe('hash-viejo');
  });

  it('solo sirve una vez', async () => {
    const { store, service, ana } = await conEnlace();
    await service.resetPassword('token-1', 'clave-nueva-1');
    expect(await fallo(service.resetPassword('token-1', 'otra-clave-2'))).toMatchObject({ code: 'invalid_or_expired_token' });
    expect(store.userById(ana.id).tokenVersion).toBe(1);
  });

  it('si la cuenta deja de estar activa antes de usar el enlace → invalid_or_expired_token', async () => {
    const { store, service, ana } = await conEnlace();
    store.userById(ana.id).status = 'inactive';
    expect(await fallo(service.resetPassword('token-1', 'clave-nueva-1'))).toMatchObject({ code: 'invalid_or_expired_token' });
    expect(store.userById(ana.id).passwordHash).toBe('hash-viejo');
  });

  it('si el aviso falla, el restablecimiento no se deshace', async () => {
    const { store, mailer, eventos, service, ana } = await conEnlace();
    mailer.fail = true;
    expect(await fallo(service.resetPassword('token-1', 'clave-nueva-1'))).toBeNull();
    expect(store.userById(ana.id).tokenVersion).toBe(1);
    await vi.waitFor(() =>
      expect(eventos).toContainEqual({ event: 'password_reset_envio_fallido', data: { user_id: ana.id } }),
    );
  });

  it('sin bcryptCost usa el coste del registro (12)', async () => {
    const store = new FakeStore();
    const ana = store.addUser({ email: 'ana@ejemplo.test' });
    const service = new PasswordResetService({
      store,
      mailer: new FakeMailer(),
      now: new FakeClock(T0).now,
      portalUrl: PORTAL,
      randomToken: () => 'token-1',
      log: () => {},
    });
    await service.requestReset('ana@ejemplo.test');
    await service.resetPassword('token-1', 'clave-nueva-1');
    expect(store.userById(ana.id).passwordHash).toMatch(/^\$2[ab]\$12\$/);
  });
});
