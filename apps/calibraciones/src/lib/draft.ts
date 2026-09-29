/**
 * Verification wizard state ↔ API payload ↔ engine input.
 *
 * The wizard keeps every number as the TEXT the technician typed (comma or dot
 * decimal, ppm or ppb) so nothing is lost or reformatted while typing. The
 * payload (PUT /verifications/:id) is always in ppb. `liveEngineInput` mirrors
 * hub-api `service.buildEngineInput`, so the browser preview runs the engine
 * on exactly what the server will run it on.
 */
import type { InternalFactors, Route, VerificationInput } from '../engine';
import type { CycleDraft, PointDraft, StoredVerificationKind, VerificationDetail, VerificationDraftInput } from '../types';
import { formatInputNumber } from './format';
import { parseDecimal } from './parse';

export type Unit = 'ppb' | 'ppm';

export interface PointRow {
  setpoint: string;
  x: string;
  y: string;
  cellTempX: string;
  cellTempY: string;
  cellPressX: string;
  cellPressY: string;
}

export interface CycleRows {
  index: number;
  rows: PointRow[];
}

export interface FactorRow {
  name: string;
  value: string;
}

export const CHECKLIST_ITEMS = [
  { id: 'warmup', label: 'Calentamiento de los equipos ≥ 30 min' },
  { id: 'leakTest', label: 'Prueba de fugas superada' },
  { id: 'diagnostics', label: 'Diagnósticos del equipo sin alarmas' },
  { id: 'tpContrast', label: 'Temperatura y presión de celda contrastadas' },
  { id: 'averaging', label: 'AVERAGING configurado según el procedimiento' },
  { id: 'noiseFilt', label: 'NOISE FILT configurado según el procedimiento' },
] as const;

export type ChecklistId = (typeof CHECKLIST_ITEMS)[number]['id'];

export interface DraftState {
  kind: StoredVerificationKind;
  verificationDate: string;
  location: string;
  referenceEquipmentId: string;
  candidateEquipmentId: string;
  referenceVerificationId: string | null;
  referenceRoute: Route | '';
  candidateRoute: Route | '';
  traceabilityOption: 1 | 2;
  directorOverrideLevel4: boolean;
  factorsBefore: FactorRow[];
  factorsAfter: FactorRow[];
  referenceFactors: FactorRow[];
  labTempStartC: string;
  labTempEndC: string;
  labRhPct: string;
  baroPressureTorr: string;
  totalFlowSlpm: string;
  /** Always ppb (set by the scale assistant). */
  calibrationScalePpb: string;
  checklist: Record<ChecklistId, boolean>;
  warmupMinutes: string;
  checklistNotes: string;
  /** O3 loss in percent (the API stores the fraction). */
  lossPercent: string;
  linearityErrorPercent: string;
  /** Unit of the setpoint / x / y columns. */
  unit: Unit;
  cycles: CycleRows[];
}

export const DEFAULT_ROWS_PER_CYCLE = 7;

export function emptyRow(): PointRow {
  return { setpoint: '', x: '', y: '', cellTempX: '', cellTempY: '', cellPressX: '', cellPressY: '' };
}

const emptyCycle = (index: number): CycleRows => ({
  index,
  rows: Array.from({ length: DEFAULT_ROWS_PER_CYCLE }, emptyRow),
});

const defaultFactors = (): FactorRow[] => [
  { name: 'span', value: '' },
  { name: 'zero', value: '' },
];

const emptyChecklist = (): Record<ChecklistId, boolean> =>
  Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i.id, false])) as Record<ChecklistId, boolean>;

export const cycleCountOf = (kind: StoredVerificationKind) => (kind === 'VERIFICATION_3_CYCLES' ? 3 : 1);

export function emptyDraft(today: string): DraftState {
  return {
    kind: 'VERIFICATION_3_CYCLES',
    verificationDate: today,
    location: '',
    referenceEquipmentId: '',
    candidateEquipmentId: '',
    referenceVerificationId: null,
    referenceRoute: '',
    candidateRoute: '',
    traceabilityOption: 1,
    directorOverrideLevel4: false,
    factorsBefore: defaultFactors(),
    factorsAfter: defaultFactors(),
    referenceFactors: defaultFactors(),
    labTempStartC: '',
    labTempEndC: '',
    labRhPct: '',
    baroPressureTorr: '',
    totalFlowSlpm: '',
    calibrationScalePpb: '',
    checklist: emptyChecklist(),
    warmupMinutes: '',
    checklistNotes: '',
    lossPercent: '',
    linearityErrorPercent: '',
    unit: 'ppb',
    cycles: [1, 2, 3].map(emptyCycle),
  };
}

