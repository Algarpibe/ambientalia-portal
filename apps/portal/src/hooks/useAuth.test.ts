// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// Tests de la lógica de decodificación de sesión (task 12.2). Se prueba
// readAuthState(), que concentra el parseo del JWT; useAuth() es un envoltorio
// reactivo de esta función. Se mockea getToken para no depender de localStorage.
//
// El segundo bloque, más abajo, cubre lo que useAuth() añade por su cuenta: las
// apps dejaron de salir del token y se leen de la BD.

const h = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('../auth', () => ({ getToken: () => h.token }));
// La red, mockeada: `useAuth` pregunta por `/api/users/me` al montarse.
vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));

import { readAuthState } from './useAuth';
import { authFetch } from '../lib/api';

const mockFetch = authFetch as unknown as ReturnType<typeof vi.fn>;

/** Construye un JWT de prueba (header.payload.sig) con el payload dado. */
function makeToken(payload: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(payload));
  return `header.${body}.sig`;
}
const futureExp = () => Math.floor(Date.now() / 1000) + 3600;
const pastExp = () => Math.floor(Date.now() / 1000) - 60;

beforeEach(() => {
  h.token = null;
});

describe('readAuthState', () => {
  it('parsea un JWT válido con todos los campos', () => {
    h.token = makeToken({
      sub: 'user@x.com',
      user_id: 'uuid-1',
      role: 'admin',
      apps: ['customer-profitability', 'inventory'],
      exp: futureExp(),
    });
    expect(readAuthState()).toEqual({
      isAuthenticated: true,
      user_id: 'uuid-1',
      email: 'user@x.com',
      role: 'admin',
      apps: ['customer-profitability', 'inventory'],
    });
  });

  it('sin token → estado vacío', () => {
    h.token = null;
    expect(readAuthState()).toEqual({ isAuthenticated: false, user_id: null, email: null, role: null, apps: [] });
  });

  it('token expirado → estado vacío', () => {
    h.token = makeToken({ sub: 'u@x.com', user_id: 'i', role: 'reader', apps: [], exp: pastExp() });
    expect(readAuthState().isAuthenticated).toBe(false);
  });

  it('token malformado → estado vacío (no lanza)', () => {
    h.token = 'esto-no-es-un-jwt';
    expect(readAuthState()).toEqual({ isAuthenticated: false, user_id: null, email: null, role: null, apps: [] });
  });

  it('sin exp → estado vacío (coherente con isAuthenticated)', () => {
    h.token = makeToken({ sub: 'u@x.com', user_id: 'i', role: 'reader', apps: [] });
    expect(readAuthState().isAuthenticated).toBe(false);
  });

  it('rol desconocido → role null pero autenticado', () => {
    h.token = makeToken({ sub: 'u@x.com', user_id: 'i', role: 'superadmin', apps: [], exp: futureExp() });
    const s = readAuthState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.role).toBeNull();
  });

  it('token legacy (solo sub) → autenticado con user_id/role nulos y apps []', () => {
    h.token = makeToken({ sub: 'legacy@x.com', exp: futureExp() });
    expect(readAuthState()).toEqual({
      isAuthenticated: true,
      user_id: null,
      email: 'legacy@x.com',
      role: null,
      apps: [],
    });
  });

  describe('apps malformado → []', () => {
    for (const [label, apps] of [
      ['null', null],
      ['undefined', undefined],
      ['número', 42],
      ['objeto', { a: 1 }],
      ['string', 'customer-profitability'],
      ['array con no-strings', ['ok', 3, null, { x: 1 }]],
    ] as const) {
      it(label, () => {
        h.token = makeToken({ sub: 'u@x.com', user_id: 'i', role: 'reader', apps, exp: futureExp() });
        const result = readAuthState().apps;
        // Solo se conservan strings; el resto → descartado.
        expect(result.every((a) => typeof a === 'string')).toBe(true);
        if (label === 'array con no-strings') expect(result).toEqual(['ok']);
        else expect(result).toEqual([]);
      });
    }
  });
});

/**
 * El hook se importa en CADA test y detrás de `vi.resetModules()`.
 *
 * La cache de apps vive a nivel de módulo a propósito (una sola petición para
 * las siete pantallas que usan el hook), así que un import estático la
 * compartiría entre tests: el segundo empezaría con lo que dejó el primero y
 * pasaría o fallaría según el orden.
 */
