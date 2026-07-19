import { describe, it, expect } from "vitest";
import {
  bucketForCategory,
  filterRows,
  groupByCustomer,
  computeGrandTotals,
  customerItemToCsv,
  customerItemToExcel,
} from "./customer-item";
import type { CustomerItemRow } from "../api";

const rows: CustomerItemRow[] = [
  { customer: "Beta", sku: "A", marca: "Horiba Ltd.", nombre: "Scrubber", categoria: "C&R AP Series", cantidad: 1, importe: 100 },
  { customer: "Beta", sku: "B", marca: "Ambientalia", nombre: "Calibración Enviro", categoria: "CAL PM", cantidad: 2, importe: 300 },
  { customer: "Alpha", sku: "C", marca: "Grimm", nombre: "EDM 180C", categoria: "EDM180 Series", cantidad: 1, importe: 500 },
  { customer: "Alpha", sku: "D", marca: "Ambientalia", nombre: "Mantenimiento", categoria: "Operación de Redes", cantidad: 1, importe: 50 },
];

describe("bucketForCategory", () => {
  it("clasifica por reglas de nombre", () => {
    expect(bucketForCategory("C&R AP Series")).toBe("cr");
    expect(bucketForCategory("CAL PM")).toBe("mano_obra");
    expect(bucketForCategory("ST EDM 180")).toBe("mano_obra");
    expect(bucketForCategory("ST")).toBe("mano_obra");
    expect(bucketForCategory("Alquileres")).toBe("mano_obra");
    expect(bucketForCategory("Operación de Redes")).toBe("operacion");
    expect(bucketForCategory("Consultoría")).toBe("operacion");
    expect(bucketForCategory("EDM180 Series")).toBe("equipos");
    expect(bucketForCategory("Accesorios")).toBe("equipos");
    expect(bucketForCategory(null)).toBe("equipos");
  });
});

describe("filterRows", () => {
  it("filtra por customer/sku/nombre (case-insensitive)", () => {
    expect(filterRows(rows, "alpha").length).toBe(2);
    expect(filterRows(rows, "scrubber").map((r) => r.sku)).toEqual(["A"]);
    expect(filterRows(rows, "").length).toBe(4);
  });
});

describe("groupByCustomer", () => {
  it("agrupa, subtotales por bucket, orden alfabético + items por importe desc", () => {
    const g = groupByCustomer(rows);
    expect(g.map((x) => x.customer)).toEqual(["Alpha", "Beta"]);
    expect(g[0].totals).toEqual({ mano_obra: 0, cr: 0, equipos: 500, operacion: 50 });
    expect(g[0].items.map((i) => i.sku)).toEqual(["C", "D"]);
    expect(g[1].totals).toEqual({ mano_obra: 300, cr: 100, equipos: 0, operacion: 0 });
    expect(g[1].items.map((i) => i.sku)).toEqual(["B", "A"]);
  });
});

describe("computeGrandTotals", () => {
  it("suma los 4 buckets", () => {
    expect(computeGrandTotals(groupByCustomer(rows))).toEqual({ mano_obra: 300, cr: 100, equipos: 500, operacion: 50 });
  });
});

describe("customerItemToCsv", () => {
  it("cabecera + fila por cliente + artículos + TOTAL", () => {
    const groups = groupByCustomer(rows);
    const csv = customerItemToCsv(groups, computeGrandTotals(groups));
    const lines = csv.split("\n");
    expect(lines[0]).toBe("SKU;Marca;Nombre;Categoría;Cantidad;Mano de Obra/Cal;C&R;Equipos;Operación");
    expect(lines[1]).toBe("Alpha;;;;;0.00;0.00;500.00;50.00");
    expect(lines[2]).toBe("C;Grimm;EDM 180C;EDM180 Series;1;;;500.00;");
    expect(lines[lines.length - 1]).toBe("TOTAL;;;;;300.00;100.00;500.00;50.00");
  });
});

describe("customerItemToExcel", () => {
  it("cabecera de grupo bold, buckets por columna y total bold", () => {
    const groups = [
      {
        customer: "AGQ",
        items: [
          { customer: "AGQ", sku: "1", marca: "M", nombre: "uno", categoria: "C&R EDM 180", cantidad: 1, importe: 100 },
          { customer: "AGQ", sku: "2", marca: null, nombre: "dos", categoria: "CAL PM", cantidad: 3, importe: 40 },
        ],
        totals: { mano_obra: 40, cr: 100, equipos: 0, operacion: 0 },
      },
    ];
    const grand = { mano_obra: 40, cr: 100, equipos: 0, operacion: 0 };
    const sheet = customerItemToExcel(groups, grand);
    expect(sheet.columns.map((c) => c.header)).toEqual([
      "SKU", "Marca", "Nombre", "Categoría", "Cantidad", "Mano de Obra/Cal", "C&R", "Equipos", "Operación",
    ]);
    expect(sheet.rows[0].bold).toBe(true);
    expect(sheet.rows[0].cells).toEqual(["AGQ", "", "", "", "", 40, 100, 0, 0]);
    expect(sheet.rows[1].cells).toEqual(["1", "M", "uno", "C&R EDM 180", 1, null, 100, null, null]);
    expect(sheet.rows[2].cells).toEqual(["2", "", "dos", "CAL PM", 3, 40, null, null, null]);
    const total = sheet.rows[sheet.rows.length - 1];
    expect(total.bold).toBe(true);
    expect(total.cells).toEqual(["TOTAL", "", "", "", "", 40, 100, 0, 0]);
  });
});