/** Changes the kind keeping cycle 1 (and any existing cycle) and adding empty ones as needed. */
export function withKind(d: DraftState, kind: StoredVerificationKind): DraftState {
  const n = cycleCountOf(kind);
  const cycles = Array.from({ length: n }, (_, i) => d.cycles.find((c) => c.index === i + 1) ?? emptyCycle(i + 1));
  return { ...d, kind, cycles };
}

/** Removes float noise from a unit conversion (values are far below 12 significant digits). */
const clean = (n: number) => Number(n.toPrecision(12));

const PPB_PER_PPM = 1000;

function convertText(text: string, factor: number): string {
  const n = parseDecimal(text);
  if (n === null || Number.isNaN(n)) return text;
  return formatInputNumber(clean(n * factor));
}

/** Toggles the unit of the setpoint / x / y columns, converting what is typed. */
export function convertUnit(d: DraftState, to: Unit): DraftState {
  if (d.unit === to) return d;
  const factor = to === 'ppb' ? PPB_PER_PPM : 1 / PPB_PER_PPM;
  return {
    ...d,
    unit: to,
    cycles: d.cycles.map((c) => ({
      ...c,
      rows: c.rows.map((r) => ({
        ...r,
        setpoint: convertText(r.setpoint, factor),
        x: convertText(r.x, factor),
        y: convertText(r.y, factor),
      })),
    })),
  };
}

// ── State → payload ────────────────────────────────────────────────────────

const HEADER_NUMBERS = [
  ['labTempStartC', 'Temperatura inicial del laboratorio'],
  ['labTempEndC', 'Temperatura final del laboratorio'],
  ['labRhPct', 'Humedad relativa'],
  ['baroPressureTorr', 'Presión barométrica'],
  ['totalFlowSlpm', 'Flujo total'],
  ['calibrationScalePpb', 'Escala de calibración'],
  ['warmupMinutes', 'Minutos de calentamiento'],
  ['lossPercent', 'Pérdida de O₃'],
  ['linearityErrorPercent', 'Error de linealidad'],
] as const satisfies readonly (readonly [keyof DraftState, string])[];

const FACTOR_SETS = [
  ['factorsBefore', 'antes del ajuste'],
  ['factorsAfter', 'después del ajuste'],
  ['referenceFactors', 'del patrón'],
] as const;

const isBlankRow = (r: PointRow) => Object.values(r).every((v) => v.trim() === '');

export interface PayloadResult {
  payload: VerificationDraftInput;
  /** Human-readable problems (es-CO). A non-empty list must block saving. */
  problems: string[];
  /** Per cycle index: the point order each table row produced, or null when the row is not sent. */
  rowOrders: Record<number, (number | null)[]>;
}

