/**
 * View model of the verification report (procedures IN.5.5.3-XX / -YY,
 * Annex A), built from the STORED server result: the evaluation saved at
 * calculation time is authoritative, the browser never recalculates here.
 * Every value is already formatted per master prompt §10 (es-CO, slope 5,
 * intercept 3, %Diff 2, ppb 2). The PDF component only lays it out.
 *
 * Annex A has no field for the verified range, per-cycle date, Δm/Δb, rule
 * table or engine/limits versions; they are added (DECISIONS D-007, D-035).
 */
import type { InternalFactors, RuleResult } from '../engine';
import type { Equipment, Verification, VerificationDetail } from '../types';
import { KIND_LABEL, RESULT, ROUTE_LABEL, STATUS } from './domain';
import { DASH, formatDate, formatDiff, formatInputNumber, formatIntercept, formatNumber, formatPpb, formatSlope } from './format';
import { procedureFor, type ProcedureInfo } from './procedure';
import { chartSeries, formatRuleValue, summaryRules, type CycleSeries } from './results';

export const COMPANY = 'Ambientalia S.A.S.';
export const DRAFT_WATERMARK = 'BORRADOR – sin validez';
export const REJECTED_WATERMARK = 'RECHAZADA – sin validez';

export type Availability = { ok: true; watermark: string | null } | { ok: false; reason: string };

/** Only records with a stored server result: APPROVED clean, CALCULATED / REJECTED watermarked (D-035). */
export function reportAvailability(v: Pick<Verification, 'status' | 'evaluation'>): Availability {
  if (v.status === 'DRAFT' || !v.evaluation) {
    return { ok: false, reason: 'El informe se genera con el resultado del servidor: calcule la verificación primero.' };
  }
  if (v.status === 'APPROVED') return { ok: true, watermark: null };
  return { ok: true, watermark: v.status === 'REJECTED' ? REJECTED_WATERMARK : DRAFT_WATERMARK };
}

export interface Row {
  label: string;
  value: string;
}

export interface Check {
  limit: string;
  pass: boolean;
}

export interface ReportPointRow {
  label: string;
  setpoint: string;
  x: string;
  xStd: string;
  y: string;
  cellT: string;
  cellP: string;
  diff: string;
  pass: string;
}

export interface ReportCycle {
  index: number;
  date: string;
  rows: ReportPointRow[];
}

export interface SummaryRow {
  label: string;
  value: string;
  limit: string;
  pass: boolean | null;
}

export interface ReportModel {
  company: string;
  procedure: ProcedureInfo;
  title: string;
  recordId: string;
  version: number;
  statusLabel: string;
  watermark: string | null;
  generatedAt: string;
  general: Row[];
  acceptance: Row[];
  eq10Applied: boolean;
  cycles: ReportCycle[];
  results: {
    cycles: { index: number; date: string; slope: string; intercept: string; r2: string; slopeCheck: Check | null; interceptCheck: Check | null }[];
    summary: SummaryRow[];
    reverification: SummaryRow[];
  };
  conclusion: {
    result: string;
    failReasons: string[];
    level: string;
    validUntil: string;
    reverificationDue: string | null;
    technician: string;
    director: string;
    approvedAt: string;
    eq10: string;
    eq10Applies: boolean;
  };
  rules: { id: string; text: string; value: string; limit: string; result: string; reference: string }[];
  chart: { cycles: CycleSeries[]; identity: { x: number; y: number }[] };
  engineVersion: string;
  limitsVersion: string;
  changeReason: string | null;
}

export interface ReportContext {
  verification: VerificationDetail;
  reference: Equipment | null;
  candidate: Equipment | null;
  /** The reference's verification used at calculation time (non-SRP references). */
  referenceVerification: Verification | null;
  /** YYYY-MM-DD; defaults to today. */
  generatedAt?: string;
}

const yesNo = (b: unknown) => (b === true ? 'Sí' : b === false ? 'No' : DASH);
const raw = (n: number | null | undefined, unit = '') => (n === null || n === undefined ? DASH : `${formatInputNumber(n)}${unit}`);

export function formatFactors(f: InternalFactors | null | undefined): string {
  if (!f || Object.keys(f).length === 0) return DASH;
  return Object.entries(f)
    .map(([k, v]) => `${k} = ${formatInputNumber(v)}`)
    .join('; ');
}

export function equipmentText(e: Equipment | null, withLevel = true): string {
  if (!e) return DASH;
  const parts = [`${e.brand} ${e.model}`, `S/N ${e.serial}`, e.internalCode];
  if (withLevel && e.currentLevel !== null) parts.push(`Nivel ${e.currentLevel}`);
  return parts.join(' · ');
}

function referenceCertificate(ref: Equipment | null, refVer: Verification | null): string {
  if (ref?.type === 'SRP') {
    return `${ref.certificateNumber ?? DASH} · vence ${formatDate(ref.certificateValidUntil)}`;
  }
  if (refVer) return `Verificación ${refVer.id.slice(0, 8)} v${refVer.version} · vence ${formatDate(refVer.validUntil)}`;
  return DASH;
}

