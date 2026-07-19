import { describe, it, expect } from "vitest";
import { computeDelta, formatDeltaPct } from "./compare";

describe("computeDelta", () => {
  it("a>b → positivo", () => { expect(computeDelta(120, 100)).toEqual({ delta: 20, deltaPct: 0.2 }); });
  it("b=0 → deltaPct null", () => { expect(computeDelta(50, 0)).toEqual({ delta: 50, deltaPct: null }); });
  it("a=b → 0", () => { expect(computeDelta(100, 100)).toEqual({ delta: 0, deltaPct: 0 }); });
});

describe("formatDeltaPct", () => {
  it("positivo", () => { expect(formatDeltaPct(0.2)).toBe("+20.0%"); });
  it("negativo", () => { expect(formatDeltaPct(-0.08)).toBe("−8.0%"); });
  it("cero", () => { expect(formatDeltaPct(0)).toBe("0.0%"); });
  it("null → guion", () => { expect(formatDeltaPct(null)).toBe("—"); });
});
