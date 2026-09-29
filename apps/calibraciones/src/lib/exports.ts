/**
 * Data exports (CSV and XLSX) of one verification and of the lists.
 *
 * Exports are DATA, not display (DECISIONS D-039): numbers keep full float64
 * precision. CSV writes them with comma decimal; XLSX stores them as numbers
 * with a display format (slope 0.00000, intercept 0.000, ppb/% 0.00), so the
 * sheet shows the §10 rounding without losing digits.
 *
 * CSV: `;` separator, comma decimal, UTF-8 with BOM, CRLF — the same dialect
 * as the point import template (D-029). The per-verification points CSV starts
 * with the template columns, so it can be imported again as-is.
 */
import type { EquipmentWithValidity, ExpirationItem, VerificationDetail, VerificationListItem } from '../types';
import { CSV_TEMPLATE_HEADER } from './csv';
import { APPLICATION_LABEL, BUCKET, EQUIPMENT_TYPE_LABEL, KIND_LABEL, RESULT, ROUTE_LABEL, STATUS } from './domain';
import { formatDate, formatInputNumber } from './format';
import { procedureFor } from './procedure';
import { formatFactors, type ReportContext } from './report';

export type Cell = string | number | boolean | null;

export interface SheetSpec {
  name: string;
  header: string[];
  rows: Cell[][];
  /** Excel number format per column (numbers only), e.g. '0.00000'. */
  formats?: (string | null)[];
  /** Per-row format (key/value sheets such as Resumen); wins over the column format. */
  rowFormats?: (string | null)[];
}

export const FMT = { slope: '0.00000', intercept: '0.000', ppb: '0.00', pct: '0.00', int: '0' } as const;

