import { useCallback, useState } from 'react';
import type { DragEvent } from 'react';

// Orden de columnas reordenable por arrastre, persistido por dispositivo en
// localStorage. `defaultOrder` son las claves de columna en su orden inicial.
// El orden guardado se reconcilia con las claves conocidas (ignora las que ya no
// existen y añade al final las nuevas), para no romperse si cambian las columnas.

export function useColumnOrder(storageKey: string, defaultOrder: string[]) {
  const [order, setOrder] = useState<string[]>(() => reconcile(read(storageKey), defaultOrder));
  const [dragging, setDragging] = useState<string | null>(null);

  const move = useCallback(
    (from: string, to: string) => {
      if (from === to) return;
      setOrder((prev) => {
        const next = [...prev];
        const fi = next.indexOf(from);
        const ti = next.indexOf(to);
        if (fi < 0 || ti < 0) return prev;
        next.splice(fi, 1);
        next.splice(ti, 0, from);
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

  /** Props para el <th> de cada columna: lo hace arrastrable y soltable. */
  const dragProps = useCallback(
    (key: string) => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        setDragging(key);
        e.dataTransfer.effectAllowed = 'move';
      },
      onDragOver: (e: DragEvent) => e.preventDefault(),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setDragging((d) => {
          if (d) move(d, key);
          return null;
        });
      },
      onDragEnd: () => setDragging(null),
    }),
    [move],
  );

  return { order, dragProps, dragging };
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
