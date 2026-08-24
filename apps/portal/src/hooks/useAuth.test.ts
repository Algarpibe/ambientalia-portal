// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { getToken } from '../auth';
import { authFetch } from '../lib/api';

// Se mockean las dos puertas de fuera —el token y la red— y NO se toca
// localStorage: bajo Node 26 jsdom no lo provee en este repo, y un test que
// dependiera de él fallaría por el entorno y no por la regla que vigila.
vi.mock('../auth', () => ({ getToken: vi.fn() }));
vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));

const mockToken = getToken as unknown as ReturnType<typeof vi.fn>;
const mockFetch = authFetch as unknown as ReturnType<typeof vi.fn>;

function tokenCon(payload: Record<string, unknown>): string {
  return `cabecera.${btoa(JSON.stringify(payload))}.firma`;
}

const dentroDeUnaHora = () => Math.floor(Date.now() / 1000) + 3600;

/**
 * El hook se importa en CADA test y detrás de `vi.resetModules()`.
 *
 * La cache de apps vive a nivel de módulo a propósito (una sola petición para
 * las siete pantallas), así que un import estático la compartiría entre tests: el
 * segundo empezaría con lo que dejó el primero y pasaría o fallaría según el
 * orden.
 */
async function cargarUseAuth() {
  const modulo = await import('./useAuth');
  return modulo.useAuth;
}

/**
 * Deja que la respuesta del servidor se procese ENTERA antes de mirar.
 *
 * Un `waitFor(() => expect(mockFetch).toHaveBeenCalled())` no sirve, y esto no es
 * teoría: la primera versión de estos tests lo usaba y dejó pasar una mutación
 * que borraba la comprobación de identidad del perfil. `authFetch` se llama de
 * forma síncrona dentro del efecto, así que esa espera se cumple de inmediato —
 * antes del `await res.json()` y antes de que la cache avise a los suscriptores.
 * Las aserciones en negativo pasaban por llegar temprano, no por ser ciertas.
 *
 * Un `setTimeout(0)` es un macrotask: vacía toda la cola de microtasks pendientes
 * primero. Que los tests en POSITIVO usen esta misma espera es lo que demuestra
 * que basta — si se quedara corta, serían ellos los que fallarían.
 */
async function dejarQueRespondaElServidor() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  vi.resetModules();
  mockToken.mockReturnValue(
    tokenCon({ sub: 'a@x.com', user_id: 'u1', role: 'reader', apps: ['ausencias'], exp: dentroDeUnaHora() }),
  );
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'u1', apps: ['ausencias', 'wo-sales'] }) });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useAuth — las apps salen de la BD, no de un token congelado', () => {
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
    mockToken.mockReturnValue(null);
    const useAuth = await cargarUseAuth();
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.apps).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
