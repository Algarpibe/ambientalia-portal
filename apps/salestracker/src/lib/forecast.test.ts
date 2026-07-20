import { describe, it, expect } from "vitest";
import { computeForecast, type ForecastInput } from "./forecast";

const arr = (obj: Record<number, number> = {}) => Array.from({ length: 12 }, (_, i) => obj[i] ?? 0);
// Año histórico uniforme (cada mes 100) → estacionalidad plana 1/12.
const flatHist = [Array.from({ length: 12 }, () => 100)];

function baseInput(over: Partial<ForecastInput>): ForecastInput {
  return {
    currentYearMonthly: arr(),
    lastYearMonthly: arr(),
    historicalMatrix: flatHist,
    weights: [1],
    now: { monthIdx: 0, day: 15, daysInMonth: 30 },
    isCurrentActualYear: true,
    ...over,
  };
}

describe("computeForecast — año (C): de-amplificación temprana", () => {
  it("un arranque de año fuerte NO se extrapola linealmente (blend hacia el ritmo)", () => {
    // Enero enorme (1200) con estacionalidad plana: la extrapolación estacional ingenua
    // daría ~1200×12 = 14400. El blend por ritmo (wy≈0.083 en enero) lo tempera muy por debajo.
    const cur = arr({ 0: 1200 });
    const prev = Array.from({ length: 12 }, () => 100); // año anterior uniforme (total 1200)
    const r = computeForecast(baseInput({
      currentYearMonthly: cur,
      lastYearMonthly: prev,
      now: { monthIdx: 0, day: 30, daysInMonth: 30 }, // fin de enero → w=1
    }));
    expect(r.year.value).toBeLessThan(6000);   // muy por debajo de la extrapolación ingenua (14400)
    expect(r.year.value).toBeGreaterThan(1200); // pero refleja el arranque fuerte
  });
});

describe("computeForecast — mes (A)", () => {
  it("a mitad de mes mezcla runRate y esperado 50/50", () => {
    // Ene MTD=50 en día 15/30 → runRate=100. Sin meses cerrados → pace=1 → esperado=Ene año prev=200.
    const r = computeForecast(baseInput({
      currentYearMonthly: arr({ 0: 50 }),
      lastYearMonthly: arr({ 0: 200 }),
      now: { monthIdx: 0, day: 15, daysInMonth: 30 },
    }));
    expect(r.month.value).toBe(150); // 0.5*100 + 0.5*200
  });
  it("a fin de mes el mes = runRate", () => {
    const r = computeForecast(baseInput({
      currentYearMonthly: arr({ 0: 90 }),
      lastYearMonthly: arr({ 0: 200 }),
      now: { monthIdx: 0, day: 30, daysInMonth: 30 },
    }));
    expect(r.month.value).toBe(90);
  });
});

describe("computeForecast — ritmo/On Track (D)", () => {
  it("YTD por delante del año anterior → onTrack y deltaPct>0", () => {
    const cur = Array.from({ length: 12 }, (_, i) => (i < 6 ? 100 : 0));  // 600 en meses 0..5
    const prev = Array.from({ length: 12 }, (_, i) => (i < 6 ? 80 : 0));  // 480
    const r = computeForecast(baseInput({
      currentYearMonthly: cur,
      lastYearMonthly: prev,
      now: { monthIdx: 6, day: 1, daysInMonth: 31 },
    }));
    expect(r.year.deltaPct).toBeCloseTo(0.25); // (600-480)/480
    expect(r.year.onTrack).toBe(true);
  });
});

describe("computeForecast — banda y redondeo (E)", () => {
  it("low ≤ value ≤ high y son enteros", () => {
    const r = computeForecast(baseInput({ currentYearMonthly: arr({ 0: 33 }), now: { monthIdx: 0, day: 10, daysInMonth: 30 } }));
    expect(Number.isInteger(r.year.value)).toBe(true);
    expect(Number.isInteger(r.year.low)).toBe(true);
    expect(r.year.low).toBeLessThanOrEqual(r.year.value);
    expect(r.year.high).toBeGreaterThanOrEqual(r.year.value);
  });
});

describe("computeForecast — año pasado", () => {
  it("isCurrentActualYear=false → sin proyección, value = suma actuals", () => {
    const cur = Array.from({ length: 12 }, () => 10); // 120
    const r = computeForecast(baseInput({ currentYearMonthly: cur, isCurrentActualYear: false }));
    expect(r.year.value).toBe(120);
  });
});
