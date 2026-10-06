import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Pool } from '@algarpibe/zoho-sync';

// Cableado HTTP del router: guardas de auth/app y validación 400 antes de
// cualquier escritura. El SQL lo cubre trazabilidad.db.test.ts; aquí el pool
// es un doble que registra las consultas para comprobar que no se escribió nada.

const SECRET = 'test-secret-trazabilidad';
process.env.JWT_SECRET = SECRET;

const authState = vi.hoisted(() => ({ byUser: new Map<string, { role: string; apps: string[] }>() }));
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async (_sql: string, params: unknown[] = []) => {
      const row = authState.byUser.get(String(params[0] ?? '')) ?? { role: 'reader', apps: ['trazabilidad-mantenimientos'] };
      return { rows: [{ role: row.role, status: 'active', apps: row.apps, token_version: 0 }], rowCount: 1 };
    },
    on: () => {},
  }),
}));

const { createTrazabilidadRouter } = await import('./router.js');

const queries: string[] = [];
const fakePool = {
  query: async (sql: string) => {
    queries.push(sql);
    return { rows: [], rowCount: 0 };
  },
  connect: async () => {
    throw new Error('sin transacciones en este test');
  },
} as unknown as Pool;

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api', createTrazabilidadRouter(fakePool));
  return a;
}

let seq = 0;
function tokenFor(apps: string[] = ['trazabilidad-mantenimientos']): string {
  const userId = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  authState.byUser.set(userId, { role: 'reader', apps });
  return jwt.sign({ sub: `u${seq}@ambientalia.com.co`, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' });
}
const auth = (t = tokenFor()) => ({ Authorization: `Bearer ${t}` });

beforeEach(() => {
  queries.length = 0;
});

describe('guardas', () => {
  it('401 sin token', async () => {
    expect((await request(app()).get('/api/trazabilidad/equipos')).status).toBe(401);
  });

  it('403 sin la app asignada', async () => {
    const res = await request(app()).get('/api/trazabilidad/equipos').set(auth(tokenFor(['ausencias'])));
    expect(res.status).toBe(403);
  });

  it('200 con la app: devuelve hoy, equipos y la última importación', async () => {
    const res = await request(app()).get('/api/trazabilidad/equipos?hoy=2026-10-06').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hoy: '2026-10-06', equipos: [], ultimaImportacion: null });
  });

  it('400 con un «hoy» mal formado', async () => {
    const res = await request(app()).get('/api/trazabilidad/equipos?hoy=06-10-2026').set(auth());
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('hoy');
  });
});

describe('servicios y plazos', () => {
  it('servicios: 401 sin token y 403 sin la app', async () => {
    expect((await request(app()).get('/api/trazabilidad/servicios')).status).toBe(401);
    expect((await request(app()).get('/api/trazabilidad/servicios').set(auth(tokenFor(['ausencias'])))).status).toBe(403);
    expect((await request(app()).get('/api/trazabilidad/plazos').set(auth(tokenFor(['ausencias'])))).status).toBe(403);
    expect((await request(app()).put('/api/trazabilidad/plazos').set(auth(tokenFor(['ausencias']))).send({ tipo: 'Otro', dias: 2 })).status).toBe(403);
  });

  it('servicios: 200 con hoy, la lista y los festivos del eje', async () => {
    const res = await request(app()).get('/api/trazabilidad/servicios?hoy=2026-10-06').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hoy: '2026-10-06', servicios: [] });
    expect(res.body.festivos).toContain('2026-10-12');
  });

  it('servicios: 400 con un «hoy» mal formado', async () => {
    const res = await request(app()).get('/api/trazabilidad/servicios?hoy=ayer').set(auth());
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('hoy');
  });

  it('plazos: 200 con la lista', async () => {
    const res = await request(app()).get('/api/trazabilidad/plazos').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ plazos: [] });
  });

  it.each([0, 366, -1, 1.5, '3', 'tres', true])('plazo no válido (%j) → 400 en «dias» y ninguna consulta', async (dias) => {
    const res = await request(app()).put('/api/trazabilidad/plazos').set(auth()).send({ tipo: 'Diagnóstico', dias });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('dias');
    expect(res.body.message).toMatch(/entre 1 y 365/);
    expect(queries).toEqual([]);
  });

  it('plazo sin tipo de servicio → 400 en «tipo»', async () => {
    const res = await request(app()).put('/api/trazabilidad/plazos').set(auth()).send({ tipo: '  ', dias: 3 });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('tipo');
    expect(queries).toEqual([]);
  });

  it('plazo válido, o vacío para dejarlo «sin plazo» → 200', async () => {
    for (const dias of [1, 365, null]) {
      const res = await request(app()).put('/api/trazabilidad/plazos').set(auth()).send({ tipo: 'Diagnóstico', dias });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ plazos: [] });
    }
    expect(queries.some((q) => /INSERT INTO portal\.tmc_plazos/.test(q))).toBe(true);
  });

  it('servicios: la respuesta trae también los tipos que se pueden elegir a mano', async () => {
    const res = await request(app()).get('/api/trazabilidad/servicios?hoy=2026-10-06').set(auth());
    expect(res.body.tipos).toEqual([]);
  });
});