/** "Patrón = (Indicado − b̄) / m̄" with the §10 decimals (TAD 2023 App. A Eq. 10). */
export function eq10Text(meanSlope: number | null, meanIntercept: number | null): string {
  if (meanSlope === null || meanIntercept === null) return DASH;
  const sign = meanIntercept < 0 ? '+' : '−';
  return `Patrón = (Indicado ${sign} ${formatIntercept(Math.abs(meanIntercept))}) / ${formatSlope(meanSlope)}`;
}

/** Per-cycle date: the date of the cycle's first stable timestamp, else the verification date (D-035). */
export function cycleDate(v: VerificationDetail, index: number): string {
  const ts = v.cycles.find((c) => c.index === index)?.points.find((p) => p.timestampStable)?.timestampStable;
  return formatDate(ts ?? v.verificationDate);
}

const pair = (a: number | null | undefined, b: number | null | undefined) =>
  a == null && b == null ? DASH : `${raw(a)} / ${raw(b)}`;

function findRule(rules: readonly RuleResult[], ids: string[], cycleIndex?: number): RuleResult | undefined {
  return rules.find((r) => ids.includes(r.id) && r.pointOrder === undefined && r.cycleIndex === cycleIndex);
}

const check = (r: RuleResult | undefined): Check | null => (r ? { limit: r.limitText, pass: r.pass } : null);

