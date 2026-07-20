import { bucketForCategory } from './customer-item';
import type { SalesRow, CustomerYearRow, ItemSalesRow, CustomerItemRow, CustomerMonthRow, CategoryMonthRow } from '../api';

export interface BucketMixYear {
  year: number;
  mano_obra: number;
  cr: number;
  equipos: number;
  operacion: number;
}

export function buildBucketMixByYear(records: SalesRow[], tipo: string): BucketMixYear[] {
  const map = new Map<number, BucketMixYear>();
  for (const r of records) {
    if (r.recordType !== tipo) continue;
    if (r.year < 2021) continue;
    let row = map.get(r.year);
    if (!row) {
      row = { year: r.year, mano_obra: 0, cr: 0, equipos: 0, operacion: 0 };
      map.set(r.year, row);
    }
    row[bucketForCategory(r.categoryName)] += r.amountUsd;
  }
  return [...map.values()].sort((a, b) => a.year - b.year);
}

export interface ParetoRow {
  customer: string;
  ventas: number;
  cumPct: number;
}

export function buildClientPareto(rows: CustomerYearRow[]): ParetoRow[] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.customer, (map.get(r.customer) ?? 0) + r.ventas);
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const grand = sorted.reduce((s, [, v]) => s + v, 0);
  let acc = 0;
  return sorted.map(([customer, ventas]) => {
    acc += ventas;
    return { customer, ventas, cumPct: grand > 0 ? (acc / grand) * 100 : 0 };
  });
}

export function topItems(rows: ItemSalesRow[], metric: "importe" | "cantidad", n: number): ItemSalesRow[] {
  return [...rows].sort((a, b) => b[metric] - a[metric] || a.nombre.localeCompare(b.nombre)).slice(0, n);
}

export interface ItemParetoRow {
  label: string;
  sku: string | null;
  importe: number;
  cumPct: number;
}

export function buildItemPareto(rows: ItemSalesRow[]): ItemParetoRow[] {
  const sorted = [...rows].sort((a, b) => b.importe - a.importe || a.nombre.localeCompare(b.nombre));
  const grand = sorted.reduce((s, r) => s + r.importe, 0);
  let acc = 0;
  return sorted.map((r) => {
    acc += r.importe;
    return { label: r.nombre, sku: r.sku, importe: r.importe, cumPct: grand > 0 ? (acc / grand) * 100 : 0 };
  });
}

export interface BrandMixRow {
  marca: string;
  importe: number;
}

export function buildBrandMix(rows: CustomerItemRow[]): BrandMixRow[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const marca = r.marca ?? "Sin marca";
    map.set(marca, (map.get(marca) ?? 0) + r.importe);
  }
  return [...map.entries()]
    .map(([marca, importe]) => ({ marca, importe }))
    .sort((a, b) => b.importe - a.importe || a.marca.localeCompare(b.marca));
}

export interface BucketClientRow {
  customer: string;
  mano_obra: number;
  cr: number;
  equipos: number;
  operacion: number;
  total: number;
}

export function buildBucketByClient(rows: CustomerItemRow[]): BucketClientRow[] {
  const map = new Map<string, BucketClientRow>();
  for (const r of rows) {
    let row = map.get(r.customer);
    if (!row) {
      row = { customer: r.customer, mano_obra: 0, cr: 0, equipos: 0, operacion: 0, total: 0 };
      map.set(r.customer, row);
    }
    row[bucketForCategory(r.categoria)] += r.importe;
    row.total += r.importe;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.customer.localeCompare(b.customer));
}

export interface NewVsRecurringRow {
  year: number;
  nuevos: number;
  recurrentes: number;
  countNuevos: number;
}

export function buildNewVsRecurring(rows: CustomerYearRow[]): NewVsRecurringRow[] {
  // firstYear por cliente (mínimo año con ventas > 0)
  const firstYear = new Map<string, number>();
  for (const r of rows) {
    if (r.ventas > 0) {
      const cur = firstYear.get(r.customer);
      if (cur === undefined || r.year < cur) firstYear.set(r.customer, r.year);
    }
  }
  const byYear = new Map<number, NewVsRecurringRow>();
  for (const r of rows) {
    if (r.ventas <= 0) continue;
    let acc = byYear.get(r.year);
    if (!acc) {
      acc = { year: r.year, nuevos: 0, recurrentes: 0, countNuevos: 0 };
      byYear.set(r.year, acc);
    }
    if (firstYear.get(r.customer) === r.year) {
      acc.nuevos += r.ventas;
      acc.countNuevos += 1;
    } else {
      acc.recurrentes += r.ventas;
    }
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

export interface MonthHeatmapRow {
  customer: string;
  months: number[]; // length 12, índice 0 = enero
  total: number;
}

export function buildMonthHeatmap(rows: CustomerMonthRow[]): MonthHeatmapRow[] {
  const map = new Map<string, MonthHeatmapRow>();
  for (const r of rows) {
    let row = map.get(r.customer);
    if (!row) {
      row = { customer: r.customer, months: new Array(12).fill(0), total: 0 };
      map.set(r.customer, row);
    }
    if (r.mes >= 1 && r.mes <= 12) {
      row.months[r.mes - 1] += r.importe;
      row.total += r.importe;
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.customer.localeCompare(b.customer));
}

export interface BucketSeasonRow { mes: number; mano_obra: number; cr: number; equipos: number; operacion: number }

export function buildBucketSeason(rows: CategoryMonthRow[]): BucketSeasonRow[] {
  const months: BucketSeasonRow[] = Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1, mano_obra: 0, cr: 0, equipos: 0, operacion: 0,
  }));
  for (const r of rows) {
    if (r.mes >= 1 && r.mes <= 12) months[r.mes - 1][bucketForCategory(r.categoria)] += r.importe;
  }
  return months;
}
