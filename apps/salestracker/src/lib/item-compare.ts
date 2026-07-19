import type { ItemSalesRow } from '../api';
import { computeDelta } from './compare';

export interface ItemCompareRow {
  itemId: string;
  sku: string | null;
  nombre: string;
  categoria: string | null;
  importeA: number;
  importeB: number;
  deltaPct: number | null;
}

export function buildItemCompare(rowsA: ItemSalesRow[], rowsB: ItemSalesRow[]): ItemCompareRow[] {
  const map = new Map<string, ItemCompareRow>();
  const ensure = (r: ItemSalesRow): ItemCompareRow => {
    let row = map.get(r.itemId);
    if (!row) {
      row = { itemId: r.itemId, sku: r.sku, nombre: r.nombre, categoria: r.categoria, importeA: 0, importeB: 0, deltaPct: null };
      map.set(r.itemId, row);
    }
    return row;
  };
  for (const r of rowsA) ensure(r).importeA += r.importe;
  for (const r of rowsB) ensure(r).importeB += r.importe;
  for (const row of map.values()) row.deltaPct = computeDelta(row.importeA, row.importeB).deltaPct;
  return [...map.values()];
}