function csvCell(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (typeof c === 'boolean') return c ? 'Sí' : 'No';
  const s = typeof c === 'number' ? formatInputNumber(c) : c;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly Cell[][]): string {
  const lines = [header.map(csvCell).join(';'), ...rows.map((r) => r.map(csvCell).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

export const sheetToCsv = (s: SheetSpec) => toCsv(s.header, s.rows);

// ── One verification ───────────────────────────────────────────────────────

export function verificationPointsCsv(v: VerificationDetail): string {
  const header = [...CSV_TEMPLATE_HEADER, 'x_std_ppb', 'tipo_diferencia', 'diferencia', 'cumple'];
  const rows: Cell[][] = v.cycles.flatMap((c) =>
    c.points.map((p) => [
      c.index,
      p.order,
      p.setpointPpb,
      p.xPpb,
      p.yPpb,
      p.cellTempXC ?? null,
      p.cellTempYC ?? null,
      p.cellPressXTorr ?? null,
      p.cellPressYTorr ?? null,
      p.xStdPpb,
      p.diffType,
      p.diffValue,
      p.pass,
    ]),
  );
  return toCsv(header, rows);
}

export function verificationSheets(ctx: ReportContext): SheetSpec[] {
  const v = ctx.verification;
  const e = v.evaluation;
  const ref = ctx.reference;
  const cand = ctx.candidate;

  const summary: [string, Cell, string | null][] = [
    ['Registro', v.id, null],
    ['Versión', v.version, FMT.int],
    ['Procedimiento', procedureFor(ref, cand).code, null],
    ['Estado', STATUS[v.status].label, null],
    ['Tipo', KIND_LABEL[v.kind], null],
    ['Fecha', formatDate(v.verificationDate), null],
    ['Lugar', v.location, null],
    ['Patrón (x)', ref ? `${ref.internalCode} · ${ref.brand} ${ref.model} · S/N ${ref.serial}` : null, null],
    ['Nivel del patrón', ref?.currentLevel ?? null, FMT.int],
    ['Candidato (y)', cand ? `${cand.internalCode} · ${cand.brand} ${cand.model} · S/N ${cand.serial}` : null, null],
    ['Opción de trazabilidad', v.traceabilityOption, FMT.int],
    ['Ruta del patrón', v.referenceRoute ? ROUTE_LABEL[v.referenceRoute] : null, null],
    ['Ruta del candidato', v.candidateRoute ? ROUTE_LABEL[v.candidateRoute] : null, null],
    ['Factores internos antes', formatFactors(v.internalFactorsBefore), null],
    ['Factores internos después', formatFactors(v.internalFactorsAfter), null],
    ['Temperatura inicio (°C)', v.labTempStartC, null],
    ['Temperatura fin (°C)', v.labTempEndC, null],
    ['Humedad relativa (%)', v.labRhPct, null],
    ['Presión barométrica (torr)', v.baroPressureTorr, null],
    ['Flujo total (L/min)', v.totalFlowSlpm, null],
    ['Técnico', v.technicianEmail, null],
    ['Aprobó', v.approvedByEmail, null],
    ['Resultado', v.overallResult ? RESULT[v.overallResult].label : null, null],
    ['m prom.', v.meanSlope, FMT.slope],
    ['b prom. (ppb)', v.meanIntercept, FMT.intercept],
    ['SDm', v.sdSlope, FMT.slope],
    ['SDb (ppb)', v.sdIntercept, FMT.intercept],
    ['Rango verificado (ppb)', v.maxVerifiedPointPpb, FMT.ppb],
    ['Nivel asignado', v.overallResult === 'CONFORME' ? v.candidateLevel : null, FMT.int],
    ['Vigente hasta', formatDate(v.validUntil), null],
    ['Reverificación antes de', v.reverificationDue ? formatDate(v.reverificationDue) : null, null],
    ['Ec. 10 aplicada a x', e?.eq10Applied ?? null, null],
    ['Motivo de la versión', v.changeReason, null],
    ['Versión del motor', v.engineVersion, null],
    ['Versión de límites', v.limitsVersion, null],
  ];
  const resumen: SheetSpec = {
    name: 'Resumen',
    header: ['Campo', 'Valor'],
    rows: summary.map(([k, val]) => [k, val]),
    rowFormats: summary.map(([, , f]) => f),
  };

  const puntos: SheetSpec = {
    name: 'Puntos',
    header: ['Ciclo', 'Orden', 'Setpoint (ppb)', 'x leído (ppb)', 'x patrón (ppb)', 'y (ppb)', 'T celda x (°C)', 'T celda y (°C)', 'P celda x (torr)', 'P celda y (torr)', 'Tipo de diferencia', 'Diferencia', 'Cumple'],
    formats: [FMT.int, FMT.int, FMT.ppb, FMT.ppb, FMT.ppb, FMT.ppb, null, null, null, null, null, FMT.pct, null],
    rows: v.cycles.flatMap((c) =>
      c.points.map((p) => [
        c.index,
        p.order,
        p.setpointPpb,
        p.xPpb,
        p.xStdPpb,
        p.yPpb,
        p.cellTempXC ?? null,
        p.cellTempYC ?? null,
        p.cellPressXTorr ?? null,
        p.cellPressYTorr ?? null,
        p.diffType === 'PERCENT' ? '%Diff' : p.diffType === 'ABS_PPB' ? 'AbsDiff (ppb)' : null,
        p.diffValue,
        p.pass,
      ]),
    ),
  };

  const ciclos: SheetSpec = {
    name: 'Ciclos',
    header: ['Ciclo', 'Pendiente m', 'Intercepto b (ppb)', 'r²', 'Cumple', 'Error de regresión'],
    formats: [FMT.int, FMT.slope, FMT.intercept, FMT.slope, null, null],
    rows: v.cycles.map((c) => [c.index, c.slope, c.intercept, c.r2, c.pass, c.regressionError]),
  };

  const reglas: SheetSpec = {
    name: 'Reglas',
    header: ['Regla', 'Criterio', 'Ciclo', 'Punto', 'Valor', 'Límite', 'Cumple', 'Informativa', 'Referencia normativa'],
    formats: [null, null, FMT.int, FMT.int, null, null, null, null, null],
    rows: (e?.rules ?? []).map((r) => [
      r.id,
      r.textEs,
      r.cycleIndex ?? null,
      r.pointOrder ?? null,
      r.value,
      r.limitText,
      r.pass,
      r.informative,
      r.reference,
    ]),
  };

  return [resumen, puntos, ciclos, reglas];
}

// ── Lists ──────────────────────────────────────────────────────────────────

export function equipmentSheet(items: readonly EquipmentWithValidity[]): SheetSpec {
  return {
    name: 'Equipos',
    header: ['Código interno', 'Marca', 'Modelo', 'Serie', 'Tipo', 'Fotómetro', 'Aplicación', 'Nivel', 'Vigencia', 'Vence', 'Días restantes', 'Certificado', 'Vence certificado', 'Activo', 'Notas'],
    formats: [null, null, null, null, null, null, null, FMT.int, null, null, FMT.int, null, null, null, null],
    rows: items.map((e) => [
      e.internalCode,
      e.brand,
      e.model,
      e.serial,
      EQUIPMENT_TYPE_LABEL[e.type],
      e.hasPhotometer,
      APPLICATION_LABEL[e.application],
      e.currentLevel,
      BUCKET[e.validity.bucket].label,
      e.validity.dueDate ? formatDate(e.validity.dueDate) : null,
      e.validity.daysLeft,
      e.certificateNumber,
      e.certificateValidUntil ? formatDate(e.certificateValidUntil) : null,
      e.active,
      e.notes,
    ]),
  };
}

export function verificationListSheet(items: readonly VerificationListItem[]): SheetSpec {
  return {
    name: 'Verificaciones',
    header: ['Fecha', 'Tipo', 'Patrón', 'Candidato', 'Versión', 'Estado', 'Resultado', 'm prom.', 'b prom. (ppb)', 'SDm', 'SDb (ppb)', 'Rango verificado (ppb)', 'Nivel asignado', 'Vigente hasta', 'Técnico', 'Aprobó', 'Motor', 'Límites', 'Registro'],
    formats: [null, null, null, null, FMT.int, null, null, FMT.slope, FMT.intercept, FMT.slope, FMT.intercept, FMT.ppb, FMT.int, null, null, null, null, null, null],
    rows: items.map((v) => [
      formatDate(v.verificationDate),
      KIND_LABEL[v.kind],
      v.referenceInternalCode,
      v.candidateInternalCode,
      v.version,
      STATUS[v.status].label,
      v.overallResult ? RESULT[v.overallResult].label : null,
      v.meanSlope,
      v.meanIntercept,
      v.sdSlope,
      v.sdIntercept,
      v.maxVerifiedPointPpb,
      v.overallResult === 'CONFORME' ? v.candidateLevel : null,
      v.validUntil ? formatDate(v.validUntil) : null,
      v.technicianEmail,
      v.approvedByEmail,
      v.engineVersion,
      v.limitsVersion,
      v.id,
    ]),
  };
}

export function expirationsSheet(items: readonly ExpirationItem[]): SheetSpec {
  return {
    name: 'Vencimientos',
    header: ['Código interno', 'Marca', 'Modelo', 'Nivel', 'Aplicación', 'Vigente hasta', 'Reverificación antes de', 'Vencimiento', 'Días restantes', 'Estado'],
    formats: [null, null, null, FMT.int, null, null, null, null, FMT.int, null],
    rows: items.map((i) => [
      i.internalCode,
      i.brand,
      i.model,
      i.currentLevel,
      APPLICATION_LABEL[i.application],
      i.validUntil ? formatDate(i.validUntil) : null,
      i.reverificationDue ? formatDate(i.reverificationDue) : null,
      i.dueDate ? formatDate(i.dueDate) : null,
      i.daysLeft,
      BUCKET[i.bucket].label,
    ]),
  };
}
