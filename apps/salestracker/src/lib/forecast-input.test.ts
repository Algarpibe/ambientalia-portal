import { describe, it, expect } from "vitest";
import type { SalesRow } from "../api";
import { monthlyByYear, buildForecastInput } from "./forecast-input";

const row = (year: number, month: number, amountUsd: number, recordType: SalesRow["recordType"] = "INVOICE"): SalesRow => ({
  categoryName: "X",
  recordType,
  month,
  year,
  amountUsd,
});

describe("monthlyByYear", () => {
  it("filtra por año+tipo y suma por mes (índice mes-1)", () => {
    const rows: SalesRow[] = [
      row(2026, 1, 100),
      row(2026, 1, 50),  // mismo mes → suma
      row(2026, 12, 30),
      row(2025, 1, 999), // otro año → ignora
      row(2026, 1, 7, "SALES_ORDER"), // otro tipo → ignora
    ];
    const m = monthlyByYear(rows, 2026, "INVOICE");
    expect(m).toHaveLength(12);
    expect(m[0]).toBe(150);  // enero (mes 1 → índice 0)
    expect(m[11]).toBe(30);  // diciembre (mes 12 → índice 11)
    expect(m[5]).toBe(0);
  });

  it("ignora meses fuera de rango (0 o 13)", () => {
    const rows: SalesRow[] = [row(2026, 0, 100), row(2026, 13, 200), row(2026, 6, 40)];
    const m = monthlyByYear(rows, 2026, "INVOICE");
    expect(m.reduce((a, b) => a + b, 0)).toBe(40);
    expect(m[5]).toBe(40);
  });
});

describe("buildForecastInput", () => {
  const now = new Date(2026, 5, 15); // 15-jun-2026 (monthIdx 5)
  const rows: SalesRow[] = [
    row(2026, 1, 100),
    row(2025, 3, 200),
    row(2024, 6, 300),
    row(2023, 12, 400),
    row(2022, 1, 500), // fuera de la ventana histórica (A-3..A) → ignorado
  ];

  it("ensambla currentYear/lastYear/historicalMatrix con la ventana y pesos correctos", () => {
    const input = buildForecastInput(rows, { yearA: 2026, tipo: "INVOICE", now });
    // año A = 2026
    expect(input.currentYearMonthly[0]).toBe(100);
    // año A-1 = 2025
    expect(input.lastYearMonthly[2]).toBe(200);
    // matriz histórica [2025, 2024, 2023], cada uno 12 meses
    expect(input.historicalMatrix).toHaveLength(3);
    expect(input.historicalMatrix.every((y) => y.length === 12)).toBe(true);
    expect(input.historicalMatrix[0][2]).toBe(200); // 2025 mar
    expect(input.historicalMatrix[1][5]).toBe(300); // 2024 jun
    expect(input.historicalMatrix[2][11]).toBe(400); // 2023 dic
    expect(input.weights).toEqual([3, 2, 1]);
  });

  it("deriva now (monthIdx/day/daysInMonth) e isCurrentActualYear", () => {
    const input = buildForecastInput(rows, { yearA: 2026, tipo: "INVOICE", now });
    expect(input.now.monthIdx).toBe(5);
    expect(input.now.day).toBe(15);
    expect(input.now.daysInMonth).toBe(30); // junio tiene 30 días
    expect(input.isCurrentActualYear).toBe(true);
  });

  it("isCurrentActualYear=false cuando el año A no es el año del calendario now", () => {
    const input = buildForecastInput(rows, { yearA: 2025, tipo: "INVOICE", now });
    expect(input.isCurrentActualYear).toBe(false);
  });
});
