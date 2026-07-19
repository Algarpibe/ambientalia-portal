import { describe, it, expect } from "vitest";
import {
  precioPromedio,
  categoriaLabel,
  filterAndSortItems,
  computeItemTotals,
  itemsToCsv,
  itemsToExcel,
} from "./item-sales";
import type { ItemSalesRow } from "../api";

const rows: ItemSalesRow[] = [
  { itemId: "1", sku: "AAA", nombre: "Sensor", categoria: "AP Series", cantidad: 2, importe: 200 },
  { itemId: "2", sku: "BBB", nombre: "Filtro APNA", categoria: "AP Series", cantidad: 4, importe: 100 },
  { itemId: "3", sku: null, nombre: "Servicio", categoria: null, cantidad: 0, importe: 50 },
  { itemId: "4", sku: "CCC", nombre: "Nota credito", categoria: "AP Series", cantidad: -1, importe: -30 },
];

describe("precioPromedio", () => {
  it("importe/cantidad; 0 si cantidad es 0", () => {
    expect(precioPromedio(rows[0])).toBe(100);
    expect(precioPromedio(rows[2])).toBe(0);
  });
});

describe("categoriaLabel", () => {
  it("usa 'Sin categoría' cuando es null", () => {
    expect(categoriaLabel(rows[0])).toBe("AP Series");
    expect(categoriaLabel(rows[2])).toBe("Sin categoría");
  });
});

describe("filterAndSortItems", () => {
  it("busca por sku o nombre (case-insensitive)", () => {
    const r = filterAndSortItems(rows, { search: "apna", categoria: "", sortKey: "importe", sortDir: "desc" });
    expect(r.map((x) => x.itemId)).toEqual(["2"]);
  });
  it("filtra por categoría (incl. 'Sin categoría')", () => {
    const r = filterAndSortItems(rows, { search: "", categoria: "Sin categoría", sortKey: "importe", sortDir: "desc" });
    expect(r.map((x) => x.itemId)).toEqual(["3"]);
  });
  it("ordena por importe desc y asc", () => {
    const desc = filterAndSortItems(rows, { search: "", categoria: "", sortKey: "importe", sortDir: "desc" });
    expect(desc.map((x) => x.itemId)).toEqual(["1", "2", "3", "4"]);
    const asc = filterAndSortItems(rows, { search: "", categoria: "", sortKey: "importe", sortDir: "asc" });
    expect(asc.map((x) => x.itemId)).toEqual(["4", "3", "2", "1"]);
  });
  it("ordena por nombre asc", () => {
    const r = filterAndSortItems(rows, { search: "", categoria: "", sortKey: "nombre", sortDir: "asc" });
    expect(r.map((x) => x.nombre)).toEqual(["Filtro APNA", "Nota credito", "Sensor", "Servicio"]);
  });
});

describe("computeItemTotals", () => {
  it("suma cantidad e importe (incluye negativos)", () => {
    expect(computeItemTotals(rows)).toEqual({ cantidad: 5, importe: 320 });
  });
});

describe("itemsToCsv", () => {
  it("incluye cabecera, filas y TOTAL con separador ';'", () => {
    const csv = itemsToCsv(rows);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("SKU;Nombre;Categoría;Cantidad;Importe;Precio promedio");
    expect(lines[lines.length - 1]).toBe("TOTAL;;;5;320.00;");
    expect(lines).toHaveLength(rows.length + 2);
  });
});

describe("itemsToExcel", () => {
  it("columnas, filas y total en negrita", () => {
    const rows: ItemSalesRow[] = [
      { itemId: "1", sku: "A", nombre: "uno", categoria: "Cat", cantidad: 2, importe: 100 },
    ];
    const sheet = itemsToExcel(rows);
    expect(sheet.name).toBe("Artículos");
    expect(sheet.columns.map((c) => c.header)).toEqual(["SKU", "Nombre", "Categoría", "Cantidad", "Importe", "Precio promedio"]);
    expect(sheet.columns[4].numFmt).toBe('"$"#,##0.00');
    expect(sheet.rows[0].cells).toEqual(["A", "uno", "Cat", 2, 100, 50]); // importe/cantidad numéricos
    const total = sheet.rows[sheet.rows.length - 1];
    expect(total.bold).toBe(true);
    expect(total.cells[0]).toBe("TOTAL");
    expect(total.cells[3]).toBe(2);
    expect(total.cells[4]).toBe(100);
  });
});
