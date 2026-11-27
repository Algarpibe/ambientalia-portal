import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Pool } from '@algarpibe/zoho-sync';
import { cached, clearCache } from '../cache.js';

// auth.ts captura JWT_SECRET al cargarse: el env va antes de importarlo y el
// router se importa de forma dinámica en beforeAll. Mismo patrón que
// contabilidad/router.test.ts.
const SECRET = 'test-secret-laboratorios';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = '';

// requireAuth consulta la fila del usuario en cada petición (SEC-224) y pisa
// role/apps del token con los de la fila: el mock y token() dicen lo mismo.
const estadoAuth = vi.hoisted(() => ({ role: 'reader', apps: [] as string[] }));
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async () => ({
      rows: [{ role: estadoAuth.role, status: 'active', apps: estadoAuth.apps, token_version: 0 }],
      rowCount: 1,
    }),
    on: () => {},
  }),
}));

let createLaboratoriosRouter: typeof import('./router.js')['createLaboratoriosRouter'];
let MAX_NITS: number;
let CLAVE_CACHE: string;
let leerNits: typeof import('./router.js')['leerNits'];
beforeAll(async () => {
  ({ createLaboratoriosRouter, MAX_NITS, CLAVE_CACHE, leerNits } = await import('./router.js'));
});

// La caché es del módulo: sin esto, una prueba vería el resultado de la anterior.
beforeEach(() => clearCache());

const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OTRO_USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
function token(apps: string[], role = 'reader', userId = USER_ID): string {
  estadoAuth.role = role;
  estadoAuth.apps = apps;
  return jwt.sign({ sub: 'u@t.co', user_id: userId, role, apps, token_version: 0 }, SECRET);
}

// NIT y fechas ficticios: el repo es público.
const FILAS = [
  { nit: '900000001', ultima_factura: '2026-03-10', ocma_vendido: '2024-05-02', ultimos_repuestos: null },
  { nit: '900.000.002-5', ultima_factura: null, ocma_vendido: null, ultimos_repuestos: null },
];

function poolFalso(filas: unknown[] = FILAS) {
  return { query: vi.fn().mockResolvedValue({ rows: filas }) };
}

function appCon(pool: { query: unknown }): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api', createLaboratoriosRouter(pool as unknown as Pool));
  return app;
}

const RUTA = '/api/laboratorios/clientes';
const CON_APP = () => `Bearer ${token(['laboratorios-ambientales'])}`;

