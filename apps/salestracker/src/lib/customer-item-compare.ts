import type { CustomerItemRow } from '../api';
import { computeDelta } from './compare';

export interface CustomerItemComparePoint {
  sku: string | null;
  marca: string | null;
  nombre: string;
  categoria: string | null;
  importeA: number;
  importeB: number;
  deltaPct: number | null;
}

export interface CustomerCompareGroup {
  customer: string;
  items: CustomerItemComparePoint[];
  totalA: number;
  totalB: number;
  deltaPct: number | null;
}

export function buildCustomerItemCompare(rowsA: CustomerItemRow[], rowsB: CustomerItemRow[]): CustomerCompareGroup[] {
  const byCustomer = new Map<string, Map<string, CustomerItemComparePoint>>();
  const ensure = (r: CustomerItemRow): CustomerItemComparePoint => {
    let items = byCustomer.get(r.customer);
    if (!items) { items = new Map(); byCustomer.set(r.customer, items); }
    const key = r.sku ?? r.nombre;
    let p = items.get(key);
    if (!p) {
      p = { sku: r.sku, marca: r.marca, nombre: r.nombre, categoria: r.categoria, importeA: 0, importeB: 0, deltaPct: null };
      items.set(key, p);
    }
    return p;
  };
  for (const r of rowsA) ensure(r).importeA += r.importe;
  for (const r of rowsB) ensure(r).importeB += r.importe;

  const groups: CustomerCompareGroup[] = [];
  for (const [customer, itemsMap] of byCustomer) {
    const items = [...itemsMap.values()];
    for (const it of items) it.deltaPct = computeDelta(it.importeA, it.importeB).deltaPct;
    items.sort((a, b) => b.importeA - a.importeA || b.importeB - a.importeB || a.nombre.localeCompare(b.nombre));
    const totalA = items.reduce((s, it) => s + it.importeA, 0);
    const totalB = items.reduce((s, it) => s + it.importeB, 0);
    groups.push({ customer, items, totalA, totalB, deltaPct: computeDelta(totalA, totalB).deltaPct });
  }
  groups.sort((a, b) => a.customer.localeCompare(b.customer));
  return groups;
}
