import { useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

/**
 * Ordenamiento genérico por columna para tablas. Ordena por la CLAVE indicada
 * (el campo subyacente de la fila, no el texto ya formateado en pantalla). Los
 * valores vacíos/nulos/NaN van siempre al final. Números por magnitud; texto con
 * `localeCompare` es-CO y `numeric` (así "OV-2026-9" < "OV-2026-10").
 */
export function useSortable<T>(rows: T[], initialKey: string | null = null, initialDir: SortDir = 'asc') {
  const [sortKey, setSortKey] = useState<string | null>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const toggle = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const dir = sortDir === 'asc' ? 1 : -1;
    const isEmpty = (v: unknown) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
    return [...rows].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey];
      const bv = (b as Record<string, unknown>)[sortKey];
      if (isEmpty(av) && isEmpty(bv)) return 0;
      if (isEmpty(av)) return 1; // vacíos al final, sin importar la dirección
      if (isEmpty(bv)) return -1;
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), 'es', { numeric: true });
      return cmp * dir;
    });
  }, [rows, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggle };
}

/** Indicador de orden para un encabezado: ↑/↓ si es la columna activa, ↕ si no. */
export function sortArrow(active: boolean, dir: SortDir): string {
  return active ? (dir === 'asc' ? '↑' : '↓') : '↕';
}
