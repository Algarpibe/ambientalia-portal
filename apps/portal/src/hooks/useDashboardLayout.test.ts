// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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

beforeEach(() => localStorage.clear());

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