export function toPayload(d: DraftState): PayloadResult {
  const problems: string[] = [];
  const num = (text: string, label: string): number | null => {
    const n = parseDecimal(text);
    if (n !== null && Number.isNaN(n)) {
      problems.push(`${label}: «${text}» no es un número.`);
      return null;
    }
    return n;
  };

  const header = Object.fromEntries(HEADER_NUMBERS.map(([k, label]) => [k, num(d[k], label)])) as Record<
    (typeof HEADER_NUMBERS)[number][0],
    number | null
  >;

  const factors = Object.fromEntries(
    FACTOR_SETS.map(([k, label]) => {
      const out: InternalFactors = {};
      for (const f of d[k]) {
        const name = f.name.trim();
        if (!name || f.value.trim() === '') continue;
        const v = num(f.value, `Factor interno «${name}» (${label})`);
        if (v !== null) out[name] = v;
      }
      return [k, Object.keys(out).length ? out : null];
    }),
  ) as Record<(typeof FACTOR_SETS)[number][0], InternalFactors | null>;

  const rowOrders: Record<number, (number | null)[]> = {};
  const toPpb = (n: number | null) => (n === null ? null : d.unit === 'ppm' ? clean(n * PPB_PER_PPM) : n);

  const cycles: CycleDraft[] = [...d.cycles]
    .sort((a, b) => a.index - b.index)
    .map((c) => {
      const points: PointDraft[] = [];
      const orders: (number | null)[] = c.rows.map(() => null);
      rowOrders[c.index] = orders;
      c.rows.forEach((r, i) => {
        if (isBlankRow(r)) return;
        const at = `Ciclo ${c.index}, fila ${i + 1}`;
        const before = problems.length;
        const cell = (text: string, name: string) => num(text, `${at}: «${name}»`);
        const setpoint = cell(r.setpoint, 'setpoint');
        const x = cell(r.x, 'x');
        const y = cell(r.y, 'y');
        const cellTempXC = cell(r.cellTempX, 'T celda x');
        const cellTempYC = cell(r.cellTempY, 'T celda y');
        const cellPressXTorr = cell(r.cellPressX, 'P celda x');
        const cellPressYTorr = cell(r.cellPressY, 'P celda y');
        const missing = [r.x.trim() === '' ? 'x' : null, r.y.trim() === '' ? 'y' : null].filter(Boolean);
        if (missing.length) problems.push(`${at}: falta la lectura ${missing.join(' y ')}.`);
        if (problems.length > before || x === null || y === null) return;
        orders[i] = points.length + 1;
        points.push({
          order: points.length + 1,
          setpointPpb: toPpb(setpoint),
          xPpb: toPpb(x)!,
          yPpb: toPpb(y)!,
          cellTempXC,
          cellTempYC,
          cellPressXTorr,
          cellPressYTorr,
        });
      });
      return { index: c.index, points };
    });

  const photometry =
    header.lossPercent === null && header.linearityErrorPercent === null
      ? null
      : {
          ...(header.lossPercent !== null ? { lossFraction: clean(header.lossPercent / 100) } : {}),
          ...(header.linearityErrorPercent !== null ? { linearityErrorPercent: header.linearityErrorPercent } : {}),
        };

  const payload: VerificationDraftInput = {
    kind: d.kind,
    verificationDate: d.verificationDate,
    location: d.location.trim() || null,
    referenceEquipmentId: d.referenceEquipmentId,
    candidateEquipmentId: d.candidateEquipmentId,
    referenceVerificationId: d.referenceVerificationId,
    referenceRoute: d.referenceRoute || null,
    candidateRoute: d.candidateRoute || null,
    traceabilityOption: d.traceabilityOption,
    internalFactorsBefore: factors.factorsBefore,
    internalFactorsAfter: factors.factorsAfter,
    referenceInternalFactors: factors.referenceFactors,
    labTempStartC: header.labTempStartC,
    labTempEndC: header.labTempEndC,
    labRhPct: header.labRhPct,
    baroPressureTorr: header.baroPressureTorr,
    totalFlowSlpm: header.totalFlowSlpm,
    calibrationScalePpb: header.calibrationScalePpb,
    acceptanceChecklist: {
      ...d.checklist,
      warmupMinutes: header.warmupMinutes,
      notes: d.checklistNotes.trim() || null,
    },
    photometry,
    directorOverrideLevel4: d.directorOverrideLevel4,
    cycles,
  };
  return { payload, problems, rowOrders };
}

// ── Stored record → state ──────────────────────────────────────────────────

const text = (n: number | null | undefined) => formatInputNumber(n);

function factorRows(f: InternalFactors | null): FactorRow[] {
  if (!f || Object.keys(f).length === 0) return defaultFactors();
  return Object.entries(f).map(([name, value]) => ({ name, value: text(value) }));
}

