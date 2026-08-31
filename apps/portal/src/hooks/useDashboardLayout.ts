import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Layout } from 'react-grid-layout';
import { authFetch } from '../lib/api';
import {
  isValidLayoutConfig,
  LAYOUT_SCHEMA_VERSION,
  type LayoutConfig,
  type LayoutItem,
  type WidgetDescriptor,
} from '../widgets/types';

// Gestiona el layout de widgets anclados por usuario y el packing al añadir. La
// disponibilidad de widgets solo FILTRA lo que se muestra (`layoutItems`); el
// layout guardado es la fuente de verdad y nunca se poda por el registro (evita
// la pérdida de datos que causaba borrar los widgets cuando el registro resolvía
// vacío tras un redeploy). Ver design.md, Propiedades 4, 6, 7, 9, 10.
//
// DÓNDE VIVE EL PANEL. Dos sitios, con papeles distintos:
//
//   servidor (users.preferences.dashboard_layout) → fuente de verdad compartida
//   localStorage                                  → caché de este navegador
//
// Antes solo existía localStorage, que es por navegador y por dispositivo: el
// panel que montabas en el PC no aparecía en el móvil, y parecía que los widgets
// «no se veían» cuando en realidad ese navegador nunca tuvo ninguno.
//
// La caché no es un residuo: siembra el estado inicial de forma SÍNCRONA, así el
// panel se pinta al instante en vez de parpadear vacío mientras llega la
// respuesta del servidor. Y si no hay red, el portal sigue usable.

const GRID_COLS = 12;
const PERSIST_DEBOUNCE_MS = 500;

/** Clave dentro del blob `preferences` del usuario donde vive el panel. */
const CLAVE_PREF = 'dashboard_layout';

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

/** Descarta items que no tengan la forma esperada (defensivo). */
function sanearItems(widgets: LayoutItem[]): LayoutItem[] {
  return widgets.filter(
    (it): it is LayoutItem =>
      !!it &&
      typeof (it as LayoutItem).widgetId === 'string' &&
      typeof (it as LayoutItem).x === 'number' &&
      typeof (it as LayoutItem).y === 'number' &&
      typeof (it as LayoutItem).w === 'number' &&
      typeof (it as LayoutItem).h === 'number',
  );
}

/** Lee y valida el LayoutConfig del usuario; vacío si ausente/corrupto. */
function readLayout(userId: string): LayoutItem[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isValidLayoutConfig(parsed)) return [];
    return sanearItems(parsed.widgets);
  } catch {
    return [];
  }
}

/**
 * Qué dice el servidor sobre el panel. Distinguir «no tiene» de «no contesta» es
 * lo que evita el peor fallo posible: si una red caída se confundiera con un
 * servidor sin panel, este navegador subiría su copia local y le pisaría a los
 * demás dispositivos un panel más reciente.
 */
type LecturaRemota =
  | { estado: 'con-panel'; items: LayoutItem[] }
  | { estado: 'sin-panel' }
  | { estado: 'sin-respuesta' };

async function leerPanelRemoto(): Promise<LecturaRemota> {
  try {
    const res = await authFetch('/api/users/me/preferences');
    if (!res.ok) return { estado: 'sin-respuesta' };
    const body = (await res.json()) as { preferences?: Record<string, unknown> };
    const guardado = body?.preferences?.[CLAVE_PREF];
    if (guardado === undefined || guardado === null) return { estado: 'sin-panel' };
    // Un blob corrupto se trata como ausente, no como panel vacío: así el
    // siguiente guardado lo reescribe en vez de dejar al usuario sin panel.
    if (!isValidLayoutConfig(guardado)) return { estado: 'sin-panel' };
    return { estado: 'con-panel', items: sanearItems(guardado.widgets) };
  } catch {
    return { estado: 'sin-respuesta' };
  }
}

/** Sube el panel. PATCH fusiona por clave, así que no pisa otras preferencias. */
async function escribirPanelRemoto(items: LayoutItem[]): Promise<boolean> {
  const config: LayoutConfig = { version: LAYOUT_SCHEMA_VERSION, widgets: items };
  try {
    const res = await authFetch('/api/users/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ [CLAVE_PREF]: config }),
    });
    return res.ok;
  } catch {
    return false;
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
  // ¿Ha tocado el usuario el panel desde que montó? Si sí, la respuesta tardía
  // del servidor NO debe adoptarse: le borraría el widget que acaba de añadir.
  const tocadoRef = useRef(false);

  // Re-lee la caché al cambiar de usuario (login/logout) y reconcilia con el
  // servidor. El estado ya viene sembrado de la caché, así que esto solo corrige.
  useEffect(() => {
    tocadoRef.current = false;
    if (!userId) {
      setItems([]);
      return;
    }
    setItems(readLayout(userId));

    let cancelado = false;
    void (async () => {
      const remoto = await leerPanelRemoto();
      if (cancelado || tocadoRef.current) return;

      if (remoto.estado === 'con-panel') {
        // El servidor manda, incluso si trae el panel vacío: significa que en
        // otro dispositivo se quitaron los widgets, no que se hayan perdido.
        setItems(remoto.items);
        writeLayout(userId, remoto.items);
        return;
      }
      if (remoto.estado === 'sin-panel') {
        // Primera vez que este usuario sincroniza: sube lo que ya tuviera en
        // este navegador para que la migración no le cueste su panel.
        const local = readLayout(userId);
        if (local.length > 0) void escribirPanelRemoto(local);
      }
      // 'sin-respuesta': se sigue con la caché local y no se sube nada.
    })();

    return () => {
      cancelado = true;
    };
  }, [userId]);

  /**
   * Guarda en la caché local (síncrono, es quien decide si el cambio se aceptó)
   * y sube al servidor en segundo plano. Si lo local va bien pero la subida
   * falla, el cambio NO se pierde: vale en este dispositivo y se avisa de que no
   * ha viajado, en vez de fingir que todo fue bien.
   */
  const guardar = useCallback(
    (next: LayoutItem[], mensajeFallo: string): boolean => {
      if (!userId) return false;
      tocadoRef.current = true;
      const ok = writeLayout(userId, next);
      setPersistError(ok ? null : mensajeFallo);
      if (!ok) return false;
      void escribirPanelRemoto(next).then((subido) => {
        if (!subido) {
          setPersistError('Guardado en este dispositivo, pero no se pudo sincronizar con tu cuenta.');
        }
      });
      return true;
    },
    [userId],
  );

  // Persistencia con debounce para cambios frecuentes (mover/redimensionar).
  const schedulePersist = useCallback(
    (next: LayoutItem[]) => {
      if (!userId) return;
      tocadoRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        guardar(next, 'Los cambios de posición no pudieron guardarse.');
      }, PERSIST_DEBOUNCE_MS);
    },
    [userId, guardar],
  );

  // Persistencia inmediata para cambios estructurales (añadir/eliminar).
  const persistNow = useCallback(
    (next: LayoutItem[]): boolean => {
      if (!userId) return false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return guardar(next, 'Los cambios no pudieron guardarse.');
    },
    [userId, guardar],
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