describe('tipo de servicio puesto a mano', () => {
  const put = (numero: string, body: unknown, t = auth()) => request(app()).put(`/api/trazabilidad/servicios/${numero}/tipo`).set(t).send(body as object);

  it('401 sin token y 403 sin la app', async () => {
    expect((await request(app()).put('/api/trazabilidad/servicios/962/tipo').send({ tipo: 'Diagnóstico' })).status).toBe(401);
    expect((await put('962', { tipo: 'Diagnóstico' }, auth(tokenFor(['ausencias'])))).status).toBe(403);
    expect(queries).toEqual([]);
  });

  it.each(['0', '-3', '1.5', 'abc', '12a', '9999999999', '%20'])('número de ticket no válido (%s) → 400 en «numero» y ninguna consulta', async (numero) => {
    const res = await put(numero, { tipo: 'Diagnóstico' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('numero');
    expect(res.body.message).toMatch(/número de ticket/i);
    expect(queries).toEqual([]);
  });

  it.each([3, true, ['Diagnóstico'], { a: 1 }])('tipo que no es texto (%j) → 400 en «tipo» y ninguna consulta', async (tipo) => {
    const res = await put('962', { tipo });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('tipo');
    expect(queries).toEqual([]);
  });

  it('sin el campo «tipo», o con un cuerpo que no es un objeto → 400', async () => {
    expect((await put('962', {})).body.field).toBe('tipo');
    expect((await put('962', [])).status).toBe(400);
    expect(queries).toEqual([]);
  });

  it('un tipo demasiado largo → 400 en «tipo»', async () => {
    const res = await put('962', { tipo: 'x'.repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('tipo');
    expect(queries).toEqual([]);
  });

  it('un ticket que no está en Desk → 404 y no se escribe nada', async () => {
    for (const tipo of ['Diagnóstico', null, '']) {
      const res = await put('962', { tipo });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/ticket/i);
    }
    expect(queries.some((q) => /INSERT|DELETE|UPDATE/.test(q))).toBe(false);
  });
});

describe('validación antes de escribir', () => {
  it('importación sin filas → 400 y ninguna consulta', async () => {
    const res = await request(app()).post('/api/trazabilidad/importaciones').set(auth()).send({ archivo: 'x.xlsx', filas: [] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ningún GRIMM EDM 180/);
    expect(queries).toEqual([]);
  });

  it('importación con un modelo que no es EDM 180 → 400 con el campo', async () => {
    const res = await request(app())
      .post('/api/trazabilidad/importaciones')
      .set(auth())
      .send({ archivo: 'x.xlsx', filas: [{ serial: '1', cliente: 'C', marca: 'Grimm', modelo: 'EDM 280' }] });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('filas[0].modelo');
    expect(queries).toEqual([]);
  });

  it('seguimiento con clave no válida → 400', async () => {
    const res = await request(app()).put('/api/trazabilidad/seguimiento/a%20b').set(auth()).send({ enAmbientalia: true });
    expect(res.status).toBe(400);
    expect(queries).toEqual([]);
  });

  it('seguimiento con fecha imposible → 400', async () => {
    const res = await request(app())
      .put('/api/trazabilidad/seguimiento/18A00006')
      .set(auth())
      .send({ enAmbientalia: false, avisoEnviado: '2026-02-30' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('avisoEnviado');
    expect(queries).toEqual([]);
  });

  it('seguimiento de un equipo que no está en el inventario → 404', async () => {
    const res = await request(app()).put('/api/trazabilidad/seguimiento/NOEXISTE').set(auth()).send({ enAmbientalia: true });
    expect(res.status).toBe(404);
  });

  it('avisos sin claves → 400', async () => {
    const res = await request(app()).post('/api/trazabilidad/avisos').set(auth()).send({ claves: [], fecha: '2026-10-06' });
    expect(res.status).toBe(400);
    expect(queries).toEqual([]);
  });
});
