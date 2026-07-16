import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireApp } from './auth.js';

function res(): Response {
  const r: Partial<Response> = {};
  r.status = vi.fn().mockReturnValue(r as Response);
  r.json = vi.fn().mockReturnValue(r as Response);
  return r as Response;
}

describe('requireApp', () => {
  it('deja pasar si el JWT tiene la app asignada', () => {
    const req = { user: { apps: ['WO-sales', 'product-sales'], role: 'reader' } } as unknown as Request;
    const next = vi.fn();
    requireApp('WO-sales')(req, res(), next);
    expect(next).toHaveBeenCalled();
  });

  it('responde 403 si el JWT no tiene la app', () => {
    const req = { user: { apps: ['product-sales'], role: 'reader' } } as unknown as Request;
    const r = res();
    const next = vi.fn();
    requireApp('WO-sales')(req, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(403);
  });

  it('deja pasar siempre al admin', () => {
    const req = { user: { apps: [], role: 'admin' } } as unknown as Request;
    const next = vi.fn();
    requireApp('WO-sales')(req, res(), next);
    expect(next).toHaveBeenCalled();
  });

  it('responde 403 si no hay usuario en la petición', () => {
    const r = res();
    const next = vi.fn();
    requireApp('WO-sales')({} as Request, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(403);
  });

  it('responde 403 si el JWT no trae apps', () => {
    const req = { user: { role: 'reader' } } as unknown as Request;
    const r = res();
    const next = vi.fn();
    requireApp('WO-sales')(req, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(403);
  });
});
