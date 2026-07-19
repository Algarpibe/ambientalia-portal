import { describe, it, expect } from "vitest";
import { buildItemCompare } from "./item-compare";
import type { ItemSalesRow } from "../api";

const A: ItemSalesRow[] = [
  { itemId: "1", sku: "A1", nombre: "uno", categoria: "C", cantidad: 1, importe: 120 },
  { itemId: "2", sku: "A2", nombre: "dos", categoria: null, cantidad: 1, importe: 100 },
];
const B: ItemSalesRow[] = [
  { itemId: "1", sku: "A1", nombre: "uno", categoria: "C", cantidad: 1, importe: 100 },
  { itemId: "3", sku: "A3", nombre: "tres", categoria: null, cantidad: 1, importe: 50 },
];

describe("buildItemCompare", () => {
  it("une por itemId; solo-A y solo-B con 0; deltaPct", () => {
    const rows = buildItemCompare(A, B);
    const byId = Object.fromEntries(rows.map((r) => [r.itemId, r]));
    expect(byId["1"]).toMatchObject({ importeA: 120, importeB: 100, deltaPct: 0.2 });
    expect(byId["2"]).toMatchObject({ importeA: 100, importeB: 0, deltaPct: null }); // B=0 → null
    expect(byId["3"]).toMatchObject({ importeA: 0, importeB: 50, nombre: "tres", deltaPct: -1 });
    expect(rows).toHaveLength(3);
  });
});
