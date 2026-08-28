import type { ReconciledRow } from './types';
import { parseExcelDate } from './customerAnalysisUtils';

/**
 * Ordenamiento de la tabla de Conciliación. Se ordena por el VALOR subyacente
 * de la fila, nunca por el texto ya formateado en pantalla (el total se muestra
 * como "COP 4,621,365" y la mora como "26d mora": ordenar ese texto daría un
 * orden alfabético sin sentido).
 *
 * La clave `paymentDetails` es la columna "Pagos / Mora" y ordena por los días
 * de mora de la fila (`maxDelayDays`), que es justamente el número que la celda
 * pinta en rojo.
 */
export type ReconciliationSortKey = 'invoiceDate' | 'total' | 'paymentDetails';

export type SortDirection = 'asc' | 'desc';

export interface ReconciliationSortConfig {
  key: ReconciliationSortKey;
  direction: SortDirection;
}

/** Columnas de la tabla que aceptan ordenamiento. */
export const SORTABLE_COLUMNS: ReconciliationSortKey[] = ['invoiceDate', 'total', 'paymentDetails'];

export const isSortable = (column: string): column is ReconciliationSortKey =>
  (SORTABLE_COLUMNS as string[]).includes(column);

/** Días de mora de la fila: el máximo entre los retrasos de pago y la mora corriente. */
export const moraDays = (row: ReconciledRow): number =>
  Number.isFinite(row.maxDelayDays) ? row.maxDelayDays : 0;

/**
 * Siguiente estado al hacer clic en un encabezado: una columna nueva arranca en
 * descendente (el total más alto, la mora más grave y la factura más reciente
 * son lo que se busca al ordenar); reclicar la misma columna alterna.
 */
export const nextSortConfig = (
  current: ReconciliationSortConfig | null,
  key: ReconciliationSortKey,
): ReconciliationSortConfig => {
  if (current?.key !== key) return { key, direction: 'desc' };
  return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' };
};

const compareDates = (a: ReconciledRow, b: ReconciledRow, dir: number): number => {
  const dateA = a.invoiceDate instanceof Date ? a.invoiceDate : parseExcelDate(a.invoiceDate);
  const dateB = b.invoiceDate instanceof Date ? b.invoiceDate : parseExcelDate(b.invoiceDate);
  // Las fechas ilegibles van al final en ambas direcciones.
  if (!dateA && !dateB) return 0;
  if (!dateA) return 1;
  if (!dateB) return -1;
  if (dateA.getTime() === dateB.getTime()) return 0;
  return (dateA < dateB ? -1 : 1) * dir;
};

const numeric = (a: number, b: number, dir: number): number => (a - b) * dir;

/** Devuelve una copia ordenada; no muta el arreglo recibido. */
export function sortReconciledRows(
  rows: ReconciledRow[],
  config: ReconciliationSortConfig | null,
): ReconciledRow[] {
  if (!config) return rows;
  const dir = config.direction === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    switch (config.key) {
      case 'invoiceDate':
        return compareDates(a, b, dir);
      case 'total':
        return numeric(a.total, b.total, dir);
      case 'paymentDetails':
        return numeric(moraDays(a), moraDays(b), dir);
      default:
        return 0;
    }
  });
}