describe('POST /api/laboratorios/clientes — acceso', () => {
  it('401 sin token', async () => {
    const res = await request(appCon(poolFalso())).post(RUTA).send({ nits: ['900000001'] });
    expect(res.status).toBe(401);
  });

  it('403 si el usuario no tiene la app de Laboratorios', async () => {
    const res = await request(appCon(poolFalso()))
      .post(RUTA)
      .set('Authorization', `Bearer ${token(['contabilidad'])}`)
      .send({ nits: ['900000001'] });
    expect(res.status).toBe(403);
  });

  it('un admin sin la app asignada entra', async () => {
    const res = await request(appCon(poolFalso()))
      .post(RUTA)
      .set('Authorization', `Bearer ${token([], 'admin')}`)
      .send({ nits: ['900000001'] });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/laboratorios/clientes — cuerpo', () => {
  it.each([
    ['sin cuerpo', undefined],
    ['nits que no es una lista', { nits: '900000001' }],
    ['un NIT que no es texto', { nits: [900000001] }],
    ['un NIT de relleno', { nits: ['0'] }],
    ['un NIT de más de 10 dígitos', { nits: ['12345678901'] }],
  ])('400 con %s', async (_caso, cuerpo) => {
    const pool = poolFalso();
    const peticion = request(appCon(pool)).post(RUTA).set('Authorization', CON_APP());
    const res = await (cuerpo === undefined ? peticion : peticion.send(cuerpo));
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('el tope es de 150 NIT', () => {
    expect(MAX_NITS).toBe(150);
  });

  it('400 con más de MAX_NITS NIT', async () => {
    const nits = Array.from({ length: MAX_NITS + 1 }, (_, i) => String(900000000 + i));
    const res = await request(appCon(poolFalso())).post(RUTA).set('Authorization', CON_APP()).send({ nits });
    expect(res.status).toBe(400);
  });

  it('acepta exactamente MAX_NITS NIT', async () => {
    const nits = Array.from({ length: MAX_NITS }, (_, i) => String(900000000 + i));
    const res = await request(appCon(poolFalso())).post(RUTA).set('Authorization', CON_APP()).send({ nits });
    expect(res.status).toBe(200);
  });

  it('una lista vacía da 200 con clientes vacío', async () => {
    const res = await request(appCon(poolFalso())).post(RUTA).set('Authorization', CON_APP()).send({ nits: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clientes: [] });
  });
});

describe('POST /api/laboratorios/clientes — respuesta', () => {
  it('devuelve solo los NIT pedidos que están en Zoho, en NIT base', async () => {
    const res = await request(appCon(poolFalso()))
      .post(RUTA)
      .set('Authorization', CON_APP())
      .send({ nits: ['900.000.001-7', '800000009'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      clientes: [{ nit: '900000001', ultimaFactura: '2026-03-10', ocmaVendido: '2024-05-02', ultimosRepuestos: null }],
    });
  });

  it('cada cliente lleva exactamente cuatro campos aunque el cruce traiga más', async () => {
    // Se siembra la caché con un valor que trae campos de más: así la prueba mira
    // la lista de campos del router, y no el filtro de agruparPorNit.
    await cached(CLAVE_CACHE, async () => new Map([['900000001', { ...{ ultimaFactura: '2026-03-10', ocmaVendido: null, ultimosRepuestos: null }, total: 123, customer_name: 'Cliente Ficticio' }]]));
    const pool = poolFalso();
    const res = await request(appCon(pool)).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000001'] });
    expect(Object.keys(res.body.clientes[0]).sort()).toEqual(['nit', 'ocmaVendido', 'ultimaFactura', 'ultimosRepuestos']);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('un NIT en Zoho sin facturas sale con las tres fechas a null', async () => {
    const res = await request(appCon(poolFalso())).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000002'] });
    expect(res.body.clientes).toEqual([
      { nit: '900000002', ultimaFactura: null, ocmaVendido: null, ultimosRepuestos: null },
    ]);
  });

  it('un NIT pedido dos veces, con y sin formato, sale una vez', async () => {
    const res = await request(appCon(poolFalso()))
      .post(RUTA)
      .set('Authorization', CON_APP())
      .send({ nits: ['900000001', '900.000.001-7'] });
    expect(res.body.clientes).toHaveLength(1);
  });

  it('la segunda petición sale de la caché y no vuelve a consultar la réplica', async () => {
    const pool = poolFalso();
    const app = appCon(pool);
    await request(app).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000001'] });
    await request(app).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000002'] });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('500 sin detalle si falla la réplica', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('conexión rota')) };
    const res = await request(appCon(pool)).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000001'] });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal error' });
  });
});

describe('POST /api/laboratorios/clientes — límite por usuario', () => {
  it('la sexta petición en un minuto del mismo usuario da 429', async () => {
    const app = appCon(poolFalso());
    for (let i = 0; i < 5; i++) {
      const ok = await request(app).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000001'] });
      expect(ok.status).toBe(200);
    }
    const res = await request(app).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000001'] });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'too_many_requests' });
  });

  it('el límite es por usuario: otro usuario no lo nota', async () => {
    const app = appCon(poolFalso());
    for (let i = 0; i < 5; i++) {
      await request(app).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000001'] });
    }
    const a = await request(app).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000001'] });
    expect(a.status).toBe(429);
    const b = await request(app)
      .post(RUTA)
      .set('Authorization', `Bearer ${token(['laboratorios-ambientales'], 'reader', OTRO_USER_ID)}`)
      .send({ nits: ['900000001'] });
    expect(b.status).toBe(200);
  });

  it('un 403 no gasta cupo', async () => {
    const app = appCon(poolFalso());
    const sinApp = `Bearer ${token(['contabilidad'], 'reader', OTRO_USER_ID)}`;
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post(RUTA).set('Authorization', sinApp).send({ nits: ['900000001'] });
      expect(res.status).toBe(403);
    }
    const ok = await request(app).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000001'] });
    expect(ok.status).toBe(200);
  });
});

describe('leerNits', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['una lista en la raíz', []],
    ['un texto', 'x'],
  ])('null con %s', (_caso, cuerpo) => {
    expect(leerNits(cuerpo)).toBeNull();
  });

  it('una lista vacía da []', () => {
    expect(leerNits({ nits: [] })).toEqual([]);
  });

  it('devuelve NIT base sin repetir', () => {
    expect(leerNits({ nits: ['900.000.001-7', '900000001', '800000009'] })).toEqual(['900000001', '800000009']);
  });
});
