import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireApp, userHasApp } from './auth.js';
import type { JwtPayload } from './users/users.types.js';

function usuario(p: Partial<JwtPayload>): JwtPayload {
  return p as JwtPayload;
}

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

// userHasApp es la regla que requireApp aplica; se prueba aparte porque otros gates (p. ej.
// veAnticipos en contabilidad) la llaman directamente, sin pasar por el middleware.
describe('userHasApp', () => {
  it('deja pasar siempre al admin, tenga o no la app', () => {
    expect(userHasApp(usuario({ apps: [], role: 'admin' }), 'WO-sales')).toBe(true);
  });

  it('true si el usuario tiene la app pedida', () => {
    expect(userHasApp(usuario({ apps: ['contabilidad'], role: 'reader' }), 'contabilidad')).toBe(true);
  });

  it('true si tiene al menos una de varias apps pedidas', () => {
    expect(userHasApp(usuario({ apps: ['ov-pendientes'], role: 'reader' }), 'contabilidad', 'ov-pendientes')).toBe(true);
  });

  it('false si no tiene ninguna de las apps pedidas', () => {
    expect(userHasApp(usuario({ apps: ['product-sales'], role: 'reader' }), 'contabilidad')).toBe(false);
  });

  it('false si el usuario es null', () => {
    expect(userHasApp(null, 'contabilidad')).toBe(false);
  });
});
