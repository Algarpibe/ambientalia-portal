import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Pool } from '@algarpibe/zoho-sync';
import { clearCache } from '../cache.js';

// Mismo arranque que router.anticipos.test.ts: auth.ts lee JWT_SECRET AL CARGAR, así que el
// env se fija antes de importar el router, y el router se importa dinámicamente en beforeAll.
const SECRET = 'test-secret-pagos';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = '';

// requireAuth consulta la BD y PISA role/apps con lo que diga la fila.
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

const SEMANA = {
  anio: 2026, mes: 9, semana: 1, etiqueta: '1-6 sep 2026', desde: '2026-09-01', hasta: '2026-09-06',
  cantidadPagos: 1, totales: [{ moneda: 'COP', total: 1000 }],
  pagos: [{ numero: 'PC-1', cliente: 'SHI', fecha: '2026-09-02', modo: null, referencia: null, moneda: 'COP', importe: 1000, sinAplicar: 0, aplicaciones: [] }],
};
const pagosMock = vi.hoisted(() => ({ falla: false }));
vi.mock('./pagos.js', () => ({
  getPagosPorSemana: vi.fn(async () => {
    if (pagosMock.falla) throw new Error('relation "books.customer_payments" does not exist');
    return [SEMANA];
  }),
}));

let createContabilidadRouter: typeof import('./router.js')['createContabilidadRouter'];
beforeAll(async () => {
  ({ createContabilidadRouter } = await import('./router.js'));
});

// La caché del router es de módulo y dura 120 s: sin limpiarla, un test vería lo del anterior.
beforeEach(() => {
  clearCache();
  pagosMock.falla = false;
});

const USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
function token(apps: string[], role = 'reader'): string {
  estadoAuth.role = role;
  estadoAuth.apps = apps;
  return jwt.sign({ sub: 'u@t.co', user_id: USER_ID, role, apps, token_version: 0 }, SECRET);
}

function app(): express.Express {
  const a = express();
  a.use(express.json());
  a.use('/api', createContabilidadRouter({ query: vi.fn() } as unknown as Pool));
  return a;
}

const get = (apps: string[], role = 'reader') =>
  request(app()).get('/api/contabilidad/pagos').set('Authorization', `Bearer ${token(apps, role)}`);

describe('GET /contabilidad/pagos', () => {
  it('401 sin token', async () => {
    const res = await request(app()).get('/api/contabilidad/pagos');
    expect(res.status).toBe(401);
  });

  it('403 con SOLO ov-pendientes: es información de cobro', async () => {
    const res = await get(['ov-pendientes']);
    expect(res.status).toBe(403);
  });

  it('200 con Contabilidad y devuelve las semanas', async () => {
    const res = await get(['contabilidad']);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ semanas: [SEMANA] });
  });

  it('un admin sin la app también entra: misma regla que requireApp', async () => {
    const res = await get([], 'admin');
    expect(res.status).toBe(200);
  });

  it('si la lectura falla responde 500', async () => {
    pagosMock.falla = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get(['contabilidad']);
    spy.mockRestore();
    expect(res.status).toBe(500);
  });
});
