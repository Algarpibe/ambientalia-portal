import { calculateSeasonalityFactors, calculateRunRate } from './math-utils';

export interface ForecastNow {
  monthIdx: number;   // 0-11
  day: number;        // día del mes
  daysInMonth: number;
}

export interface ForecastInput {
  currentYearMonthly: number[]; // 12, actuals del año A
  lastYearMonthly: number[];    // 12, actuals del año B (anterior)
  historicalMatrix: number[][]; // años recientes primero
  weights: number[];            // alineado a historicalMatrix (p.ej. [3,2,1])
  now: ForecastNow;
  isCurrentActualYear: boolean; // año A === año de calendario actual
}

export interface ProjectionStat {
  value: number;
  low: number;
  high: number;
  actual: number;    // MTD (mes) / YTD (año)
  reference: number; // año anterior (mismo mes / total)
  deltaPct: number | null; // ritmo vs mismo periodo año anterior
  onTrack: boolean;
}

export interface ForecastResult {
  monthlyForecast: number[]; // 12 (línea del chart)
  month: ProjectionStat;
  year: ProjectionStat;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const r0 = (x: number) => Math.round(x);

export function computeForecast(input: ForecastInput): ForecastResult {
  const { currentYearMonthly, lastYearMonthly, historicalMatrix, weights, now, isCurrentActualYear } = input;
  const { monthIdx, day, daysInMonth } = now;

  const factors = calculateSeasonalityFactors(historicalMatrix, weights); // (B)

  const w = isCurrentActualYear ? clamp01(daysInMonth > 0 ? day / daysInMonth : 1) : 1;
  const completedCount = isCurrentActualYear ? monthIdx : 12;
  const completedActual = sum(currentYearMonthly.slice(0, completedCount));
  const lastYearCompleted = sum(lastYearMonthly.slice(0, completedCount));
  const yoyPace = lastYearCompleted > 0 ? completedActual / lastYearCompleted : 1;

  // --- (A) MES actual ---
  const mtd = currentYearMonthly[monthIdx] || 0;
  const lastYearThisMonth = lastYearMonthly[monthIdx] || 0;
  let monthValue: number;
  if (isCurrentActualYear) {
    const runRate = calculateRunRate(mtd, day, daysInMonth);
    const expected = lastYearThisMonth > 0 ? lastYearThisMonth * yoyPace : runRate;
    monthValue = w * runRate + (1 - w) * expected;
  } else {
    monthValue = mtd;
  }
  const monthRef = lastYearThisMonth * w;
  const monthDelta = monthRef > 0 ? (mtd - monthRef) / monthRef : null;
  const monthUnc = isCurrentActualYear ? (1 - w) * 0.5 : 0; // (E)
  const monthStat: ProjectionStat = {
    value: r0(monthValue),
    low: r0(monthValue * (1 - monthUnc)),
    high: r0(monthValue * (1 + monthUnc)),
    actual: r0(mtd),
    reference: r0(lastYearThisMonth),
    deltaPct: monthDelta,
    onTrack: monthDelta === null ? monthValue >= lastYearThisMonth : monthDelta >= 0,
  };

  // --- (C) AÑO ---
  const knownTotal = completedActual + (isCurrentActualYear ? monthValue : 0);
  const knownSeasonality = isCurrentActualYear ? sum(factors.slice(0, monthIdx + 1)) : 1;
  const seasonalYearEst = knownSeasonality > 0 ? knownTotal / knownSeasonality : knownTotal;
  const lastYearTotal = sum(lastYearMonthly);
  const paceYearEst = lastYearTotal > 0 ? lastYearTotal * yoyPace : seasonalYearEst;
  const wy = clamp01(knownSeasonality);
  const yearEstimate = isCurrentActualYear ? wy * seasonalYearEst + (1 - wy) * paceYearEst : completedActual;

  const monthlyForecast = factors.map((f, i) => {
    if (!isCurrentActualYear) return currentYearMonthly[i] || 0;
    if (i < monthIdx) return currentYearMonthly[i] || 0;
    if (i === monthIdx) return monthValue;
    return yearEstimate * f;
  });
  const yearValue = sum(monthlyForecast);

  // (E) banda: dispersión entre las formas históricas
  const estimates: number[] = [yearValue];
  if (isCurrentActualYear) {
    for (const yearData of historicalMatrix) {
      const t = sum(yearData);
      if (t <= 0) continue;
      const cumShare = sum(yearData.slice(0, monthIdx + 1)) / t;
      if (cumShare > 0) estimates.push(knownTotal / cumShare);
    }
  }
  const yearLow = Math.min(...estimates);
  const yearHigh = Math.max(...estimates);

  // (D) ritmo del año vs mismo periodo del año anterior (prorrateado al día)
  const ytdActual = completedActual + (isCurrentActualYear ? mtd : 0);
  const lastYearToDate = lastYearCompleted + (isCurrentActualYear ? lastYearThisMonth * w : 0);
  const yearDelta = lastYearToDate > 0 ? (ytdActual - lastYearToDate) / lastYearToDate : null;

  const yearStat: ProjectionStat = {
    value: r0(yearValue),
    low: r0(yearLow),
    high: r0(yearHigh),
    actual: r0(ytdActual),
    reference: r0(lastYearTotal),
    deltaPct: yearDelta,
    onTrack: yearDelta === null ? yearValue >= lastYearTotal : yearDelta >= 0,
  };

  return { monthlyForecast, month: monthStat, year: yearStat };
}
