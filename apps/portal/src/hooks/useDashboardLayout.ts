import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Layout } from 'react-grid-layout';
import {
  isValidLayoutConfig,
  LAYOUT_SCHEMA_VERSION,
  type LayoutConfig,
  type LayoutItem,
  type WidgetDescriptor,
} from '../widgets/types';

// Gestiona el layout de widgets por usuario. El panel AUTO-PUEBLA con todos los
// widgets de las apps asignadas (los que devuelve el registry): cualquier widget
// disponible que no esté ya puesto y que el usuario no haya quitado se añade solo.
// Al quitar un widget se marca como "descartado" (no vuelve a auto-añadirse; se
// puede re-añadir desde el catálogo). Persistencia en localStorage por usuario.

const GRID_COLS = 12;
const PERSIST_DEBOUNCE_MS = 500;

export interface DashboardLayoutHook {
  layoutItems: LayoutItem[];
  anchoredWidgetIds: Set<string>;
  addWidget: (descriptor: WidgetDescriptor) => void;
  removeWidget: (widgetId: string) => void;
  onLayoutChange: (newLayout: Layout[]) => void;
  persistError: string | null;
}

function storageKey(userId: string): string {
  return `dashboard_layout_${userId}`;
}

/** Lee items + descartados del usuario; vacío si ausente/corrupto. */
function readLayout(userId: string): { items: LayoutItem[]; dismissed: Set<string> } {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { items: [], dismissed: new Set() };
    const parsed: unknown = JSON.parse(raw);
    if (!isValidLayoutConfig(parsed)) return { items: [], dismissed: new Set() };
    const items = parsed.widgets.filter(
      (it): it is LayoutItem =>
        !!it &&
        typeof (it as LayoutItem).widgetId === 'string' &&
        typeof (it as LayoutItem).x === 'number' &&
        typeof (it as LayoutItem).y === 'number' &&
        typeof (it as LayoutItem).w === 'number' &&
        typeof (it as LayoutItem).h === 'number',
    );
    const dismissed = new Set(
      Array.isArray(parsed.dismissed) ? parsed.dismissed.filter((d): d is string => typeof d === 'string') : [],
    );
    return { items, dismissed };
  } catch {
    return { items: [], dismissed: new Set() };
  }
}

/** Persiste layout + descartados; devuelve true si tuvo éxito. */
function writeLayout(userId: string, items: LayoutItem[], dismissed: Set<string>): boolean {
  const config: LayoutConfig = { version: LAYOUT_SCHEMA_VERSION, widgets: items, dismissed: [...dismissed] };
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
  availableWidgets: WidgetDescriptor[] | null,
): DashboardLayoutHook {
  const initial = userId ? readLayout(userId) : { items: [], dismissed: new Set<string>() };
  const [items, setItems] = useState<LayoutItem[]>(initial.items);
  const [dismissed, setDismissed] = useState<Set<string>>(initial.dismissed);
  const [persistError, setPersistError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs para leer el valor actual dentro de efectos/callbacks sin re-crearlos.
  const dismissedRef = useRef(dismissed);
  dismissedRef.current = dismissed;
  const availRef = useRef(availableWidgets);
  availRef.current = availableWidgets;

  // Re-lee cuando cambia el usuario (login/logout).
  useEffect(() => {
    const next = userId ? readLayout(userId) : { items: [], dismissed: new Set<string>() };
    setItems(next.items);
    setDismissed(next.dismissed);
  }, [userId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Clave estable del conjunto disponible: dispara la reconciliación/auto-poblado
  // solo cuando cambia el CONTENIDO (no la referencia del array).
  const availableKey = availableWidgets ? availableWidgets.map((w) => w.id).sort().join(',') : null;

  // Reconciliación + auto-poblado (cuando el registry ya resolvió):
  //  1. quita items cuyo widget ya no está disponible (app desasignada / borrada).
  //  2. añade los widgets disponibles que no están puestos ni descartados.
  useEffect(() => {
    if (availableKey === null || !userId) return;
    const avail = availRef.current ?? [];
    const availIds = new Set(avail.map((w) => w.id));
    setItems((prev) => {
      let next = prev.filter((it) => availIds.has(it.widgetId));
      const placed = new Set(next.map((it) => it.widgetId));
      const toAdd = avail.filter((w) => !placed.has(w.id) && !dismissedRef.current.has(w.id));
      for (const w of toAdd) {
        const { w: cw, h } = w.defaultSize;
        const { x, y } = firstFreeSlot(next, cw, h);
        next = [...next, { widgetId: w.id, x, y, w: Math.min(cw, GRID_COLS), h }];
      }
      const changed = next.length !== prev.length;
      if (!changed) return prev;
      writeLayout(userId, next, dismissedRef.current);
      return next;
    });
  }, [availableKey, userId]);

  const schedulePersist = useCallback(
    (next: LayoutItem[]) => {
      if (!userId) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const ok = writeLayout(userId, next, dismissedRef.current);
        setPersistError(ok ? null : 'Los cambios de posición no pudieron guardarse.');
      }, PERSIST_DEBOUNCE_MS);
    },
    [userId],
  );

  // Añadir desde el catálogo: quita el widget de "descartados" si estaba.
  const addWidget = useCallback(
    (descriptor: WidgetDescriptor) => {
      if (!userId) return;
      let nextDismissed = dismissedRef.current;
      if (nextDismissed.has(descriptor.id)) {
        nextDismissed = new Set(nextDismissed);
        nextDismissed.delete(descriptor.id);
        setDismissed(nextDismissed);
      }
      setItems((prev) => {
        if (prev.some((it) => it.widgetId === descriptor.id)) return prev;
        const { w, h } = descriptor.defaultSize;
        const { x, y } = firstFreeSlot(prev, w, h);
        const next = [...prev, { widgetId: descriptor.id, x, y, w: Math.min(w, GRID_COLS), h }];
        const ok = writeLayout(userId, next, nextDismissed);
        setPersistError(ok ? null : 'Los cambios no pudieron guardarse.');
        return next;
      });
    },
    [userId],
  );

  // Quitar: lo saca del grid y lo marca como descartado (no vuelve a auto-añadirse).
  const removeWidget = useCallback(
    (widgetId: string) => {
      if (!userId) return;
      const nextDismissed = new Set(dismissedRef.current);
      nextDismissed.add(widgetId);
      setDismissed(nextDismissed);
      setItems((prev) => {
        const next = prev.filter((it) => it.widgetId !== widgetId);
        if (next.length === prev.length) return prev;
        const ok = writeLayout(userId, next, nextDismissed);
        if (!ok) {
          setPersistError('No se pudo eliminar el widget. Se ha revertido el cambio.');
          return prev;
        }
        return next;
      });
    },
    [userId],
  );

  const onLayoutChange = useCallback(
    (newLayout: Layout[]) => {
      setItems((prev) => {
        const byId = new Map(prev.map((it) => [it.widgetId, it]));
        const next = newLayout
          .filter((l) => byId.has(l.i))
          .map((l) => ({ widgetId: l.i, x: l.x, y: l.y, w: l.w, h: l.h }));
        if (
          next.length === prev.length &&
          next.every((n, i) => {
            const p = prev[i];
            return p && n.widgetId === p.widgetId && n.x === p.x && n.y === p.y && n.w === p.w && n.h === p.h;
          })
        ) {
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
