import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Pool } from '@algarpibe/zoho-sync';

// Regresión de SEC-210 / SEC-211 / PRIV-810: los endpoints de datos deben exigir
// requireApp(<appId>), no solo requireAuth. Antes cualquier autenticado (incluido
// un token legacy AUTH_USERS con apps:[]) leía rentabilidad/valoración/cartera y
// enumeraba el detalle de facturas/OV (NIT + dirección = PII).
//
// IMPORTANTE: auth.ts captura JWT_SECRET en una const AL CARGAR EL MÓDULO → fijamos
// el env ANTES de importar el router y lo importamos de forma DINÁMICA en beforeAll.
// Mismo patrón que contabilidad/router.test.ts.
const SECRET = 'test-secret-data-router';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = '';

// Estado que comparten `token()` y el mock de la BD, para que digan lo mismo.
const estadoAuth = vi.hoisted(() => ({ role: 'reader', apps: [] as string[] }));
vi.mock('./db.js', () => ({
  getHubPool: () => ({
    query: async () => ({
      rows: [{ role: estadoAuth.role, status: 'active', apps: estadoAuth.apps, token_version: 0 }],
      rowCount: 1,
    }),
    on: () => {},
  }),
}));

// Los handlers no son el objeto del test (lo es el guard): mockeamos las fuentes de
// datos para respuestas deterministas y sin BD.
vi.mock('./reconciliation.js', () => ({ getReconciliationData: vi.fn().mockResolvedValue({ pagos: [] }) }));
vi.mock('./inventory.js', () => ({ getInventoryData: vi.fn().mockResolvedValue({ items: [] }) }));
vi.mock('./customerValuation.js', () => ({ getCustomerValuationData: vi.fn().mockResolvedValue({ clientes: [] }) }));
vi.mock('./salesOrders.js', () => ({ getPendingSalesOrders: vi.fn().mockResolvedValue([]) }));
vi.mock('./contabilidad/detalle.js', () => ({
  getDetalleFactura: vi.fn().mockResolvedValue({ numero: 'FV-1', nit: '900', direccion: 'X' }),
  getDetalleOV: vi.fn().mockResolvedValue({ numero: 'OV-1', nit: '900', direccion: 'X' }),
}));

let createDataRouter: typeof import('./data.router.js')['createDataRouter'];
beforeAll(async () => {
  ({ createDataRouter } = await import('./data.router.js'));
});

// El fallback AUTH_USERS se retiró (2026-08-23) y con él la rama que dejaba
// pasar tokens sin `user_id` sin tocar la BD. requireAuth consulta siempre y
// PISA `role` y `apps` con la fila (SEC-224), así que el mock devuelve lo mismo
// que acuña `token()` y las aserciones siguen midiendo lo mismo.
const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function token(apps: string[], role = 'reader'): string {
  estadoAuth.role = role;
  estadoAuth.apps = apps;
  return jwt.sign({ sub: 'u@t.co', user_id: USER_ID, role, apps, token_version: 0 }, SECRET);
}

function app(): express.Express {
  const a = express();
  a.use(express.json());
  const fakePool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;
  a.use('/api', createDataRouter(fakePool));
  return a;
}

// Cada endpoint con el appId que lo debe gate-ar (portal/src/lib/apps.ts).
const ENDPOINTS: { path: string; app: string }[] = [
  { path: '/api/reconciliation/data', app: 'payment-reconciliation' },
  { path: '/api/sales-orders/pending', app: 'payment-reconciliation' },
  { path: '/api/invoices/FV-1/detail', app: 'payment-reconciliation' },
  { path: '/api/sales-orders/OV-1/detail', app: 'payment-reconciliation' },
  { path: '/api/inventory/data', app: 'inventory-optimization' },
  { path: '/api/customer-valuation/data', app: 'customer-valuation' },
];

describe('createDataRouter — autorización por-app (SEC-210/211, PRIV-810)', () => {
  for (const { path, app: appId } of ENDPOINTS) {
    describe(`GET ${path}`, () => {
      it('401 sin token', async () => {
        const res = await request(app()).get(path);
        expect(res.status).toBe(401);
      });

      it('403 con la app equivocada', async () => {
        const res = await request(app()).get(path).set('Authorization', `Bearer ${token(['otra-app'])}`);
        expect(res.status).toBe(403);
      });

      it('403 con token legacy sin apps (fallback reader) — regresión PRIV-810', async () => {
        const res = await request(app()).get(path).set('Authorization', `Bearer ${token([])}`);
        expect(res.status).toBe(403);
      });

      it(`200 con la app '${appId}' asignada`, async () => {
        const res = await request(app()).get(path).set('Authorization', `Bearer ${token([appId])}`);
        expect(res.status).toBe(200);
      });

      it('200 para admin (bypass por-app)', async () => {
        const res = await request(app()).get(path).set('Authorization', `Bearer ${token([], 'admin')}`);
        expect(res.status).toBe(200);
      });
    });
  }

  it('el detalle de factura NO es accesible sin la app payment-reconciliation (no filtra NIT+dirección)', async () => {
    const res = await request(app())
      .get('/api/invoices/FV-1/detail')
      .set('Authorization', `Bearer ${token(['customer-valuation'])}`);
    expect(res.status).toBe(403);
    expect(res.body.nit).toBeUndefined();
    expect(res.body.direccion).toBeUndefined();
  });
});
