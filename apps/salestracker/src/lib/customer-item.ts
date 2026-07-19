import type { CustomerItemRow } from '../api';
import type { ExcelSheet, ExcelRow } from './excel-types';

export type Bucket = "mano_obra" | "cr" | "equipos" | "operacion";

export const BUCKET_LABELS: Record<Bucket, string> = {
  mano_obra: "Mano de Obra / Cal",
  cr: "C&R",
  equipos: "Equipos",
  operacion: "Operación",
};

export interface CustomerGroup {
  customer: string;
  items: CustomerItemRow[];
  totals: Record<Bucket, number>;
}

export function bucketForCategory(categoria: string | null): Bucket {
  if (categoria) {
    if (categoria.startsWith("C&R ")) return "cr";
    if (categoria.startsWith("CAL ") || categoria === "ST" || categoria.startsWith("ST ") || categoria === "Alquileres") {
      return "mano_obra";
    }
    if (categoria === "Operación de Redes" || categoria === "Consultoría") return "operacion";
  }
  return "equipos";
}

export function filterRows(rows: CustomerItemRow[], search: string): CustomerItemRow[] {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.customer.toLowerCase().includes(q) ||
      (r.sku ?? "").toLowerCase().includes(q) ||
      r.nombre.toLowerCase().includes(q)
  );
}

function emptyTotals(): Record<Bucket, number> {
  return { mano_obra: 0, cr: 0, equipos: 0, operacion: 0 };
}

export function groupByCustomer(rows: CustomerItemRow[]): CustomerGroup[] {
  const map = new Map<string, CustomerGroup>();
  for (const r of rows) {
    let g = map.get(r.customer);
    if (!g) {
      g = { customer: r.customer, items: [], totals: emptyTotals() };
      map.set(r.customer, g);
    }
    g.items.push(r);
    g.totals[bucketForCategory(r.categoria)] += r.importe;
  }
  const groups = [...map.values()];
  for (const g of groups) g.items.sort((a, b) => b.importe - a.importe);
  groups.sort((a, b) => a.customer.localeCompare(b.customer));
  return groups;
}

export function computeGrandTotals(groups: CustomerGroup[]): Record<Bucket, number> {
  const t = emptyTotals();
  for (const g of groups) {
    t.mano_obra += g.totals.mano_obra;
    t.cr += g.totals.cr;
    t.equipos += g.totals.equipos;
    t.operacion += g.totals.operacion;
  }
  return t;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function customerItemToCsv(groups: CustomerGroup[], grand: Record<Bucket, number>): string {
  const header = ["SKU", "Marca", "Nombre", "Categoría", "Cantidad", "Mano de Obra/Cal", "C&R", "Equipos", "Operación"];
  const lines: (string | number)[][] = [header];
  for (const g of groups) {
    lines.push(["", "", "", "", "", g.totals.mano_obra.toFixed(2), g.totals.cr.toFixed(2), g.totals.equipos.toFixed(2), g.totals.operacion.toFixed(2)]);
    lines[lines.length - 1][0] = g.customer;
    for (const it of g.items) {
      const b = bucketForCategory(it.categoria);
      lines.push([
        it.sku ?? "",
        it.marca ?? "",
        it.nombre,
        it.categoria ?? "Sin categoría",
        it.cantidad,
        b === "mano_obra" ? it.importe.toFixed(2) : "",
        b === "cr" ? it.importe.toFixed(2) : "",
        b === "equipos" ? it.importe.toFixed(2) : "",
        b === "operacion" ? it.importe.toFixed(2) : "",
      ]);
    }
  }
  lines.push(["TOTAL", "", "", "", "", grand.mano_obra.toFixed(2), grand.cr.toFixed(2), grand.equipos.toFixed(2), grand.operacion.toFixed(2)]);
  return lines.map((row) => row.map(csvCell).join(";")).join("\n");
}

export function customerItemToExcel(groups: CustomerGroup[], grand: Record<Bucket, number>): ExcelSheet {
  const rows: ExcelRow[] = [];
  for (const g of groups) {
    rows.push({ cells: [g.customer, "", "", "", "", g.totals.mano_obra, g.totals.cr, g.totals.equipos, g.totals.operacion], bold: true });
    for (const it of g.items) {
      const b = bucketForCategory(it.categoria);
      rows.push({
        cells: [
          it.sku ?? "", it.marca ?? "", it.nombre, it.categoria ?? "Sin categoría", it.cantidad,
          b === "mano_obra" ? it.importe : null,
          b === "cr" ? it.importe : null,
          b === "equipos" ? it.importe : null,
          b === "operacion" ? it.importe : null,
        ],
      });
    }
  }
  rows.push({ cells: ["TOTAL", "", "", "", "", grand.mano_obra, grand.cr, grand.equipos, grand.operacion], bold: true });
  return {
    name: "Cliente×Artículo",
    columns: [
      { header: "SKU", width: 16 },
      { header: "Marca", width: 18 },
      { header: "Nombre", width: 40 },
      { header: "Categoría", width: 20 },
      { header: "Cantidad", width: 12, numFmt: "#,##0" },
      { header: "Mano de Obra/Cal", width: 16, numFmt: '"$"#,##0.00' },
      { header: "C&R", width: 16, numFmt: '"$"#,##0.00' },
      { header: "Equipos", width: 16, numFmt: '"$"#,##0.00' },
      { header: "Operación", width: 16, numFmt: '"$"#,##0.00' },
    ],
    rows,
  };
}
