import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { requireCronToken } from './auth.js';

function res(): Response {
  const r: Partial<Response> = {};
  r.status = vi.fn().mockReturnValue(r as Response);
  r.json = vi.fn().mockReturnValue(r as Response);
  return r as Response;
}
function reqCon(token?: string): Request {
  return { header: (h: string) => (h === 'X-WO-Sales-Cron-Token' ? token : undefined) } as unknown as Request;
}
function reqConCabecera(cabecera: string, token?: string): Request {
  return { header: (h: string) => (h === cabecera ? token : undefined) } as unknown as Request;
}

describe('requireCronToken', () => {
  beforeEach(() => { process.env.WO_SALES_CRON_TOKEN = 'secreto-123'; });
  afterEach(() => { delete process.env.WO_SALES_CRON_TOKEN; });

  it('deja pasar si la cabecera coincide con el secreto', () => {
    const next = vi.fn();
    requireCronToken(reqCon('secreto-123'), res(), next);
    expect(next).toHaveBeenCalled();
  });

  it('401 si la cabecera no coincide', () => {
    const r = res();
    const next = vi.fn();
    requireCronToken(reqCon('otro'), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('401 si falta la cabecera', () => {
    const r = res();
    const next = vi.fn();
    requireCronToken(reqCon(undefined), r, next);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('401 (fail-closed) si el secreto no está configurado en el entorno', () => {
    delete process.env.WO_SALES_CRON_TOKEN;
    const r = res();
    const next = vi.fn();
    requireCronToken(reqCon('lo-que-sea'), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(401);
  });
});

// Segunda firma: fábrica parametrizada, para automatizaciones distintas de
// WO-sales (la app de ausencias usa su propio token y su propia cabecera).
describe('requireCronToken({ env, header })', () => {
  const OPTS = { env: 'AUSENCIAS_CRON_TOKEN', header: 'X-Ausencias-Cron-Token' };

  beforeEach(() => {
    process.env.AUSENCIAS_CRON_TOKEN = 'ausencias-abc';
    process.env.WO_SALES_CRON_TOKEN = 'secreto-123';
  });
  afterEach(() => {
    delete process.env.AUSENCIAS_CRON_TOKEN;
    delete process.env.WO_SALES_CRON_TOKEN;
  });

  it('deja pasar con su propia cabecera y su propio secreto', () => {
    const next = vi.fn();
    requireCronToken(OPTS)(reqConCabecera('X-Ausencias-Cron-Token', 'ausencias-abc'), res(), next);
    expect(next).toHaveBeenCalled();
  });

  it('no acepta el token de WO-sales: los secretos no son intercambiables', () => {
    const r = res();
    const next = vi.fn();
    requireCronToken(OPTS)(reqConCabecera('X-Ausencias-Cron-Token', 'secreto-123'), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('no acepta la cabecera de WO-sales aunque el valor sea correcto', () => {
    const r = res();
    const next = vi.fn();
    requireCronToken(OPTS)(reqConCabecera('X-WO-Sales-Cron-Token', 'ausencias-abc'), r, next);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('401 (fail-closed) si su secreto no está configurado', () => {
    delete process.env.AUSENCIAS_CRON_TOKEN;
    const r = res();
    const next = vi.fn();
    requireCronToken(OPTS)(reqConCabecera('X-Ausencias-Cron-Token', 'lo-que-sea'), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(401);
  });
});
