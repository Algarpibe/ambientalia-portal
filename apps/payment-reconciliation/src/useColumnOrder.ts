import { useCallback, useState } from 'react';

// Orden de columnas configurable, persistido por dispositivo en localStorage.
// `defaultOrder` son las claves de columna en su orden inicial. El orden guardado
// se reconcilia con las claves conocidas (ignora las que ya no existen y añade al
// final las nuevas), para no romperse si cambian las columnas. Se reordena con
// `move(key, dir)` (dir -1 sube, +1 baja) desde el menú "Columnas".

export function useColumnOrder(storageKey: string, defaultOrder: string[]) {
  const [order, setOrder] = useState<string[]>(() => reconcile(read(storageKey), defaultOrder));

  const move = useCallback(
    (key: string, dir: -1 | 1) => {
      setOrder((prev) => {
        const i = prev.indexOf(key);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= prev.length) return prev;
        const next = [...prev];
        [next[i], next[j]] = [next[j], next[i]];
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* no-op */
        }
        return next;
      });
    },
    [storageKey],
  );

  return { order, move };
}

function read(storageKey: string): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function reconcile(saved: string[] | null, defaultOrder: string[]): string[] {
  if (!saved) return defaultOrder;
  const known = saved.filter((k) => defaultOrder.includes(k));
  const missing = defaultOrder.filter((k) => !known.includes(k));
  return [...known, ...missing];
}
