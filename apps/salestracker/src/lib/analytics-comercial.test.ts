import { describe, it, expect } from "vitest";
import {
  buildBucketMixByYear,
  buildClientPareto,
  topItems,
  buildItemPareto,
  buildBrandMix,
  buildBucketByClient,
  buildNewVsRecurring,
  buildMonthHeatmap,
  buildBucketSeason,
} from "./analytics-comercial";
import type { SalesRow, CustomerYearRow, ItemSalesRow, CustomerItemRow, CustomerMonthRow, CategoryMonthRow } from "../api";

describe("buildBucketMixByYear", () => {
  it("filtra por tipo y año>=2021, clasifica buckets y agrega por año", () => {
    const records: SalesRow[] = [
      { categoryName: "EDM180 Series", recordType: "INVOICE", month: 1, year: 2024, amountUsd: 1000 },
      { categoryName: "C&R EDM 180", recordType: "INVOICE", month: 1, year: 2024, amountUsd: 200 },
      { categoryName: "CAL PM", recordType: "INVOICE", month: 1, year: 2025, amountUsd: 500 },
      { categoryName: "Operación de Redes", recordType: "INVOICE", month: 1, year: 2025, amountUsd: 300 },
      { categoryName: "EDM180 Series", recordType: "SALES_ORDER", month: 1, year: 2025, amountUsd: 999 },
      { categoryName: "EDM180 Series", recordType: "INVOICE", month: 1, year: 2019, amountUsd: 888 },
    ];
    const r = buildBucketMixByYear(records, "INVOICE");
    expect(r).toEqual([
      { year: 2024, mano_obra: 0, cr: 200, equipos: 1000, operacion: 0 },
      { year: 2025, mano_obra: 500, cr: 0, equipos: 0, operacion: 300 },
    ]);
  });
});

describe("buildClientPareto", () => {
  it("suma por cliente, ordena desc, % acumulado (último 100%)", () => {
    const rows: CustomerYearRow[] = [
      { customer: "A", year: 2025, ventas: 60 },
      { customer: "B", year: 2025, ventas: 30 },
      { customer: "C", year: 2025, ventas: 10 },
    ];
    const p = buildClientPareto(rows);
    expect(p.map((x) => x.customer)).toEqual(["A", "B", "C"]);
    expect(p[0].cumPct).toBeCloseTo(60);
    expect(p[1].cumPct).toBeCloseTo(90);
    expect(p[2].cumPct).toBeCloseTo(100);
  });
});

describe("topItems", () => {
  const rows: ItemSalesRow[] = [
    { itemId: "1", sku: "X", nombre: "uno", categoria: null, cantidad: 5, importe: 10 },
    { itemId: "2", sku: "Y", nombre: "dos", categoria: null, cantidad: 1, importe: 30 },
    { itemId: "3", sku: "Z", nombre: "tres", categoria: null, cantidad: 9, importe: 20 },
  ];
  it("ordena por importe y recorta", () => {
    expect(topItems(rows, "importe", 2).map((r) => r.sku)).toEqual(["Y", "Z"]);
  });
  it("ordena por cantidad", () => {
    expect(topItems(rows, "cantidad", 2).map((r) => r.sku)).toEqual(["Z", "X"]);
  });
});

describe("buildItemPareto", () => {
  it("ordena desc + cumPct (último 100%)", () => {
    const rows: ItemSalesRow[] = [
      { itemId: "1", sku: "A", nombre: "uno", categoria: null, cantidad: 1, importe: 60 },
      { itemId: "2", sku: "B", nombre: "dos", categoria: null, cantidad: 1, importe: 30 },
      { itemId: "3", sku: "C", nombre: "tres", categoria: null, cantidad: 1, importe: 10 },
    ];
    const p = buildItemPareto(rows);
    expect(p.map((x) => x.sku)).toEqual(["A", "B", "C"]);
    expect(p[0].cumPct).toBeCloseTo(60);
    expect(p[2].cumPct).toBeCloseTo(100);
  });
});

describe("buildBrandMix", () => {
  it("agrega por marca, null→Sin marca, orden desc", () => {
    const rows: CustomerItemRow[] = [
      { customer: "X", sku: "a", marca: "Horiba", nombre: "n", categoria: null, cantidad: 1, importe: 100 },
      { customer: "Y", sku: "b", marca: "Horiba", nombre: "n", categoria: null, cantidad: 1, importe: 50 },
      { customer: "Z", sku: "c", marca: null, nombre: "n", categoria: null, cantidad: 1, importe: 200 },
    ];
    expect(buildBrandMix(rows)).toEqual([
      { marca: "Sin marca", importe: 200 },
      { marca: "Horiba", importe: 150 },
    ]);
  });
});

