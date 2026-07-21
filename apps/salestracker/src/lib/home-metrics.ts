import type { SalesRow, RecordType } from '../api';
import { MONTHS } from './format';

export interface HomeKpis {
  facturado: number; facturadoPrev: number;   // INVOICE año / año-1
  ordenes: number; ordenesPrev: number;        // SALES_ORDER año / año-1
  backlog: number;                             // BACKLOG año
  ejecucion: number; ejecucionPrev: number;    // 0..100 = facturado/ordenes*100 (0 si ordenes 0)
}
export interface MonthPoint { mes: string; ov: number; fac: number }         // 12 (Ene..Dic)
export interface CumPoint { mes: string; actual: number; previo: number }    // 12 (INVOICE acumulado)
export interface ExecPoint { mes: string; pct: number }                      // 12 (fac/ov*100, 0 si ov 0)
export interface CatSlice { categoria: string; importe: number }             // topN + 'Otros'

/** Suma de amountUsd para un (año, tipo). */
const sumBy = (rows: SalesRow[], year: number, type: RecordType): number =>
  rows.reduce((s, r) => (r.year === year && r.recordType === type ? s + r.amountUsd : s), 0);

/** KPIs de portada: facturado/órdenes/backlog del año + previos (año-1) + % ejecución. */
export function buildHomeKpis(rows: SalesRow[], year: number): HomeKpis {
  const facturado = sumBy(rows, year, 'INVOICE');
  const facturadoPrev = sumBy(rows, year - 1, 'INVOICE');
  const ordenes = sumBy(rows, year, 'SALES_ORDER');
  const ordenesPrev = sumBy(rows, year - 1, 'SALES_ORDER');
  const backlog = sumBy(rows, year, 'BACKLOG');
  return {
    facturado,
    facturadoPrev,
    ordenes,
    ordenesPrev,
    backlog,
    ejecucion: ordenes > 0 ? (facturado / ordenes) * 100 : 0,
    ejecucionPrev: ordenesPrev > 0 ? (facturadoPrev / ordenesPrev) * 100 : 0,
  };
}

/** 12 puntos (Ene..Dic) con OV (SALES_ORDER) y FAC (INVOICE) del año. */
export function buildMonthlyOvFac(rows: SalesRow[], year: number): MonthPoint[] {
  const ov = new Array<number>(12).fill(0);
  const fac = new Array<number>(12).fill(0);
  for (const r of rows) {
    if (r.year !== year || r.month < 1 || r.month > 12) continue;
    if (r.recordType === 'SALES_ORDER') ov[r.month - 1] += r.amountUsd;
    else if (r.recordType === 'INVOICE') fac[r.month - 1] += r.amountUsd;
  }
  return MONTHS.map((mes, i) => ({ mes, ov: ov[i], fac: fac[i] }));
}

/** 12 puntos con INVOICE acumulado del año (actual) y del año-1 (previo). */
export function buildCumulativeYoY(rows: SalesRow[], year: number): CumPoint[] {
  const actualMes = new Array<number>(12).fill(0);
  const previoMes = new Array<number>(12).fill(0);
  for (const r of rows) {
    if (r.recordType !== 'INVOICE' || r.month < 1 || r.month > 12) continue;
    if (r.year === year) actualMes[r.month - 1] += r.amountUsd;
    else if (r.year === year - 1) previoMes[r.month - 1] += r.amountUsd;
  }
  const out: CumPoint[] = [];
  let accA = 0;
  let accP = 0;
  for (let i = 0; i < 12; i++) {
    accA += actualMes[i];
    accP += previoMes[i];
    out.push({ mes: MONTHS[i], actual: accA, previo: accP });
  }
  return out;
}

/** 12 puntos con % ejecución mensual (FAC/OV*100; 0 si OV es 0, nunca divide por cero). */
export function buildExecutionMonthly(rows: SalesRow[], year: number): ExecPoint[] {
  const monthly = buildMonthlyOvFac(rows, year);
  return monthly.map(({ mes, ov, fac }) => ({
    mes,
    pct: ov > 0 ? (fac / ov) * 100 : 0,
  }));
}

/** Mix de INVOICE del año por categoría: topN desc + 'Otros' (sólo si remanente > 0). */
export function buildCategoryMix(rows: SalesRow[], year: number, topN = 8): CatSlice[] {
  const acc = new Map<string, number>();
  for (const r of rows) {
    if (r.year !== year || r.recordType !== 'INVOICE') continue;
    acc.set(r.categoryName, (acc.get(r.categoryName) ?? 0) + r.amountUsd);
  }
  const ordenadas = [...acc.entries()]
    .map(([categoria, importe]) => ({ categoria, importe }))
    .sort((a, b) => b.importe - a.importe || a.categoria.localeCompare(b.categoria));
  const top = ordenadas.slice(0, topN);
  const resto = ordenadas.slice(topN).reduce((s, c) => s + c.importe, 0);
  if (resto > 0) top.push({ categoria: 'Otros', importe: resto });
  return top;
}
