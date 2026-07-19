import type { CustomerYearRow } from '../api';
import type { ExcelSheet } from './excel-types';
import { computeDelta } from './compare';

export interface CustomerMatrixRow {
  customer: string;
  byYear: Record<number, number>;
  total: number;
}

export function buildCustomerMatrix(rows: CustomerYearRow[]): CustomerMatrixRow[] {
  const map = new Map<string, CustomerMatrixRow>();
  for (const r of rows) {
    let m = map.get(r.customer);
    if (!m) {
      m = { customer: r.customer, byYear: {}, total: 0 };
      map.set(r.customer, m);
    }
    m.byYear[r.year] = (m.byYear[r.year] ?? 0) + r.ventas;
    m.total += r.ventas;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function computeColumnTotals(
  matrix: CustomerMatrixRow[],
  years: number[]
): { byYear: Record<number, number>; grand: number } {
  const byYear: Record<number, number> = {};
  for (const y of years) byYear[y] = 0;
  let grand = 0;
  for (const row of matrix) {
    for (const y of years) byYear[y] += row.byYear[y] ?? 0;
    grand += row.total;
  }
  return { byYear, grand };
}

export type CustomerSortKey = "customer" | "total" | "delta" | number; // number = año
export type CustomerSortDir = "asc" | "desc";

// Ordena la matriz por columna (nombre, un año concreto, total o delta A/B). No muta la entrada.
export function sortCustomerMatrix(
  matrix: CustomerMatrixRow[],
  sortKey: CustomerSortKey,
  sortDir: CustomerSortDir,
  compare?: { a: number; b: number }
): CustomerMatrixRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  const val = (r: CustomerMatrixRow): string | number => {
    if (sortKey === "customer") return r.customer.toLowerCase();
    if (sortKey === "total") return r.total;
    if (sortKey === "delta") {
      if (!compare) return 0;
      const p = computeDelta(r.byYear[compare.a] ?? 0, r.byYear[compare.b] ?? 0).deltaPct;
      return p ?? -Infinity; // null (B=0) al fondo en desc
    }
    return r.byYear[sortKey] ?? 0;
  };
  return [...matrix].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

export function filterCustomers(matrix: CustomerMatrixRow[], search: string): CustomerMatrixRow[] {
  const q = search.trim().toLowerCase();
  if (!q) return matrix;
  return matrix.filter((r) => r.customer.toLowerCase().includes(q));
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function customerMatrixToCsv(
  matrix: CustomerMatrixRow[],
  years: number[],
  grand: number
): string {
  const pct = (n: number) => (grand > 0 ? `${((n / grand) * 100).toFixed(1)}%` : "0%");
  const header = ["Cliente", ...years.map(String), "Total", "%"];
  const body = matrix.map((r) => [
    r.customer,
    ...years.map((y) => (r.byYear[y] ?? 0).toFixed(2)),
    r.total.toFixed(2),
    pct(r.total),
  ]);
  const totals = computeColumnTotals(matrix, years);
  const totalRow = [
    "TOTAL",
    ...years.map((y) => totals.byYear[y].toFixed(2)),
    totals.grand.toFixed(2),
    pct(totals.grand),
  ];
  return [header, ...body, totalRow].map((row) => row.map(csvCell).join(";")).join("\n");
}

export function customerMatrixToExcel(matrix: CustomerMatrixRow[], years: number[], grand: number): ExcelSheet {
  const totals = computeColumnTotals(matrix, years);
  const ratio = (n: number) => (grand > 0 ? n / grand : 0);
  return {
    name: "Clientes",
    columns: [
      { header: "Cliente", width: 32 },
      ...years.map((y) => ({ header: String(y), width: 14, numFmt: '"$"#,##0.00' })),
      { header: "Total", width: 16, numFmt: '"$"#,##0.00' },
      { header: "%", width: 9, numFmt: "0.0%" },
    ],
    rows: [
      ...matrix.map((r) => ({ cells: [r.customer, ...years.map((y) => r.byYear[y] ?? 0), r.total, ratio(r.total)] })),
      { cells: ["TOTAL", ...years.map((y) => totals.byYear[y]), totals.grand, ratio(totals.grand)], bold: true },
    ],
  };
}