async function cargarUseAuth() {
  const modulo = await import('./useAuth');
  return modulo.useAuth;
}

/**
 * Deja que la respuesta del servidor se procese ENTERA antes de mirar.
 *
 * Un `waitFor(() => expect(mockFetch).toHaveBeenCalled())` no sirve, y no es
 * teoría: la primera versión de estos tests lo usaba y dejó pasar una mutación
 * que borraba la comprobación de identidad del perfil. `authFetch` se llama de
 * forma síncrona dentro del efecto, así que esa espera se cumple de inmediato —
 * antes del `await res.json()` y antes de que la cache avise a los suscriptores.
 * Las aserciones en negativo pasaban por llegar temprano, no por ser ciertas.
 *
 * Un `setTimeout(0)` es un macrotask: vacía toda la cola de microtasks primero.
 * Que los tests en POSITIVO usen esta misma espera es lo que demuestra que
 * basta — si se quedara corta, serían ellos los que fallarían.
 */
async function dejarQueRespondaElServidor() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('useAuth — las apps salen de la BD, no de un token congelado', () => {
  beforeEach(() => {
    vi.resetModules();
    h.token = makeToken({
      sub: 'a@x.com',
      user_id: 'u1',
      role: 'reader',
      apps: ['ausencias'],
      exp: futureExp(),
    });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'u1', apps: ['ausencias', 'wo-sales'] }) });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('pinta con las del token sin esperar al servidor', async () => {
    const useAuth = await cargarUseAuth();
    const { result } = renderHook(() => useAuth());
    // Todavía no ha resuelto el fetch: si esto fuera una pantalla de carga, el
    // guardia de ruta enseñaría «no tienes acceso» durante el viaje.
    expect(result.current.apps).toEqual(['ausencias']);
  });

  it('sustituye por las de la BD en cuanto llegan', async () => {
    const useAuth = await cargarUseAuth();
    const { result } = renderHook(() => useAuth());
    await dejarQueRespondaElServidor();
    expect(result.current.apps).toEqual(['ausencias', 'wo-sales']);
  });

  it('una app RETIRADA en la BD desaparece aunque el token siga trayéndola', async () => {
    // La otra mitad del fallo: hasta ahora, quitar una app tampoco surtía efecto
    // en el navegador hasta que caducara el token.
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'u1', apps: [] }) });
    const useAuth = await cargarUseAuth();
    const { result } = renderHook(() => useAuth());
    await dejarQueRespondaElServidor();
    expect(result.current.apps).toEqual([]);
  });

  it('ignora un perfil que no es de quien preguntó', async () => {
    // Entre la petición y la respuesta ha podido cambiar la sesión. Escribir la
    // cache con el id ajeno le daría al recién llegado las apps del anterior.
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'OTRO', apps: ['contabilidad'] }) });
    const useAuth = await cargarUseAuth();
    const { result } = renderHook(() => useAuth());
    await dejarQueRespondaElServidor();
    expect(result.current.apps).toEqual(['ausencias']);
  });

  it('se queda con las del token si hub-api todavía no manda apps', async () => {
    // Los dos servicios se despliegan por separado: hay una ventana en la que el
    // portal va por delante y `/users/me` contesta sin la clave.
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'u1' }) });
    const useAuth = await cargarUseAuth();
    const { result } = renderHook(() => useAuth());
    await dejarQueRespondaElServidor();
    expect(result.current.apps).toEqual(['ausencias']);
  });

  it('se queda con las del token si la petición falla', async () => {
    mockFetch.mockRejectedValue(new Error('sin red'));
    const useAuth = await cargarUseAuth();
    const { result } = renderHook(() => useAuth());
    await dejarQueRespondaElServidor();
    expect(result.current.apps).toEqual(['ausencias']);
  });

  it('pide UNA vez aunque monten varias pantallas a la vez', async () => {
    const useAuth = await cargarUseAuth();
    renderHook(() => useAuth());
    renderHook(() => useAuth());
    renderHook(() => useAuth());
    await dejarQueRespondaElServidor();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('no pregunta por las apps de quien no ha entrado', async () => {
    h.token = null;
    const useAuth = await cargarUseAuth();
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.apps).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