export function fromDetail(v: VerificationDetail): DraftState {
  const base = emptyDraft(v.verificationDate);
  const checklist = (v.acceptanceChecklist ?? {}) as Record<string, unknown>;
  const n = cycleCountOf(v.kind);
  const stored = new Map(v.cycles.map((c) => [c.index, c]));
  const indices = [...new Set([...Array.from({ length: n }, (_, i) => i + 1), ...stored.keys()])].sort((a, b) => a - b);
  return {
    ...base,
    kind: v.kind,
    location: v.location ?? '',
    referenceEquipmentId: v.referenceEquipmentId,
    candidateEquipmentId: v.candidateEquipmentId,
    referenceVerificationId: v.referenceVerificationId,
    referenceRoute: v.referenceRoute ?? '',
    candidateRoute: v.candidateRoute ?? '',
    traceabilityOption: v.traceabilityOption,
    directorOverrideLevel4: v.directorOverrideLevel4,
    factorsBefore: factorRows(v.internalFactorsBefore),
    factorsAfter: factorRows(v.internalFactorsAfter),
    referenceFactors: factorRows(v.referenceInternalFactors),
    labTempStartC: text(v.labTempStartC),
    labTempEndC: text(v.labTempEndC),
    labRhPct: text(v.labRhPct),
    baroPressureTorr: text(v.baroPressureTorr),
    totalFlowSlpm: text(v.totalFlowSlpm),
    calibrationScalePpb: text(v.calibrationScalePpb),
    checklist: Object.fromEntries(
      Object.keys(base.checklist).map((k) => [k, checklist[k] === true]),
    ) as Record<ChecklistId, boolean>,
    warmupMinutes: typeof checklist.warmupMinutes === 'number' ? text(checklist.warmupMinutes) : '',
    checklistNotes: typeof checklist.notes === 'string' ? checklist.notes : '',
    lossPercent:
      v.photometry?.lossFraction !== undefined && v.photometry.lossFraction !== null
        ? text(clean(v.photometry.lossFraction * 100))
        : '',
    linearityErrorPercent: text(v.photometry?.linearityErrorPercent),
    unit: 'ppb',
    cycles: indices.map((index) => {
      const c = stored.get(index);
      if (!c || c.points.length === 0) return emptyCycle(index);
      const rows = [...c.points]
        .sort((a, b) => a.order - b.order)
        .map((p) => ({
          setpoint: text(p.setpointPpb),
          x: text(p.xPpb),
          y: text(p.yPpb),
          cellTempX: text(p.cellTempXC),
          cellTempY: text(p.cellTempYC),
          cellPressX: text(p.cellPressXTorr),
          cellPressY: text(p.cellPressYTorr),
        }));
      while (rows.length < DEFAULT_ROWS_PER_CYCLE) rows.push(emptyRow());
      return { index, rows };
    }),
  };
}

// ── Payload → engine input (mirror of hub-api service.buildEngineInput) ────

export interface LiveContext {
  referenceVerification?: { traceabilityOption: 1 | 2; meanSlope: number; meanIntercept: number };
  lastVerification?: { meanSlope: number; meanIntercept: number; internalFactors?: InternalFactors };
}

export function liveEngineInput(p: VerificationDraftInput, ctx: LiveContext): VerificationInput {
  if (p.kind === 'CROSS_CHECK') throw new RangeError('El motor todavía no evalúa verificaciones cruzadas.');
  return {
    kind: p.kind,
    cycles: p.cycles.map((c) => ({
      index: c.index,
      points: c.points.map((pt) => ({
        order: pt.order,
        ...(pt.setpointPpb !== null && pt.setpointPpb !== undefined ? { setpointPpb: pt.setpointPpb } : {}),
        xPpb: pt.xPpb,
        yPpb: pt.yPpb,
      })),
    })),
    ...(ctx.referenceVerification ? { referenceVerification: ctx.referenceVerification } : {}),
    ...(p.kind === 'REVERIFICATION_1_CYCLE' && ctx.lastVerification ? { lastVerification: ctx.lastVerification } : {}),
    ...(p.internalFactorsBefore ? { internalFactors: p.internalFactorsBefore } : {}),
    ...(p.photometry ? { photometry: p.photometry } : {}),
  };
}

// ── Acceptance helpers (step 2) ────────────────────────────────────────────

export const checklistComplete = (d: DraftState) => CHECKLIST_ITEMS.every((i) => d.checklist[i.id]);

const LAB_TEMP_MIN_C = 20;
const LAB_TEMP_MAX_C = 30;

/** §7.7: warn when the lab temperature is outside 20–30 °C. */
export function labTemperatureWarning(d: DraftState): string | null {
  for (const t of [d.labTempStartC, d.labTempEndC]) {
    const n = parseDecimal(t);
    if (n !== null && !Number.isNaN(n) && (n < LAB_TEMP_MIN_C || n > LAB_TEMP_MAX_C)) {
      return `La temperatura del laboratorio (${formatInputNumber(n)} °C) está fuera del rango 20–30 °C.`;
    }
  }
  return null;
}
