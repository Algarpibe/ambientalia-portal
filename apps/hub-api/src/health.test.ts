import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter, HEALTH_MAX_POR_MINUTO } from './health.js';

// INFRA-532 — /health es anónimo y vive fuera del limitador de /api/. Antes
// hacía tres count(*) sobre tablas completas en cada llamada, y como el pool es
// el mismo del login, martillearlo dejaba sin conexiones al resto del backend.
// Aquí no hay BD: el pool es un doble que apunta lo que se le pide.

afterEach(() => vi.restoreAllMocks());

function app(responder: (sql: string) => Promise<{ rows: unknown[] }>) {
  const consultas: string[] = [];
  const db = { query: (sql: string) => { consultas.push(sql); return responder(sql); } };
  const a = express();
  a.use(createHealthRouter(() => db));
  return { a, consultas };
}

const sano = async () => ({ rows: [{ ok: true }] });

describe('GET /health', () => {
  it('responde ok con una consulta de catálogo, sin contar filas de ninguna tabla', async () => {
    const { a, consultas } = app(sano);
    const res = await request(a).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(consultas).toHaveLength(1);
    expect(consultas[0]).not.toMatch(/count\s*\(/i);
    for (const tabla of ['crm.deals', 'books.invoices', 'desk.tickets']) {
      expect(consultas[0]).toContain(`to_regclass('${tabla}')`);
    }
  });

  it('si falta alguno de los esquemas de la réplica, falla igual que si no hubiera BD', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { a } = app(async () => ({ rows: [{ ok: false }] }));
    const res = await request(a).get('/health');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'hub unreachable' });
  });

  it('si la BD falla, no deja salir el error del driver', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { a } = app(async () => { throw new Error('connect ECONNREFUSED ambientalia_project_zoho-hub-db:5432'); });
    const res = await request(a).get('/health');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'hub unreachable' });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it(`tiene su propio límite: pasadas ${HEALTH_MAX_POR_MINUTO} llamadas en un minuto responde 429 sin tocar la BD`, async () => {
    const { a, consultas } = app(sano);
    for (let i = 0; i < HEALTH_MAX_POR_MINUTO; i++) {
      expect((await request(a).get('/health')).status).toBe(200);
    }
    const res = await request(a).get('/health');
    expect(res.status).toBe(429);
    expect(consultas).toHaveLength(HEALTH_MAX_POR_MINUTO);
  });
});
