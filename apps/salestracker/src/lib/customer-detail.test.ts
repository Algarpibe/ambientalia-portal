import { describe, it, expect } from "vitest";
import {
  customerYearSeries, customerFirstYear, customerTotalVentas,
  customerBuckets, customerTopItems, customerMonths, customerMarginKpi,
  customerHref,
} from "./customer-detail";
import type { CustomerYearRow, CustomerItemRow, CustomerMonthRow, MarginCustomerRow } from "../api";

const years: CustomerYearRow[] = [
  { customer: "A", year: 2022, ventas: 100 },
  { customer: "A", year: 2021, ventas: 50 },
  { customer: "B", year: 2022, ventas: 999 },
  { customer: "A", year: 2023, ventas: 0 },
];

describe("customerYearSeries", () => {
  it("filtra al cliente y ordena por año", () => {
    expect(customerYearSeries(years, "A")).toEqual([
      { year: 2021, ventas: 50 }, { year: 2022, ventas: 100 }, { year: 2023, ventas: 0 },
    ]);
  });
});
describe("customerFirstYear", () => {
  it("min año con ventas>0", () => { expect(customerFirstYear(years, "A")).toBe(2021); });
  it("null si no hay ventas", () => { expect(customerFirstYear(years, "Z")).toBeNull(); });
});
describe("customerTotalVentas", () => {
  it("suma sus años", () => { expect(customerTotalVentas(years, "A")).toBe(150); });
});

const items: CustomerItemRow[] = [
  { customer: "A", sku: "1", marca: null, nombre: "uno", categoria: "C&R EDM 180", cantidad: 1, importe: 100 },
  { customer: "A", sku: "2", marca: null, nombre: "dos", categoria: "CAL PM", cantidad: 1, importe: 40 },
  { customer: "A", sku: "3", marca: null, nombre: "tres", categoria: "EDM180", cantidad: 1, importe: 200 },
  { customer: "B", sku: "9", marca: null, nombre: "otro", categoria: null, cantidad: 1, importe: 999 },
];

describe("customerBuckets", () => {
  it("suma por bucket del cliente", () => {
    expect(customerBuckets(items, "A")).toEqual({ mano_obra: 40, cr: 100, equipos: 200, operacion: 0, total: 340 });
  });
});
describe("customerTopItems", () => {
  it("orden desc + top n", () => {
    expect(customerTopItems(items, "A", 2)).toEqual([
      { label: "tres", sku: "3", importe: 200 }, { label: "uno", sku: "1", importe: 100 },
    ]);
  });
});

const months: CustomerMonthRow[] = [
  { customer: "A", mes: 1, importe: 100 }, { customer: "A", mes: 3, importe: 50 }, { customer: "B", mes: 6, importe: 999 },
];
describe("customerMonths", () => {
  it("array 12, índice mes-1", () => {
    const m = customerMonths(months, "A");
    expect(m).toHaveLength(12);
    expect(m[0]).toBe(100); expect(m[2]).toBe(50); expect(m[5]).toBe(0);
  });
});

const marg: MarginCustomerRow[] = [{ customer: "A", ventas: 100, costo: 40 }];
describe("customerMarginKpi", () => {
  it("find + deriveMargin", () => {
    expect(customerMarginKpi(marg, "A")).toEqual({ ventas: 100, costo: 40, margen: 60, margenPct: 60 });
  });
  it("cliente inexistente → 0", () => {
    expect(customerMarginKpi(marg, "Z")).toEqual({ ventas: 0, costo: 0, margen: 0, margenPct: 0 });
  });
});

describe("customerHref", () => {
  it("codifica espacios y caracteres especiales", () => {
    expect(customerHref("AGQ S.A.S.")).toBe("/clientes/AGQ%20S.A.S.");
    expect(customerHref("Endémica & Co")).toBe("/clientes/End%C3%A9mica%20%26%20Co");
  });
});
