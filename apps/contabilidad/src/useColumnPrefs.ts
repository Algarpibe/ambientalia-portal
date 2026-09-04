import { useCallback, useState } from 'react';

/**
 * Orden, visibilidad y ANCHO de columnas, persistidos en localStorage.
 *
 * La clave debe ir acotada por usuario (ver `clavePrefs`): así la configuración de
 * uno NO altera la de otro, ni siquiera si comparten el mismo navegador. Es una
 * preferencia de UI por dispositivo — no viaja al servidor ni entre equipos.
 *
 * Se guardan las OCULTAS, no las visibles: una columna nueva que se añada mañana
 * aparecerá por defecto en vez de quedar invisible sin que nadie sepa por qué.
 * Con los anchos pasa igual: solo se guardan los que el usuario ha tocado, así que
 * el resto sigue el ancho por defecto de la tabla aunque este cambie más adelante.
 *
 * Al leer se reconcilia con las columnas conocidas (descarta las que ya no existen,
 * añade al final las nuevas), para que un guardado viejo no rompa nada.
 */
export interface ColumnPrefs<K extends string> {
  orden: K[];
  esVisible: (key: K) => boolean;
  /** Ancho en px elegido por el usuario, o undefined si usa el de por defecto. */
  anchoDe: (key: K) => number | undefined;
  /** Mueve `origen` a la posición que ocupa `destino` (arrastrar y soltar). */
  mover: (origen: K, destino: K) => void;
  alternar: (key: K) => void;
  redimensionar: (key: K, ancho: number) => void;
  /** Devuelve una columna a su ancho por defecto (doble clic en el separador). */
  restablecerAncho: (key: K) => void;
  restablecer: () => void;
  personalizado: boolean;
}

interface Estado<K extends string> {
  orden: K[];
  ocultas: K[];
  anchos: Partial<Record<K, number>>;
}

interface Guardado {
  orden?: string[];
  ocultas?: string[];
  anchos?: Record<string, number>;
}

/** Clave de localStorage acotada al usuario del JWT (o 'anon' si no hay sesión). */
export function clavePrefs(tabla: string, userId: string | null): string {
  return `contabilidad:columnas:${tabla}:${userId ?? 'anon'}`;
}

export function useColumnPrefs<K extends string>(storageKey: string, porDefecto: K[]): ColumnPrefs<K> {
  const [estado, setEstado] = useState<Estado<K>>(() => leer(storageKey, porDefecto));

  // Un único punto de escritura: evita que una rama se olvide de persistir.
  const aplicar = useCallback(
    (fn: (prev: Estado<K>) => Estado<K>) => {
      setEstado((prev) => {
        const next = fn(prev);
        if (next === prev) return prev;
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* incógnito o cuota llena: la sesión sigue funcionando sin persistir */
        }
        return next;
      });
    },
    [storageKey],
  );

  const mover = useCallback(
    (origen: K, destino: K) => {
      if (origen === destino) return;
      aplicar((prev) => {
        const i = prev.orden.indexOf(origen);
        const j = prev.orden.indexOf(destino);
        if (i < 0 || j < 0) return prev;
        const orden = [...prev.orden];
        orden.splice(i, 1);
        orden.splice(j, 0, origen);
        return { ...prev, orden };
      });
    },
    [aplicar],
  );

  const alternar = useCallback(
    (key: K) =>
      aplicar((prev) => ({
        ...prev,
        ocultas: prev.ocultas.includes(key) ? prev.ocultas.filter((k) => k !== key) : [...prev.ocultas, key],
      })),
    [aplicar],
  );

  const redimensionar = useCallback(
    (key: K, ancho: number) =>
      aplicar((prev) => ({ ...prev, anchos: { ...prev.anchos, [key]: Math.round(ancho) } })),
    [aplicar],
  );

  const restablecerAncho = useCallback(
    (key: K) =>
      aplicar((prev) => {
        if (prev.anchos[key] === undefined) return prev;
        const anchos = { ...prev.anchos };
        delete anchos[key];
        return { ...prev, anchos };
      }),
    [aplicar],
  );

  const restablecer = useCallback(() => {
    setEstado({ orden: porDefecto, ocultas: [], anchos: {} });
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* no-op */
    }
  }, [porDefecto, storageKey]);

  return {
    orden: estado.orden,
    esVisible: (key: K) => !estado.ocultas.includes(key),
    anchoDe: (key: K) => estado.anchos[key],
    mover,
    alternar,
    redimensionar,
    restablecerAncho,
    restablecer,
    personalizado:
      estado.ocultas.length > 0 ||
      Object.keys(estado.anchos).length > 0 ||
      estado.orden.join() !== porDefecto.join(),
  };
}

function leer<K extends string>(storageKey: string, porDefecto: K[]): Estado<K> {
  let g: Guardado | null = null;
  try {
    const raw = localStorage.getItem(storageKey);
    g = raw ? (JSON.parse(raw) as Guardado) : null;
  } catch {
    g = null;
  }
  if (!g) return { orden: porDefecto, ocultas: [], anchos: {} };

  const conocidas = (g.orden ?? []).filter((k): k is K => (porDefecto as string[]).includes(k));
  const nuevas = porDefecto.filter((k) => !conocidas.includes(k));

  const anchos: Partial<Record<K, number>> = {};
  for (const [k, v] of Object.entries(g.anchos ?? {})) {
    if ((porDefecto as string[]).includes(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) {
      anchos[k as K] = v;
    }
  }

  return {
    orden: [...conocidas, ...nuevas],
    ocultas: (g.ocultas ?? []).filter((k): k is K => (porDefecto as string[]).includes(k)),
    anchos,
  };
}
