import { useCallback, useState } from 'react';

/**
 * Orden y visibilidad de columnas, persistidos en localStorage.
 *
 * La clave debe ir acotada por usuario (ver `clavePrefs`): así la configuración de
 * uno NO altera la de otro, ni siquiera si comparten el mismo navegador. Es una
 * preferencia de UI por dispositivo — no viaja al servidor ni entre equipos.
 *
 * Se guardan las OCULTAS, no las visibles: una columna nueva que se añada mañana
 * aparecerá por defecto en vez de quedar invisible sin que nadie sepa por qué.
 * Y al leer se reconcilia con las columnas conocidas (descarta las que ya no
 * existen, añade al final las nuevas), para que un guardado viejo no rompa nada.
 */
export interface ColumnPrefs<K extends string> {
  orden: K[];
  esVisible: (key: K) => boolean;
  /** Mueve `origen` a la posición que ocupa `destino` (arrastrar y soltar). */
  mover: (origen: K, destino: K) => void;
  alternar: (key: K) => void;
  restablecer: () => void;
  personalizado: boolean;
}

interface Guardado {
  orden?: string[];
  ocultas?: string[];
}

/** Clave de localStorage acotada al usuario del JWT (o 'anon' si no hay sesión). */
export function clavePrefs(tabla: string, userId: string | null): string {
  return `contabilidad:columnas:${tabla}:${userId ?? 'anon'}`;
}

export function useColumnPrefs<K extends string>(storageKey: string, porDefecto: K[]): ColumnPrefs<K> {
  const [estado, setEstado] = useState<{ orden: K[]; ocultas: K[] }>(() => leer(storageKey, porDefecto));

  const guardar = useCallback(
    (next: { orden: K[]; ocultas: K[] }) => {
      setEstado(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify({ orden: next.orden, ocultas: next.ocultas }));
      } catch {
        /* modo incógnito o cuota llena: la sesión sigue funcionando sin persistir */
      }
    },
    [storageKey],
  );

  const mover = useCallback(
    (origen: K, destino: K) => {
      if (origen === destino) return;
      setEstado((prev) => {
        const i = prev.orden.indexOf(origen);
        const j = prev.orden.indexOf(destino);
        if (i < 0 || j < 0) return prev;
        const orden = [...prev.orden];
        orden.splice(i, 1);
        orden.splice(j, 0, origen);
        const next = { ...prev, orden };
        try {
          localStorage.setItem(storageKey, JSON.stringify({ orden, ocultas: next.ocultas }));
        } catch { /* no-op */ }
        return next;
      });
    },
    [storageKey],
  );

  const alternar = useCallback(
    (key: K) => {
      setEstado((prev) => {
        const ocultas = prev.ocultas.includes(key)
          ? prev.ocultas.filter((k) => k !== key)
          : [...prev.ocultas, key];
        const next = { ...prev, ocultas };
        try {
          localStorage.setItem(storageKey, JSON.stringify({ orden: next.orden, ocultas }));
        } catch { /* no-op */ }
        return next;
      });
    },
    [storageKey],
  );

  const restablecer = useCallback(() => {
    guardar({ orden: porDefecto, ocultas: [] });
    try {
      localStorage.removeItem(storageKey);
    } catch { /* no-op */ }
  }, [guardar, porDefecto, storageKey]);

  return {
    orden: estado.orden,
    esVisible: (key: K) => !estado.ocultas.includes(key),
    mover,
    alternar,
    restablecer,
    personalizado: estado.ocultas.length > 0 || estado.orden.join() !== porDefecto.join(),
  };
}

function leer<K extends string>(storageKey: string, porDefecto: K[]): { orden: K[]; ocultas: K[] } {
  let g: Guardado | null = null;
  try {
    const raw = localStorage.getItem(storageKey);
    g = raw ? (JSON.parse(raw) as Guardado) : null;
  } catch {
    g = null;
  }
  if (!g) return { orden: porDefecto, ocultas: [] };
  const conocidas = (g.orden ?? []).filter((k): k is K => (porDefecto as string[]).includes(k));
  const nuevas = porDefecto.filter((k) => !conocidas.includes(k));
  return {
    orden: [...conocidas, ...nuevas],
    ocultas: (g.ocultas ?? []).filter((k): k is K => (porDefecto as string[]).includes(k)),
  };
}
