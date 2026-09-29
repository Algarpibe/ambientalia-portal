/**
 * Standard label (procedures IN.5.5.3 §11.1): only for an APPROVED + CONFORME
 * verification. Values formatted per master prompt §10. Page size is
 * configurable; default 100 × 150 mm (4 × 6 in thermal label, DECISIONS D-038).
 */
import type { Verification } from '../types';
import { ROUTE_LABEL } from './domain';
import { DASH, formatDate, formatInputNumber, formatIntercept, formatPpb, formatSlope } from './format';
import { procedureFor } from './procedure';
import { COMPANY, cycleDate, eq10Text, formatFactors, type Availability, type ReportContext, type Row } from './report';

export const LABEL_SIZES = {
  '100x150': { widthMm: 100, heightMm: 150, label: '100 × 150 mm (etiqueta térmica 4 × 6")' },
  A6: { widthMm: 105, heightMm: 148, label: 'A6 · 105 × 148 mm' },
  A5: { widthMm: 148, heightMm: 210, label: 'A5 · 148 × 210 mm' },
} as const;

export type LabelSizeKey = keyof typeof LABEL_SIZES;
export const DEFAULT_LABEL_SIZE: LabelSizeKey = '100x150';

const MM_TO_PT = 72 / 25.4;

/** [width, height] in PDF points. */
export function labelPageSize(s: { widthMm: number; heightMm: number }): [number, number] {
  return [s.widthMm * MM_TO_PT, s.heightMm * MM_TO_PT];
}

export function labelAvailability(v: Pick<Verification, 'status' | 'overallResult'>): Availability {
  if (v.status !== 'APPROVED' || v.overallResult !== 'CONFORME') {
    return { ok: false, reason: 'La etiqueta solo se emite para verificaciones aprobadas con resultado CONFORME.' };
  }
  return { ok: true, watermark: null };
}

export interface LabelModel {
  company: string;
  procedureCode: string;
  recordRef: string;
  benchLegend: string | null;
  fields: Row[];
  cycles: { index: number; date: string; slope: string; intercept: string }[];
  mean: { slope: string; intercept: string };
  eq10: string | null;
}

const num = (n: number | null | undefined) => (n === null || n === undefined ? DASH : formatInputNumber(n));

export function buildLabelModel(ctx: ReportContext): LabelModel {
  const v = ctx.verification;
  const avail = labelAvailability(v);
  if (!avail.ok) throw new Error(avail.reason);
  const ref = ctx.reference;
  const cand = ctx.candidate;
  const factors = v.internalFactorsAfter ?? v.internalFactorsBefore;

  const fields: Row[] = [
    { label: 'Verificado', value: formatDate(v.verificationDate) },
    { label: 'Vence', value: formatDate(v.validUntil) },
    ...(v.reverificationDue ? [{ label: 'Reverificar antes de', value: formatDate(v.reverificationDue) }] : []),
    { label: 'Realizó', value: v.technicianEmail },
    { label: 'Aprobó', value: v.approvedByEmail ?? DASH },
    {
      label: 'Patrón usado',
      value: ref ? [`${ref.brand} ${ref.model}`, `S/N ${ref.serial}`, ...(ref.currentLevel !== null ? [`Nivel ${ref.currentLevel}`] : [])].join(' · ') : DASH,
    },
    { label: 'Equipo', value: cand ? `${cand.brand} ${cand.model} · S/N ${cand.serial}` : DASH },
    { label: 'Código interno / nivel', value: `${cand?.internalCode ?? DASH} · Nivel ${v.candidateLevel ?? DASH}` },
    { label: 'Factores internos vigentes', value: formatFactors(factors) },
    { label: 'Rango verificado (límite de uso)', value: v.maxVerifiedPointPpb !== null ? `${formatPpb(v.maxVerifiedPointPpb)} ppb` : DASH },
    {
      label: 'Condiciones ambientales',
      value: `T ${num(v.labTempStartC)}–${num(v.labTempEndC)} °C · HR ${num(v.labRhPct)} % · P ${num(v.baroPressureTorr)} torr`,
    },
    { label: 'Flujo total', value: v.totalFlowSlpm !== null ? `${num(v.totalFlowSlpm)} L/min` : DASH },
    {
      label: 'Rutas (patrón / candidato)',
      value: `${v.referenceRoute ? ROUTE_LABEL[v.referenceRoute] : DASH} / ${v.candidateRoute ? ROUTE_LABEL[v.candidateRoute] : DASH}`,
    },
  ];

  const cycles = v.cycles.map((c) => ({
    index: c.index,
    date: cycleDate(v, c.index),
    slope: formatSlope(c.slope),
    intercept: formatIntercept(c.intercept),
  }));

  return {
    company: COMPANY,
    procedureCode: procedureFor(ref, cand).code,
    recordRef: `${v.id.slice(0, 8)} v${v.version}`,
    benchLegend: v.candidateLevel === 2 && cand?.application === 'BENCH' ? 'PATRÓN DE BANCO' : null,
    fields,
    cycles,
    mean: { slope: formatSlope(v.meanSlope), intercept: formatIntercept(v.meanIntercept) },
    eq10: v.traceabilityOption === 2 ? eq10Text(v.meanSlope, v.meanIntercept) : null,
  };
}
