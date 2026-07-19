import type { CustomerYearRow, CustomerItemRow, CustomerMonthRow, MarginCustomerRow } from '../api';
import { bucketForCategory } from './customer-item';
import { deriveMargin } from './analytics-margin';

export interface CustomerYearPoint { year: number; ventas: number }

export function customerYearSeries(rows: CustomerYearRow[], customer: string): CustomerYearPoint[] {
  return rows
    .filter((r) => r.customer === customer)
    .map((r) => ({ year: r.year, ventas: r.ventas }))
    .sort((a, b) => a.year - b.year);
}

export function customerFirstYear(rows: CustomerYearRow[], customer: string): number | null {
  const ys = rows.filter((r) => r.customer === customer && r.ventas > 0).map((r) => r.year);
  return ys.length ? Math.min(...ys) : null;
}

export function customerTotalVentas(rows: CustomerYearRow[], customer: string): number {
  return rows.filter((r) => r.customer === customer).reduce((s, r) => s + r.ventas, 0);
}

export interface CustomerBuckets { mano_obra: number; cr: number; equipos: number; operacion: number; total: number }

export function customerBuckets(rows: CustomerItemRow[], customer: string): CustomerBuckets {
  const acc: CustomerBuckets = { mano_obra: 0, cr: 0, equipos: 0, operacion: 0, total: 0 };
  for (const r of rows) {
    if (r.customer !== customer) continue;
    acc[bucketForCategory(r.categoria)] += r.importe;
    acc.total += r.importe;
  }
  return acc;
}

export interface CustomerItemPoint { label: string; sku: string | null; importe: number }

export function customerTopItems(rows: CustomerItemRow[], customer: string, n: number): CustomerItemPoint[] {
  return rows
    .filter((r) => r.customer === customer)
    .map((r) => ({ label: r.nombre, sku: r.sku, importe: r.importe }))
    .sort((a, b) => b.importe - a.importe || a.label.localeCompare(b.label))
    .slice(0, n);
}

export function customerMonths(rows: CustomerMonthRow[], customer: string): number[] {
  const months = new Array(12).fill(0) as number[];
  for (const r of rows) {
    if (r.customer === customer && r.mes >= 1 && r.mes <= 12) months[r.mes - 1] += r.importe;
  }
  return months;
}

export interface CustomerMarginKpi { ventas: number; costo: number; margen: number; margenPct: number }

export function customerMarginKpi(rows: MarginCustomerRow[], customer: string): CustomerMarginKpi {
  const row = rows.find((r) => r.customer === customer);
  const ventas = row?.ventas ?? 0;
  const costo = row?.costo ?? 0;
  return { ventas, costo, ...deriveMargin(ventas, costo) };
}

export function customerHref(name: string): string {
  return `/clientes/${encodeURIComponent(name)}`;
}
