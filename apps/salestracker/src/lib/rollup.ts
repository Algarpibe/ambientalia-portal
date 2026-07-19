import type { SalesRow, RecordType } from '../api';

export interface CategoryTotal {
  categoryName: string;
  total: number;
}

/** Totales por categoría (ordenados desc por total) para un tipo de registro. */
export function totalsByCategory(rows: SalesRow[], type: RecordType): CategoryTotal[] {
  const acc = new Map<string, number>();
  for (const r of rows) {
    if (r.recordType !== type) continue;
    acc.set(r.categoryName, (acc.get(r.categoryName) ?? 0) + r.amountUsd);
  }
  return [...acc.entries()]
    .map(([categoryName, total]) => ({ categoryName, total }))
    .sort((a, b) => b.total - a.total);
}

/** Suma total del tipo de registro dado. */
export function grandTotal(rows: SalesRow[], type: RecordType): number {
  return rows.reduce((s, r) => (r.recordType === type ? s + r.amountUsd : s), 0);
}
