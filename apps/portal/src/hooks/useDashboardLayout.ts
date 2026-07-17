import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Layout } from 'react-grid-layout';
import {
  isValidLayoutConfig,
  LAYOUT_SCHEMA_VERSION,
  type LayoutConfig,
  type LayoutItem,
  type WidgetDescriptor,
} from '../widgets/types';

// Gestiona el layout de widgets anclados por usuario: lectura/persistencia en
// localStorage, packing al añadir, y reconciliación cuando una app deja de estar
// disponible. Ver design.md, Propiedades 4, 6, 7, 9, 10.

const GRID_COLS = 12;
const PERSIST_DEBOUNCE_MS = 500;

export interface DashboardLayoutHook {
  /** Items del layout actualmente anclados. */
  layoutItems: LayoutItem[];
  /** IDs de widgets anclados (para filtrar el CatalogPanel). */
  anchoredWidgetIds: Set<string>;
  /** Añade un widget al grid en la primera posición libre disponible. */
  addWidget: (descriptor: WidgetDescriptor) => void;
  /** Elimina un widget del grid. */
  removeWidget: (widgetId: string) => void;
  /** Callback para el evento onLayoutChange de react-grid-layout. */
  onLayoutChange: (newLayout: Layout[]) => void;
  /** Error de persistencia (null si no hay error). */
  persistError: string | null;
}

function storageKey(userId: string): string {
  return `dashboard_layout_${userId}`;
}

/** Lee y valida el LayoutConfig del usuario; vacío si ausente/corrupto. */
function readLayout(userId: string): LayoutItem[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isValidLayoutConfig(parsed)) return [];
    // Filtra items que no tengan la forma esperada (defensivo).
    return parsed.widgets.filter(
      (it): it is LayoutItem =>
        !!it &&
        typeof (it as LayoutItem).widgetId === 'string' &&
        typeof (it as LayoutItem).x === 'number' &&
        typeof (it as LayoutItem).y === 'number' &&
        typeof (it as LayoutItem).w === 'number' &&
        typeof (it as LayoutItem).h === 'number',
    );
  } catch {
    return [];
  }
}

/** Persiste el layout; devuelve true si tuvo éxito. */
function writeLayout(userId: string, items: LayoutItem[]): boolean {
  const config: LayoutConfig = { version: LAYOUT_SCHEMA_VERSION, widgets: items };
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

/** ¿Se solapan dos rectángulos del grid? */
function overlaps(a: LayoutItem, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Primera posición (x, y) libre para un widget de w×h en un grid de 12 columnas. */
export function firstFreeSlot(items: LayoutItem[], w: number, h: number): { x: number; y: number } {
  const width = Math.min(w, GRID_COLS);
  for (let y = 0; ; y++) {
    for (let x = 0; x <= GRID_COLS - width; x++) {
      const candidate = { x, y, w: width, h };
      if (!items.some((it) => overlaps(it, candidate))) return { x, y };
    }
  }
}

export function useDashboardLayout(
  userId: string | null,
  availableIds: Set<string> | null,
): DashboardLayoutHook {
  const [items, setItems] = useState<LayoutItem[]>(() => (userId ? readLayout(userId) : []));
  const [persistError, setPersistError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-lee cuando cambia el usuario (login/logout).
  useEffect(() => {
    setItems(userId ? readLayout(userId) : []);
  }, [userId]);

  // Persistencia con debounce para cambios frecuentes (mover/redimensionar).
  const schedulePersist = useCallback(
    (next: LayoutItem[]) => {
      if (!userId) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const ok = writeLayout(userId, next);
        setPersistError(ok ? null : 'Los cambios de posición no pudieron guardarse.');
      }, PERSIST_DEBOUNCE_MS);
    },
    [userId],
  );

  // Persistencia inmediata para cambios estructurales (añadir/eliminar).
  const persistNow = useCallback(
    (next: LayoutItem[]): boolean => {
      if (!userId) return false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const ok = writeLayout(userId, next);
      setPersistError(ok ? null : 'Los cambios no pudieron guardarse.');
      return ok;
    },
    [userId],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Reconciliación (Req 5.3): descarta items cuya app/ widget ya no está disponible.
  // Solo actúa cuando el registry ya resolvió (availableIds != null) para no borrar
  // items mientras aún carga.
  useEffect(() => {
    if (!availableIds) return;
    setItems((prev) => {
      const next = prev.filter((it) => availableIds.has(it.widgetId));
      if (next.length !== prev.length && userId) writeLayout(userId, next);
      return next.length === prev.length ? prev : next;
    });
  }, [availableIds, userId]);

  const addWidget = useCallback(
    (descriptor: WidgetDescriptor) => {
      setItems((prev) => {
        if (prev.some((it) => it.widgetId === descriptor.id)) return prev;
        const { w, h } = descriptor.defaultSize;
        const { x, y } = firstFreeSlot(prev, w, h);
        const next = [...prev, { widgetId: descriptor.id, x, y, w: Math.min(w, GRID_COLS), h }];
        persistNow(next);
        return next;
      });
    },
    [persistNow],
  );

  const removeWidget = useCallback(
    (widgetId: string) => {
      setItems((prev) => {
        const next = prev.filter((it) => it.widgetId !== widgetId);
        if (next.length === prev.length) return prev;
        const ok = persistNow(next);
        // Req 4.7: si no se pudo persistir la eliminación, revertir.
        if (!ok) {
          setPersistError('No se pudo eliminar el widget. Se ha revertido el cambio.');
          return prev;
        }
        return next;
      });
    },
    [persistNow],
  );

  const onLayoutChange = useCallback(
    (newLayout: Layout[]) => {
      setItems((prev) => {
        const byId = new Map(prev.map((it) => [it.widgetId, it]));
        const next = newLayout
          .filter((l) => byId.has(l.i))
          .map((l) => ({ widgetId: l.i, x: l.x, y: l.y, w: l.w, h: l.h }));
        // Ignora callbacks espurios de react-grid-layout que no cambian nada.
        if (next.length === prev.length && next.every((n, i) => {
          const p = prev[i];
          return p && n.widgetId === p.widgetId && n.x === p.x && n.y === p.y && n.w === p.w && n.h === p.h;
        })) {
          return prev;
        }
        schedulePersist(next);
        return next;
      });
    },
    [schedulePersist],
  );

  const anchoredWidgetIds = useMemo(() => new Set(items.map((it) => it.widgetId)), [items]);

  return { layoutItems: items, anchoredWidgetIds, addWidget, removeWidget, onLayoutChange, persistError };
}
