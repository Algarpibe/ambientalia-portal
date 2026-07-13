import { describe, it, expect, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// El módulo lee las envs al importarse → las fijamos ANTES del import dinámico.
const PASSWORD = 'S3cret-pass-123';
const HASH = bcrypt.hashSync(PASSWORD, 10);
process.env.JWT_SECRET = 'test-secret-para-firmar';
process.env.AUTH_USERS = `user@ambientalia.com.co:${HASH}`;
process.env.API_KEY = 'clave-legacy';

let auth: typeof import('./auth.js');
beforeAll(async () => { auth = await import('./auth.js'); });

// Mocks mínimos de Express (header case-insensitive, como el real).
function mockReq(headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const k in headers) lower[k.toLowerCase()] = headers[k];
  return { header: (n: string) => lower[n.toLowerCase()] } as any;
}
function mockRes() {
  const res: any = { statusCode: 200, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (o: any) => { res.body = o; return res; };
  return res;
}

describe('verifyCredentials', () => {
  it('acepta la contraseña correcta del usuario configurado', async () => {
    expect(await auth.verifyCredentials('user@ambientalia.com.co', PASSWORD)).toBe(true);
  });
  it('es case-insensitive en el email', async () => {
    expect(await auth.verifyCredentials('USER@Ambientalia.com.co', PASSWORD)).toBe(true);
  });
  it('rechaza la contraseña incorrecta', async () => {
    expect(await auth.verifyCredentials('user@ambientalia.com.co', 'otra')).toBe(false);
  });
  it('rechaza un usuario desconocido', async () => {
    expect(await auth.verifyCredentials('nadie@x.com', PASSWORD)).toBe(false);
  });
  it('rechaza credenciales vacías', async () => {
    expect(await auth.verifyCredentials('', '')).toBe(false);
  });
});

describe('issueToken', () => {
  it('emite un JWT válido con sub = email (normalizado)', () => {
    const token = auth.issueToken('User@Ambientalia.com.co');
    const payload = jwt.verify(token, 'test-secret-para-firmar') as jwt.JwtPayload;
    expect(payload.sub).toBe('user@ambientalia.com.co');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe('requireAuth (dual: JWT o x-api-key legacy)', () => {
  it('deja pasar con un Bearer JWT válido', () => {
    const token = auth.issueToken('user@ambientalia.com.co');
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    let passed = false;
    auth.requireAuth(req, res, () => { passed = true; });
    expect(passed).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('deja pasar con la x-api-key legacy (transición)', () => {
    const req = mockReq({ 'x-api-key': 'clave-legacy' });
    const res = mockRes();
    let passed = false;
    auth.requireAuth(req, res, () => { passed = true; });
    expect(passed).toBe(true);
  });

  it('rechaza (401) sin credenciales', () => {
    const req = mockReq({});
    const res = mockRes();
    let passed = false;
    auth.requireAuth(req, res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('rechaza (401) con un JWT inválido', () => {
    const req = mockReq({ authorization: 'Bearer no-es-un-jwt' });
    const res = mockRes();
    let passed = false;
    auth.requireAuth(req, res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('rechaza (401) con una x-api-key equivocada', () => {
    const req = mockReq({ 'x-api-key': 'clave-mala' });
    const res = mockRes();
    let passed = false;
    auth.requireAuth(req, res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
