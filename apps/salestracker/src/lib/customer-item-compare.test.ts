import { describe, it, expect } from "vitest";
import { buildCustomerItemCompare } from "./customer-item-compare";
import type { CustomerItemRow } from "../api";

const A: CustomerItemRow[] = [
  { customer: "AGQ", sku: "1", marca: "M", nombre: "uno", categoria: "C", cantidad: 1, importe: 120 },
  { customer: "AGQ", sku: "2", marca: null, nombre: "dos", categoria: null, cantidad: 1, importe: 100 },
  { customer: "Beta", sku: "9", marca: null, nombre: "n", categoria: null, cantidad: 1, importe: 300 },
];
const B: CustomerItemRow[] = [
  { customer: "AGQ", sku: "1", marca: "M", nombre: "uno", categoria: "C", cantidad: 1, importe: 100 },
  { customer: "AGQ", sku: "3", marca: null, nombre: "tres", categoria: null, cantidad: 1, importe: 50 },
];

describe("buildCustomerItemCompare", () => {
  it("une por (cliente, sku), agrupa, totales y orden", () => {
    const groups = buildCustomerItemCompare(A, B);
    expect(groups.map((g) => g.customer)).toEqual(["AGQ", "Beta"]);
    const agq = groups[0];
    expect(agq.totalA).toBe(220);
    expect(agq.totalB).toBe(150);
    const byKey = Object.fromEntries(agq.items.map((it) => [it.sku ?? it.nombre, it]));
    expect(byKey["1"]).toMatchObject({ importeA: 120, importeB: 100, deltaPct: 0.2 });
    expect(byKey["2"]).toMatchObject({ importeA: 100, importeB: 0, deltaPct: null });
    expect(byKey["3"]).toMatchObject({ importeA: 0, importeB: 50, nombre: "tres", deltaPct: -1 });
    const beta = groups[1];
    expect(beta.totalA).toBe(300);
    expect(beta.totalB).toBe(0);
    expect(beta.deltaPct).toBeNull();
  });
});
