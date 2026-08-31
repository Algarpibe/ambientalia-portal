// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDashboardLayout } from './useDashboardLayout';
import { LAYOUT_SCHEMA_VERSION, type LayoutItem } from '../widgets/types';

// Regresión del bug de pérdida de datos: la reconciliación NO debe borrar de
// localStorage los widgets cuando el registro resuelve vacío/parcial (p. ej. tras
// un redeploy, cuando los chunks de widgets fallan al cargar). El layout guardado
// es la fuente de verdad; la disponibilidad solo filtra lo que se MUESTRA.

const USER = 'user-1';
const KEY = `dashboard_layout_${USER}`;
const w1: LayoutItem = { widgetId: 'w1', x: 0, y: 0, w: 4, h: 2 };
const w2: LayoutItem = { widgetId: 'w2', x: 4, y: 0, w: 4, h: 2 };

function seed(widgets: LayoutItem[]) {
  localStorage.setItem(KEY, JSON.stringify({ version: LAYOUT_SCHEMA_VERSION, widgets }));
}
function stored(): LayoutItem[] {
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as { widgets: LayoutItem[] }).widgets : [];
}

// El panel vive ahora en el servidor y localStorage es su caché. Por defecto se
// simula SIN red, que es el escenario que ejercen los tests de abajo: la caché
// local tiene que bastar para que el portal siga funcionando.
const authFetchMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ authFetch: authFetchMock }));

/** Respuesta OK de GET /me/preferences con el blob indicado. */
const conPreferencias = (preferences: Record<string, unknown>) => ({
  ok: true,
  json: async () => ({ preferences }),
});
const panel = (widgets: LayoutItem[]) => ({ version: LAYOUT_SCHEMA_VERSION, widgets });

// Solo la clave de este hook, no `clear()`: arrasar el almacén entero pisa el de
// otras suites cuando comparten backend (p. ej. bajo --localstorage-file).
beforeEach(() => {
  localStorage.removeItem(KEY);
  authFetchMock.mockReset();
  authFetchMock.mockRejectedValue(new Error('sin red'));
});

describe('useDashboardLayout — no destruye el layout guardado', () => {
  it('registro transitoriamente vacío (availableIds=∅) NO borra localStorage', () => {
    seed([w1]);
    const { result } = renderHook(
      ({ ids }: { ids: Set<string> | null }) => useDashboardLayout(USER, ids),
      { initialProps: { ids: new Set<string>() } },
    );
    // Oculto en pantalla (no disponible)...
    expect(result.current.layoutItems).toEqual([]);
    // ...pero el guardado sigue intacto (antes se sobrescribía a []).
    expect(stored()).toEqual([w1]);
  });

  it('al recuperarse el registro, los widgets reaparecen sin recargar', () => {
    seed([w1]);
    const { result, rerender } = renderHook(
      ({ ids }: { ids: Set<string> | null }) => useDashboardLayout(USER, ids),
      { initialProps: { ids: new Set<string>() } },
    );
    expect(result.current.layoutItems).toEqual([]);
    rerender({ ids: new Set(['w1']) });
    expect(result.current.layoutItems).toEqual([w1]);
    expect(stored()).toEqual([w1]);
  });

  it('filtra para mostrar solo los disponibles, sin tocar el guardado', () => {
    seed([w1, w2]);
    const { result } = renderHook(() => useDashboardLayout(USER, new Set(['w1'])));
    expect(result.current.layoutItems.map((i) => i.widgetId)).toEqual(['w1']);
    expect(stored()).toEqual([w1, w2]); // ambos siguen guardados
  });

  it('onLayoutChange conserva los items ocultos al persistir', () => {
    vi.useFakeTimers();
    try {
      seed([w1, w2]); // w1 oculto (no disponible), w2 visible
      const { result } = renderHook(() => useDashboardLayout(USER, new Set(['w2'])));
      act(() => {
        result.current.onLayoutChange([{ i: 'w2', x: 8, y: 3, w: 4, h: 2 }]);
      });
      act(() => {
        vi.advanceTimersByTime(600); // supera el debounce de persistencia
      });
      const s = stored();
      // Debe persistir AMBOS: w1 intacto + w2 con la nueva posición.
      expect(s).toContainEqual(w1);
      expect(s).toContainEqual({ widgetId: 'w2', x: 8, y: 3, w: 4, h: 2 });
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => vi.useRealTimers());

// El panel se guarda en el servidor (users.preferences.dashboard_layout) para que
// te siga entre dispositivos. Antes vivía SOLO en localStorage, que es por
// navegador: lo que anclabas en el PC no existía en el móvil y parecía que los
// widgets «no se veían».
describe('useDashboardLayout — sincronización entre dispositivos', () => {
  const montar = () =>
    renderHook(({ ids }: { ids: Set<string> | null }) => useDashboardLayout(USER, ids), {
      initialProps: { ids: null as Set<string> | null },
    });

  it('el panel del servidor gana sobre la caché local: el móvil ve lo del PC', async () => {
    seed([w1]); // este navegador solo conocía w1
    authFetchMock.mockResolvedValue(conPreferencias({ dashboard_layout: panel([w1, w2]) }));
    const { result } = montar();
    // Arranca con la caché, sin parpadeo...
    expect(result.current.layoutItems).toEqual([w1]);
    // ...y se reconcilia con lo que hay en la cuenta.
    await waitFor(() => expect(result.current.layoutItems).toEqual([w1, w2]));
    expect(stored()).toEqual([w1, w2]); // la caché queda refrescada
  });

  it('un panel VACÍO en el servidor sí se adopta: lo vaciaron en otro dispositivo', async () => {
    seed([w1]);
    authFetchMock.mockResolvedValue(conPreferencias({ dashboard_layout: panel([]) }));
    const { result } = montar();
    await waitFor(() => expect(result.current.layoutItems).toEqual([]));
  });

  it('servidor sin panel todavía: sube la caché local en vez de perderla', async () => {
    seed([w1]);
    authFetchMock.mockResolvedValue(conPreferencias({}));
    montar();
    await waitFor(() => {
      const patch = authFetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(patch![1].body).dashboard_layout.widgets).toEqual([w1]);
    });
  });

  it('sin red NO sube nada: subir a ciegas pisaría un panel más reciente de otro equipo', async () => {
    seed([w1]);
    // authFetchMock ya rechaza por defecto.
    const { result } = montar();
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled());
    expect(authFetchMock.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(false);
    // Y el portal sigue usable con la caché.
    expect(result.current.layoutItems).toEqual([w1]);
    expect(stored()).toEqual([w1]);
  });

  it('una respuesta tardía no pisa el widget que el usuario acaba de añadir', async () => {
    seed([]);
    let resolver: (v: unknown) => void = () => {};
    authFetchMock.mockReturnValue(new Promise((r) => { resolver = r; }));
    const { result } = montar();

    // El usuario ancla un widget mientras el GET sigue en vuelo.
    act(() => {
      result.current.addWidget({
        id: 'w9', name: 'W9', description: '', appId: 'x',
        defaultSize: { w: 4, h: 2 }, component: (() => null) as never,
      });
    });
    expect(result.current.layoutItems.map((i) => i.widgetId)).toEqual(['w9']);

    // Ahora llega la respuesta, con un panel distinto y ya obsoleto.
    await act(async () => {
      resolver(conPreferencias({ dashboard_layout: panel([w1]) }));
    });
    expect(result.current.layoutItems.map((i) => i.widgetId)).toEqual(['w9']);
  });
});
