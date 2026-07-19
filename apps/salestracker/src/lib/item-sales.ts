import type { ItemSalesRow } from '../api';
import type { ExcelSheet } from './excel-types';

export type ItemSortKey = "sku" | "nombre" | "categoria" | "cantidad" | "importe" | "precio";
export type SortDir = "asc" | "desc";

export const SIN_CATEGORIA = "Sin categoría";

export function categoriaLabel(row: ItemSalesRow): string {
  return row.categoria ?? SIN_CATEGORIA;
}

export function precioPromedio(row: ItemSalesRow): number {
  return row.cantidad !== 0 ? row.importe / row.cantidad : 0;
}

export function filterAndSortItems(
  rows: ItemSalesRow[],
  opts: { search: string; categoria: string; sortKey: ItemSortKey; sortDir: SortDir }
): ItemSalesRow[] {
  const q = opts.search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    const matchesSearch =
      !q || (r.sku ?? "").toLowerCase().includes(q) || r.nombre.toLowerCase().includes(q);
    const matchesCat = !opts.categoria || categoriaLabel(r) === opts.categoria;
    return matchesSearch && matchesCat;
  });
  const dir = opts.sortDir === "asc" ? 1 : -1;
  const val = (r: ItemSalesRow): string | number => {
    switch (opts.sortKey) {
      case "sku": return r.sku ?? "";
      case "nombre": return r.nombre;
      case "categoria": return categoriaLabel(r);
      case "cantidad": return r.cantidad;
      case "importe": return r.importe;
      case "precio": return precioPromedio(r);
    }
  };
  return [...filtered].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

export function computeItemTotals(rows: ItemSalesRow[]): { cantidad: number; importe: number } {
  return rows.reduce(
    (acc, r) => ({ cantidad: acc.cantidad + r.cantidad, importe: acc.importe + r.importe }),
    { cantidad: 0, importe: 0 }
  );
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function itemsToCsv(rows: ItemSalesRow[]): string {
  const header = ["SKU", "Nombre", "Categoría", "Cantidad", "Importe", "Precio promedio"];
  const body = rows.map((r) => [
    r.sku ?? "",
    r.nombre,
    categoriaLabel(r),
    r.cantidad,
    r.importe.toFixed(2),
    precioPromedio(r).toFixed(2),
  ]);
  const t = computeItemTotals(rows);
  const total = ["TOTAL", "", "", t.cantidad, t.importe.toFixed(2), ""];
  return [header, ...body, total].map((row) => row.map(csvCell).join(";")).join("\n");
}

export function itemsToExcel(rows: ItemSalesRow[]): ExcelSheet {
  const t = computeItemTotals(rows);
  return {
    name: "Artículos",
    columns: [
      { header: "SKU", width: 16 },
      { header: "Nombre", width: 40 },
      { header: "Categoría", width: 22 },
      { header: "Cantidad", width: 12, numFmt: "#,##0" },
      { header: "Importe", width: 16, numFmt: '"$"#,##0.00' },
      { header: "Precio promedio", width: 16, numFmt: '"$"#,##0.00' },
    ],
    rows: [
      ...rows.map((r) => ({ cells: [r.sku ?? "", r.nombre, categoriaLabel(r), r.cantidad, r.importe, precioPromedio(r)] })),
      { cells: ["TOTAL", "", "", t.cantidad, t.importe, null], bold: true },
    ],
  };
}
