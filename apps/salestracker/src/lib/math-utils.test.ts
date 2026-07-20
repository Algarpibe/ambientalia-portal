import { describe, it, expect } from "vitest";
import { calculateSeasonalityFactors } from "./math-utils";

describe("calculateSeasonalityFactors", () => {
  it("los factores suman 1", () => {
    const f = calculateSeasonalityFactors([[10, 20, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0]]);
    expect(f.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
  it("sin pesos = equiponderado (retrocompatible)", () => {
    const ene = [12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const dic = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12];
    const f = calculateSeasonalityFactors([ene, dic]);
    expect(f[0]).toBeCloseTo(0.5);
    expect(f[11]).toBeCloseTo(0.5);
  });
  it("pesos por recencia dan más peso al año reciente", () => {
    const reciente = [12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const viejo = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12];
    const f = calculateSeasonalityFactors([reciente, viejo], [3, 1]);
    expect(f[0]).toBeCloseTo(0.75);
    expect(f[11]).toBeCloseTo(0.25);
  });
});