export function buildReportModel(ctx: ReportContext): ReportModel {
  const v = ctx.verification;
  const e = v.evaluation;
  if (!e) throw new Error('La verificación no tiene resultado del servidor.');
  const avail = reportAvailability(v);
  const checklist = (v.acceptanceChecklist ?? {}) as Record<string, unknown>;
  const reverif = v.kind === 'REVERIFICATION_1_CYCLE';

  const general: Row[] = [
    { label: 'Fecha de la verificación', value: formatDate(v.verificationDate) },
    { label: 'Lugar', value: v.location ?? DASH },
    { label: 'Técnico', value: v.technicianEmail },
    { label: 'Patrón de referencia (x)', value: equipmentText(ctx.reference) },
    { label: 'Certificado del patrón', value: referenceCertificate(ctx.reference, ctx.referenceVerification) },
    { label: 'Candidato (y)', value: equipmentText(ctx.candidate, false) },
    { label: 'Tipo', value: KIND_LABEL[v.kind] },
    {
      label: 'Opción de trazabilidad',
      value: v.traceabilityOption === 2 ? 'Opción 2 – Ecuación 10' : 'Opción 1 – ajuste de factores internos',
    },
    { label: 'Ruta del patrón / del candidato', value: `${v.referenceRoute ? ROUTE_LABEL[v.referenceRoute] : DASH} / ${v.candidateRoute ? ROUTE_LABEL[v.candidateRoute] : DASH}` },
    { label: 'Factores internos antes', value: formatFactors(v.internalFactorsBefore) },
    { label: 'Factores internos después', value: formatFactors(v.internalFactorsAfter) },
    { label: 'Escala de calibración', value: raw(v.calibrationScalePpb, ' ppb') },
  ];

  const warm = checklist.warmup;
  const minutes = typeof checklist.warmupMinutes === 'number' ? ` (${formatInputNumber(checklist.warmupMinutes)} min)` : '';
  const acceptance: Row[] = [
    { label: 'Temperatura del laboratorio inicio / fin', value: `${raw(v.labTempStartC, ' °C')} / ${raw(v.labTempEndC, ' °C')}` },
    { label: 'Humedad relativa', value: raw(v.labRhPct, ' %') },
    { label: 'Presión barométrica', value: raw(v.baroPressureTorr, ' torr') },
    { label: 'Prueba de fugas', value: yesNo(checklist.leakTest) },
    { label: 'Calentamiento ≥ 30 min', value: warm === undefined ? DASH : `${yesNo(warm)}${minutes}` },
    { label: 'Diagnósticos', value: yesNo(checklist.diagnostics) },
    { label: 'Contraste T/P del fotómetro con instrumentos certificados', value: yesNo(checklist.tpContrast) },
    { label: 'AVERAGING', value: yesNo(checklist.averaging) },
    { label: 'NOISE FILT', value: yesNo(checklist.noiseFilt) },
    { label: 'Flujo total', value: raw(v.totalFlowSlpm, ' L/min') },
  ];
  if (typeof checklist.notes === 'string' && checklist.notes.trim()) acceptance.push({ label: 'Observaciones', value: checklist.notes.trim() });

  const cycles: ReportCycle[] = e.cycles.map((c) => {
    const stored = v.cycles.find((s) => s.index === c.index);
    let n = 0;
    const rows = c.points.map((p) => {
      const sp = stored?.points.find((s) => s.order === p.order);
      let label = '0';
      if (!p.isZero) {
        n += 1;
        label = n > 6 ? `${n} (opcional)` : String(n);
      }
      return {
        label,
        setpoint: formatPpb(p.setpointPpb),
        x: formatPpb(p.xRawPpb),
        xStd: formatPpb(p.xPpb),
        y: formatPpb(p.yPpb),
        cellT: pair(sp?.cellTempXC, sp?.cellTempYC),
        cellP: pair(sp?.cellPressXTorr, sp?.cellPressYTorr),
        diff: formatDiff(p.diffValue, p.diffType),
        pass: p.pass ? 'Sí' : 'No',
      };
    });
    return { index: c.index, date: cycleDate(v, c.index), rows };
  });

  const a = e.aggregates;
  const v5 = findRule(e.rules, ['V5']);
  const v6 = findRule(e.rules, ['V6']);
  const summary: SummaryRow[] = [
    { label: 'm prom. (Ec. 6)', value: formatSlope(a?.meanSlope), limit: DASH, pass: null },
    { label: 'b prom. (Ec. 7)', value: a ? `${formatIntercept(a.meanIntercept)} ppb` : DASH, limit: DASH, pass: null },
    { label: 'SDm (Ec. 8)', value: formatSlope(a?.sdSlope), limit: v5?.limitText ?? DASH, pass: v5?.pass ?? null },
    { label: 'SDb (Ec. 9)', value: a ? `${formatIntercept(a.sdIntercept)} ppb` : DASH, limit: v6?.limitText ?? DASH, pass: v6?.pass ?? null },
    { label: 'Rango verificado (punto más alto)', value: a ? `${formatPpb(a.maxVerifiedPointPpb)} ppb` : DASH, limit: DASH, pass: null },
  ];

  const reverification: SummaryRow[] = [];
  if (reverif) {
    const r1 = findRule(e.rules, ['R1']);
    const r2 = findRule(e.rules, ['R2']);
    if (r1) reverification.push({ label: '|m − m prom. última verificación| (R1)', value: formatSlope(r1.value), limit: r1.limitText, pass: r1.pass });
    if (r2) reverification.push({ label: '|b − b prom. última verificación| (R2)', value: r2.value === null ? DASH : `${formatIntercept(r2.value)} ppb`, limit: r2.limitText, pass: r2.pass });
  }

  const slopeIds = reverif ? ['R3'] : ['V3'];
  const interceptIds = reverif ? ['R4'] : ['V4'];

  return {
    company: COMPANY,
    procedure: procedureFor(ctx.reference, ctx.candidate),
    title: 'Registro de verificación de patrón de transferencia de ozono (Anexo A)',
    recordId: v.id,
    version: v.version,
    statusLabel: STATUS[v.status].label,
    watermark: avail.ok ? avail.watermark : DRAFT_WATERMARK,
    generatedAt: formatDate(ctx.generatedAt ?? new Date().toISOString()),
    general,
    acceptance,
    eq10Applied: e.eq10Applied,
    cycles,
    results: {
      cycles: e.cycles.map((c) => ({
        index: c.index,
        date: cycleDate(v, c.index),
        slope: formatSlope(c.regression?.slope),
        intercept: formatIntercept(c.regression?.intercept),
        r2: formatNumber(c.regression?.r2, 5),
        slopeCheck: check(findRule(e.rules, slopeIds, c.index)),
        interceptCheck: check(findRule(e.rules, interceptIds, c.index)),
      })),
      summary,
      reverification,
    },
    conclusion: {
      result: RESULT[e.overallResult].label,
      failReasons: e.failReasons,
      level: v.overallResult === 'CONFORME' && v.candidateLevel !== null ? String(v.candidateLevel) : DASH,
      validUntil: formatDate(v.validUntil),
      reverificationDue: v.reverificationDue ? formatDate(v.reverificationDue) : null,
      technician: v.technicianEmail,
      director: v.approvedByEmail ?? DASH,
      approvedAt: formatDate(v.approvedAt ?? v.rejectedAt),
      eq10: eq10Text(v.meanSlope, v.meanIntercept),
      eq10Applies: v.traceabilityOption === 2,
    },
    rules: summaryRules(e.rules).map((r) => ({
      id: r.id,
      text: r.cycleIndex !== undefined ? `${r.textEs} (ciclo ${r.cycleIndex})` : r.textEs,
      value: formatRuleValue(r),
      limit: r.limitText,
      result: r.informative ? 'Informativo' : r.pass ? 'Cumple' : 'No cumple',
      reference: r.reference,
    })),
    chart: chartSeries(e),
    engineVersion: v.engineVersion ?? e.engineVersion,
    limitsVersion: v.limitsVersion ?? e.limitsVersion,
    changeReason: v.changeReason,
  };
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_');

export function documentFileName(kind: string, v: Pick<Verification, 'verificationDate' | 'version'>, candidateCode: string, ext: string): string {
  return `${safe(kind)}_${safe(candidateCode)}_${v.verificationDate.slice(0, 10)}_v${v.version}.${ext}`;
}
