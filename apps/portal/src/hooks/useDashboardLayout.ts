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
// localStorage y packing al añadir. La disponibilidad de widgets solo FILTRA lo
// que se muestra (`layoutItems`); el layout guardado es la fuente de verdad y
// nunca se poda por el registro (evita la pérdida de datos que causaba borrar de
// localStorage los widgets cuando el registro resolvía vacío tras un redeploy).
// Ver design.md, Propiedades 4, 6, 7, 9, 10.

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

  // Vista visible (Req 5.3): oculta los items cuyo widget no está disponible AHORA.
  // Es SOLO para mostrar — `items` (el layout guardado) queda intacto en
  // localStorage. Así un registro transitoriamente vacío (p. ej. los chunks de
  // widgets que fallan al cargar tras un redeploy → registro `ready` con lista
  // vacía) oculta los widgets esa sesión pero NUNCA los borra; al recuperarse el
  // registro reaparecen sin recargar. Antes se persistía el layout podado y la
  // pérdida era permanente.
  const visibleItems = useMemo(
    () => (availableIds ? items.filter((it) => availableIds.has(it.widgetId)) : items),
    [items, availableIds],
  );

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
        // react-grid-layout solo reporta los items RENDERIZADOS (los visibles).
        // Fusionamos sus posiciones sobre el layout COMPLETO para no perder los
        // items ocultos (widgets guardados cuya app no está disponible ahora).
        const pos = new Map(newLayout.map((l) => [l.i, l]));
        let changed = false;
        const next = prev.map((it) => {
          const l = pos.get(it.widgetId);
          if (!l) return it; // oculto: se conserva sin cambios
          if (l.x === it.x && l.y === it.y && l.w === it.w && l.h === it.h) return it;
          changed = true;
          return { widgetId: it.widgetId, x: l.x, y: l.y, w: l.w, h: l.h };
        });
        if (!changed) return prev; // callback espurio: nada que persistir
        schedulePersist(next);
        return next;
      });
    },
    [schedulePersist],
  );

  // Basado en los visibles: alimenta el estado vacío (hasWidgets) y el filtro del
  // catálogo. Un widget guardado pero oculto no aparece en el catálogo porque su
  // app no está en el registro; addWidget además deduplica por id.
  const anchoredWidgetIds = useMemo(() => new Set(visibleItems.map((it) => it.widgetId)), [visibleItems]);

  return { layoutItems: visibleItems, anchoredWidgetIds, addWidget, removeWidget, onLayoutChange, persistError };
}
