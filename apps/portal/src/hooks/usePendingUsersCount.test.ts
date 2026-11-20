// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { authFetch } from '../lib/api';
import {
  usePendingUsersCount,
  notifyPendingUsersChanged,
  PENDING_USERS_CHANGED,
  PENDING_POLL_MS,
  PENDING_MIN_GAP_MS,
} from './usePendingUsersCount';

vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));
const mockFetch = authFetch as unknown as ReturnType<typeof vi.fn>;

const responde = (pending: unknown) => ({ ok: true, status: 200, json: async () => ({ pending }) });

// jsdom no deja cambiar la visibilidad de la pestaña: se tapa el getter del
// prototipo con una propiedad propia, que se borra al terminar cada test.
let visibilidad: DocumentVisibilityState = 'visible';
function ponerVisibilidad(v: DocumentVisibilityState): void {
  visibilidad = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

// Las respuestas simuladas se resuelven en microtareas; un setTimeout REAL (no
// está entre los temporizadores falsos) garantiza que ya terminaron.
const asentar = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  // Solo el intervalo y el reloj: setTimeout sigue siendo real para `asentar`.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  visibilidad = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilidad });
  mockFetch.mockResolvedValue(responde(2));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (document as unknown as { visibilityState?: DocumentVisibilityState }).visibilityState;
  vi.clearAllMocks();
});

describe('usePendingUsersCount', () => {
  it('con enabled falso no consulta nunca y devuelve 0', () => {
    const { result } = renderHook(() => usePendingUsersCount(false));
    vi.advanceTimersByTime(PENDING_POLL_MS);
    window.dispatchEvent(new Event(PENDING_USERS_CHANGED));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current).toBe(0);
  });

  it('al montar consulta la ruta y devuelve el número', async () => {
    const { result } = renderHook(() => usePendingUsersCount(true));
    expect(mockFetch).toHaveBeenCalledWith('/api/users/pending-count');
    await asentar();
    expect(result.current).toBe(2);
  });

  it('cada 5 minutos vuelve a contar si la pestaña está visible', async () => {
    const { result } = renderHook(() => usePendingUsersCount(true));
    await asentar();
    mockFetch.mockResolvedValue(responde(3));
    vi.advanceTimersByTime(PENDING_POLL_MS);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await asentar();
    expect(result.current).toBe(3);
  });

  it('con la pestaña oculta el intervalo no consulta', async () => {
    renderHook(() => usePendingUsersCount(true));
    await asentar();
    ponerVisibilidad('hidden');
    vi.advanceTimersByTime(PENDING_POLL_MS);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('al volver a la pestaña consulta, salvo que la última consulta tenga menos de 30 s', async () => {
    const { result } = renderHook(() => usePendingUsersCount(true));
    await asentar();

    ponerVisibilidad('hidden');
    vi.advanceTimersByTime(PENDING_MIN_GAP_MS - 1_000);
    ponerVisibilidad('visible');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    ponerVisibilidad('hidden');
    vi.advanceTimersByTime(1_000);
    mockFetch.mockResolvedValue(responde(4));
    ponerVisibilidad('visible');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await asentar();
    expect(result.current).toBe(4);
  });

  it('el aviso del panel consulta siempre, aunque la última consulta sea reciente', async () => {
    const { result } = renderHook(() => usePendingUsersCount(true));
    await asentar();
    mockFetch.mockResolvedValue(responde(0));
    act(() => notifyPendingUsersChanged());
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await asentar();
    expect(result.current).toBe(0);
  });

  it('un 429, un fallo de red o un cuerpo sin número conservan el último valor bueno', async () => {
    const { result } = renderHook(() => usePendingUsersCount(true));
    await asentar();
    expect(result.current).toBe(2);

    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    mockFetch.mockRejectedValueOnce(new Error('red caida'));
    mockFetch.mockResolvedValueOnce(responde('muchos'));
    act(() => notifyPendingUsersChanged());
    act(() => notifyPendingUsersChanged());
    act(() => notifyPendingUsersChanged());
    expect(mockFetch).toHaveBeenCalledTimes(4);
    await asentar();
    expect(result.current).toBe(2);
  });

  it('al desmontar deja de consultar', async () => {
    const { unmount } = renderHook(() => usePendingUsersCount(true));
    await asentar();
    unmount();
    notifyPendingUsersChanged();
    vi.advanceTimersByTime(PENDING_POLL_MS);
    ponerVisibilidad('hidden');
    ponerVisibilidad('visible');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
