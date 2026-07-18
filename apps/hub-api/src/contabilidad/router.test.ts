import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Pool } from '@algarpibe/zoho-sync';

// IMPORTANTE: auth.ts captura JWT_SECRET en una const AL CARGAR EL MÓDULO. Por eso
// (1) fijamos el env ANTES de cualquier import de auth, y (2) importamos el router
// de forma DINÁMICA en beforeAll (import estático evaluaría auth.ts con el secret
// vacío). Mismo patrón que auth.middleware.test.ts.
const SECRET = 'test-secret-contabilidad';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = '';

let createContabilidadRouter: typeof import('./router.js')['createContabilidadRouter'];
beforeAll(async () => {
  ({ createContabilidadRouter } = await import('./router.js'));
});

// requireAuth de auth.ts consulta la BD para usuarios con user_id. Usamos un
// token legacy (sin user_id) para que pase por la rama que no toca BD.
function token(apps: string[], role = 'reader'): string {
  return jwt.sign({ sub: 'u@t.co', role, apps }, SECRET); // sin user_id -> rama legacy
}

function appConPool(pool: Partial<Pool>): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api', createContabilidadRouter(pool as Pool));
  return app;
}

const fakePool = (): Partial<Pool> => ({
  // getContabilidadData hace 2 queries: facturas y overrides. Devolvemos vacío.
  query: vi.fn().mockResolvedValue({ rows: [] }),
});

describe('GET /api/contabilidad/facturas', () => {
  it('401 sin token', async () => {
    const res = await request(appConPool(fakePool())).get('/api/contabilidad/facturas');
    expect(res.status).toBe(401);
  });

  it('403 si el JWT no tiene la app contabilidad', async () => {
    const res = await request(appConPool(fakePool()))
      .get('/api/contabilidad/facturas')
      .set('Authorization', `Bearer ${token(['otra-app'])}`);
    expect(res.status).toBe(403);
  });

  it('200 y devuelve { facturas, resumen } con la app asignada', async () => {
    const res = await request(appConPool(fakePool()))
      .get('/api/contabilidad/facturas')
      .set('Authorization', `Bearer ${token(['contabilidad'])}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.facturas)).toBe(true);
    expect(res.body.resumen.meses).toHaveLength(12);
  });

  it('200 devuelve anioActual y aniosDisponibles', async () => {
    const res = await request(appConPool(fakePool()))
      .get('/api/contabilidad/facturas?year=2025')
      .set('Authorization', `Bearer ${token(['contabilidad'])}`);
    expect(res.status).toBe(200);
    expect(res.body.anioActual).toBe(2025);
    expect(Array.isArray(res.body.aniosDisponibles)).toBe(true);
    expect(res.body.resumen.cumplimientoPct).toBeNull(); // sin presupuesto en fakePool
  });
});

describe('PUT /api/contabilidad/cartera/:invoiceNumber', () => {
  it('403 sin la app asignada', async () => {
    const res = await request(appConPool(fakePool()))
      .put('/api/contabilidad/cartera/AM0001')
      .set('Authorization', `Bearer ${token(['otra-app'])}`)
      .send({ cartera: 'En gestión' });
    expect(res.status).toBe(403);
  });

  it('200 y hace upsert de la cartera', async () => {
    const pool = fakePool();
    const res = await request(appConPool(pool))
      .put('/api/contabilidad/cartera/AM0001')
      .set('Authorization', `Bearer ${token(['contabilidad'])}`)
      .send({ cartera: 'En gestión' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(pool.query).toHaveBeenCalled();
  });

  it('400 si falta el campo cartera', async () => {
    const res = await request(appConPool(fakePool()))
      .put('/api/contabilidad/cartera/AM0001')
      .set('Authorization', `Bearer ${token(['contabilidad'])}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/contabilidad/budget/:year', () => {
  it('403 si no es admin', async () => {
    const res = await request(appConPool(fakePool()))
      .put('/api/contabilidad/budget/2027')
      .set('Authorization', `Bearer ${token(['contabilidad'], 'reader')}`)
      .send({ presupuesto: 1000 });
    expect(res.status).toBe(403);
  });
});
