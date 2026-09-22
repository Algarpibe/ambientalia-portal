import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Pool } from '@algarpibe/zoho-sync';
import type { AnticiposEnlazados } from './anticipos.js';
import { clearCache } from '../cache.js';

// Mismo arranque que router.test.ts: auth.ts lee JWT_SECRET AL CARGAR, así que el env se fija
// antes de importar el router, y el router se importa dinámicamente en beforeAll.
const SECRET = 'test-secret-anticipos';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = '';

// requireAuth consulta la BD y PISA role/apps con lo que diga la fila: el mock devuelve
// exactamente lo que acuña token().
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

// Los anticipos se simulan con la lógica REAL de enlace sobre un caso fijo; `falla` imita que
// books.retainer_invoices aún no exista (el worker sin desplegar); `fallaFusion` imita que la
// LECTURA vaya bien pero la fusión posterior (conAnticipo, o el acceso al Map de resultados)
// reviente por algo inesperado — el otro tramo que la resiliencia debe cubrir.
const anticiposMock = vi.hoisted(() => ({ falla: false, fallaFusion: false }));
vi.mock('./anticipos.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./anticipos.js')>();
  return {
    ...real,
    getAnticiposEnlazados: vi.fn(async () => {
      if (anticiposMock.falla) throw new Error('relation "books.retainer_invoices" does not exist');
      return real.enlazarAnticipos(
        [{ numero: 'ANT-2026-063', fecha: '2026-09-15', estado: 'paid', cliente: 'SGS', moneda: 'COP', cobrado: 1000, aplicado: 0, referencia: null, descripciones: ['Anticipo OV-2026-167'] }],
        [{ numero: 'OV-2026-167', estado: 'open', moneda: 'COP' }],
      );
    }),
    conAnticipo: vi.fn((o: { salesorder_number: string }, enl: AnticiposEnlazados) => {
      if (anticiposMock.fallaFusion) throw new Error('fusión rota');
      return real.conAnticipo(o, enl);
    }),
  };
});

vi.mock('./ovPendientes.js', () => ({
  getOVPendientesFacturables: vi.fn(async () => [{
    salesorder_number: 'OV-2026-167', date: '2026-09-01', customer_name: 'SGS', status: 'open',
    currency_code: 'COP', total: 1000, pending: 1000, shipment_date: null,
    despachada: false, despachoParcial: false, soloPaquete: false, ticketPorFacturar: false,
    paquetePorCrear: false, facturable: false, ticket: null, trato: '', qt: '',
  }]),
}));

vi.mock('./detalle.js', () => ({
  getDetalleFactura: vi.fn(async () => null),
  getDetalleOV: vi.fn(async (_db: unknown, numero: string) => ({
    numero, cliente: 'SGS', nit: null, direccion: null, fecha: '2026-09-01', entrega: null,
    terminos: null, lineas: [], subtotal: 0, iva: 0, total: 0,
  })),
}));

let createContabilidadRouter: typeof import('./router.js')['createContabilidadRouter'];
beforeAll(async () => {
  ({ createContabilidadRouter } = await import('./router.js'));
});

// La caché del router es de módulo y dura 120 s: sin limpiarla, un test vería lo del anterior.
beforeEach(() => {
  clearCache();
  anticiposMock.falla = false;
  anticiposMock.fallaFusion = false;
});

const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
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

const get = (ruta: string, apps: string[], role = 'reader') =>
  request(app()).get(ruta).set('Authorization', `Bearer ${token(apps, role)}`);

describe('anticipos en GET /contabilidad/ov-pendientes', () => {
  it('con Contabilidad cada OV trae anticipoCobrado y anticipoSinAplicar', async () => {
    const res = await get('/api/contabilidad/ov-pendientes', ['contabilidad']);
    expect(res.status).toBe(200);
    expect(res.body.orders[0]).toMatchObject({ anticipoCobrado: 1000, anticipoSinAplicar: 1000 });
  });

  it('con SOLO ov-pendientes los campos NO se envían, ni siquiera a cero', async () => {
    const res = await get('/api/contabilidad/ov-pendientes', ['ov-pendientes']);
    expect(res.status).toBe(200);
    expect(res.body.orders[0]).not.toHaveProperty('anticipoCobrado');
    expect(res.body.orders[0]).not.toHaveProperty('anticipoSinAplicar');
  });

  it('un admin sin la app los ve: misma regla que requireApp', async () => {
    const res = await get('/api/contabilidad/ov-pendientes', [], 'admin');
    expect(res.body.orders[0]).toHaveProperty('anticipoCobrado', 1000);
  });

  it('si leer los anticipos falla, la tabla responde igual, sin ellos', async () => {
    anticiposMock.falla = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('/api/contabilidad/ov-pendientes', ['contabilidad']);
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0]).not.toHaveProperty('anticipoCobrado');
  });

  it('si la fusión de anticipos falla (no solo la lectura), la tabla sigue respondiendo sin ellos', async () => {
    anticiposMock.fallaFusion = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('/api/contabilidad/ov-pendientes', ['contabilidad']);
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0]).not.toHaveProperty('anticipoCobrado');
  });

  it('no contamina la lista cacheada: después de Contabilidad, ov-pendientes sigue sin campos', async () => {
    await get('/api/contabilidad/ov-pendientes', ['contabilidad']);
    const res = await get('/api/contabilidad/ov-pendientes', ['ov-pendientes']);
    expect(res.body.orders[0]).not.toHaveProperty('anticipoCobrado');
  });
});

describe('anticipos en GET /contabilidad/ov/:numero', () => {
  it('con Contabilidad trae la lista de anticipos de la OV', async () => {
    const res = await get('/api/contabilidad/ov/OV-2026-167', ['contabilidad']);
    expect(res.status).toBe(200);
    expect(res.body.anticipos).toEqual([
      { numero: 'ANT-2026-063', fecha: '2026-09-15', estado: 'paid', cobrado: 1000, sinAplicar: 1000 },
    ]);
  });

  it('una OV sin anticipos trae la lista vacía', async () => {
    const res = await get('/api/contabilidad/ov/OV-2026-999', ['contabilidad']);
    expect(res.body.anticipos).toEqual([]);
  });

  it('con SOLO ov-pendientes no trae la lista', async () => {
    const res = await get('/api/contabilidad/ov/OV-2026-167', ['ov-pendientes']);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('anticipos');
  });
});

describe('GET /contabilidad/anticipos-atencion', () => {
  it('403 con SOLO ov-pendientes', async () => {
    const res = await get('/api/contabilidad/anticipos-atencion', ['ov-pendientes']);
    expect(res.status).toBe(403);
  });

  it('200 con Contabilidad y devuelve la lista', async () => {
    const res = await get('/api/contabilidad/anticipos-atencion', ['contabilidad']);
    expect(res.status).toBe(200);
    expect(res.body.anticipos).toEqual([]);
  });
});