describe("buildBucketByClient", () => {
  it("buckets por cliente + orden por total desc", () => {
    const rows: CustomerItemRow[] = [
      { customer: "A", sku: "1", marca: null, nombre: "n", categoria: "C&R EDM 180", cantidad: 1, importe: 100 },
      { customer: "A", sku: "2", marca: null, nombre: "n", categoria: "CAL PM", cantidad: 1, importe: 50 },
      { customer: "B", sku: "3", marca: null, nombre: "n", categoria: "EDM180 Series", cantidad: 1, importe: 500 },
    ];
    const b = buildBucketByClient(rows);
    expect(b.map((x) => x.customer)).toEqual(["B", "A"]);
    expect(b[1]).toEqual({ customer: "A", mano_obra: 50, cr: 100, equipos: 0, operacion: 0, total: 150 });
    expect(b[0].equipos).toBe(500);
  });
});

describe("buildNewVsRecurring", () => {
  it("particiona nuevos/recurrentes por firstYear y cuenta altas", () => {
    const rows: CustomerYearRow[] = [
      { customer: "A", year: 2021, ventas: 100 },
      { customer: "A", year: 2022, ventas: 200 },
      { customer: "B", year: 2022, ventas: 50 },
      { customer: "C", year: 2023, ventas: 500 },
      { customer: "A", year: 2023, ventas: 10 },
    ];
    const r = buildNewVsRecurring(rows);
    expect(r.map((x) => x.year)).toEqual([2021, 2022, 2023]);
    expect(r[0]).toEqual({ year: 2021, nuevos: 100, recurrentes: 0, countNuevos: 1 });
    expect(r[1]).toEqual({ year: 2022, nuevos: 50, recurrentes: 200, countNuevos: 1 });
    expect(r[2]).toEqual({ year: 2023, nuevos: 500, recurrentes: 10, countNuevos: 1 });
  });

  it("cliente con hueco sigue siendo recurrente al volver", () => {
    const rows: CustomerYearRow[] = [
      { customer: "A", year: 2021, ventas: 100 },
      { customer: "A", year: 2023, ventas: 300 },
    ];
    const r = buildNewVsRecurring(rows);
    expect(r.map((x) => x.year)).toEqual([2021, 2023]);
    expect(r[1]).toEqual({ year: 2023, nuevos: 0, recurrentes: 300, countNuevos: 0 });
  });
});

describe("buildMonthHeatmap", () => {
  it("agrega por mes (índice mes-1), total y orden desc", () => {
    const rows: CustomerMonthRow[] = [
      { customer: "A", mes: 1, importe: 100 },
      { customer: "A", mes: 3, importe: 50 },
      { customer: "B", mes: 12, importe: 500 },
    ];
    const h = buildMonthHeatmap(rows);
    expect(h.map((x) => x.customer)).toEqual(["B", "A"]);
    expect(h[1].months).toHaveLength(12);
    expect(h[1].months[0]).toBe(100);
    expect(h[1].months[2]).toBe(50);
    expect(h[1].total).toBe(150);
    expect(h[0].months[11]).toBe(500);
  });
});

describe("buildBucketSeason", () => {
  it("agrega a bucket por mes, 12 filas, meses vacíos en 0", () => {
    const rows: CategoryMonthRow[] = [
      { mes: 1, categoria: "CAL PM", importe: 100 },     // mano_obra
      { mes: 1, categoria: "C&R EDM 180", importe: 50 }, // cr
      { mes: 3, categoria: "EDM180", importe: 200 },     // equipos (default)
    ];
    const s = buildBucketSeason(rows);
    expect(s).toHaveLength(12);
    expect(s[0]).toEqual({ mes: 1, mano_obra: 100, cr: 50, equipos: 0, operacion: 0 });
    expect(s[1]).toEqual({ mes: 2, mano_obra: 0, cr: 0, equipos: 0, operacion: 0 });
    expect(s[2]).toEqual({ mes: 3, mano_obra: 0, cr: 0, equipos: 200, operacion: 0 });
  });
});
