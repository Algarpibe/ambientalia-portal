import type { SalesRow, RecordType } from '../api';
import { MONTHS } from './format';

export interface CategoryRow { categoryName: string; months: number[]; total: number } // months: 12
export interface CategoryMonthPivot {
  rows: CategoryRow[];
  monthlyTotals: number[]; // 12
  cumulative: number[];    // 12 (suma corrida de monthlyTotals)
  grandTotal: number;
}

/** Años presentes en las filas, descendente. */
export function availableYears(rows: SalesRow[]): number[] {
  return [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a);
}

/** Pivote Categoría × 12 meses para un año y tipo dados. Categorías ordenadas por total desc. */
export function buildCategoryMonthPivot(rows: SalesRow[], year: number, type: RecordType): CategoryMonthPivot {
  const byCat = new Map<string, number[]>();
  for (const r of rows) {
    if (r.year !== year || r.recordType !== type) continue;
    let m = byCat.get(r.categoryName);
    if (!m) { m = new Array(12).fill(0) as number[]; byCat.set(r.categoryName, m); }
    if (r.month >= 1 && r.month <= 12) m[r.month - 1] += r.amountUsd;
  }
  const catRows: CategoryRow[] = [...byCat.entries()]
    .map(([categoryName, months]) => ({ categoryName, months, total: months.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.total - a.total || a.categoryName.localeCompare(b.categoryName));

  const monthlyTotals = new Array(12).fill(0) as number[];
  for (const cr of catRows) for (let i = 0; i < 12; i++) monthlyTotals[i] += cr.months[i];
  const cumulative: number[] = [];
  let acc = 0;
  for (let i = 0; i < 12; i++) { acc += monthlyTotals[i]; cumulative.push(acc); }
  const grandTotal = monthlyTotals.reduce((s, v) => s + v, 0);
  return { rows: catRows, monthlyTotals, cumulative, grandTotal };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV del pivote: cabecera + categorías + TOTAL MENSUAL + TOTAL ACUMULADO. */
export function pivotToCsv(p: CategoryMonthPivot): string {
  const header = ['Categoría', ...MONTHS, 'Total'];
  const body = p.rows.map((r) => [r.categoryName, ...r.months.map((v) => v.toFixed(2)), r.total.toFixed(2)]);
  const mensual = ['TOTAL MENSUAL', ...p.monthlyTotals.map((v) => v.toFixed(2)), p.grandTotal.toFixed(2)];
  const acumulado = ['TOTAL ACUMULADO', ...p.cumulative.map((v) => v.toFixed(2)), p.grandTotal.toFixed(2)];
  return [header, ...body, mensual, acumulado].map((row) => row.map(csvCell).join(';')).join('\n');
}
