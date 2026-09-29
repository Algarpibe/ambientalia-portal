import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_LIMITS, evaluateVerification } from '../engine';
import type { VerificationDetail } from '../types';
import {
  checklistComplete,
  convertUnit,
  emptyDraft,
  fromDetail,
  labTemperatureWarning,
  liveEngineInput,
  toPayload,
  withKind,
  type DraftState,
} from './draft';

const REF = '11111111-1111-4111-8111-111111111111';
const CAND = '22222222-2222-4222-8222-222222222222';

const T3_X = [0, 15, 52, 89, 126, 163, 200];
const T3_Y = [
  [0.3, 15.2, 52.6, 89.9, 127.1, 164.4, 201.6],
  [0.1, 15.0, 52.9, 90.2, 127.4, 164.3, 201.9],
  [0.4, 15.4, 52.5, 89.7, 126.9, 164.6, 201.5],
];
const es = (n: number) => String(n).replace('.', ',');

function t3Draft(): DraftState {
  const d = emptyDraft('2026-09-29');
  return {
    ...d,
    referenceEquipmentId: REF,
    candidateEquipmentId: CAND,
    cycles: d.cycles.map((c, i) => ({
      index: c.index,
      rows: T3_X.map((x, j) => ({ ...c.rows[0], setpoint: String(x), x: String(x), y: es(T3_Y[i][j]) })),
    })),
  };
}

describe('emptyDraft / withKind', () => {
  it('a new verification has 3 cycles of 7 empty rows, ppb, option 1, test date = today', () => {
    const d = emptyDraft('2026-09-29');
    expect(d.kind).toBe('VERIFICATION_3_CYCLES');
    expect(d.verificationDate).toBe('2026-09-29');
    expect(d.cycles.map((c) => c.index)).toEqual([1, 2, 3]);
    expect(d.cycles.every((c) => c.rows.length === 7 && c.rows.every((r) => r.x === '' && r.y === ''))).toBe(true);
    expect(d.unit).toBe('ppb');
    expect(d.traceabilityOption).toBe(1);
  });
  it('a reverification keeps only cycle 1; switching back adds two empty cycles', () => {
    const d = t3Draft();
    const r = withKind(d, 'REVERIFICATION_1_CYCLE');
    expect(r.cycles).toHaveLength(1);
    expect(r.cycles[0]).toEqual(d.cycles[0]);
    const v = withKind(r, 'VERIFICATION_3_CYCLES');
    expect(v.cycles.map((c) => c.index)).toEqual([1, 2, 3]);
    expect(v.cycles[0]).toEqual(d.cycles[0]);
    expect(v.cycles[2].rows.every((row) => row.x === '')).toBe(true);
  });
});

describe('toPayload', () => {
  it('parses comma decimals, skips blank rows, numbers points 1..n, stores ppb', () => {
    const d = t3Draft();
    d.cycles[0].rows.push({ ...d.cycles[0].rows[0], setpoint: '', x: '', y: '' });
    const { payload, problems } = toPayload(d);
    expect(problems).toEqual([]);
    expect(payload.cycles).toHaveLength(3);
    expect(payload.cycles[0].points).toHaveLength(7);
    expect(payload.cycles[0].points[2]).toMatchObject({ order: 3, setpointPpb: 52, xPpb: 52, yPpb: 52.6 });
    expect(payload.cycles[0].points[0].setpointPpb).toBe(0);
    expect(payload.referenceEquipmentId).toBe(REF);
  });

  it('ppm input is converted to ppb without float noise', () => {
    const d = emptyDraft('2026-09-29');
    d.unit = 'ppm';
    d.cycles[0].rows[0] = { ...d.cycles[0].rows[0], setpoint: '0,015', x: '0,0152', y: '0,0149' };
    const p = toPayload(d).payload.cycles[0].points[0];
    expect(p).toMatchObject({ setpointPpb: 15, xPpb: 15.2, yPpb: 14.9 });
  });

  it('header numbers, factors, checklist and photometry', () => {
    const d = emptyDraft('2026-09-29');
    d.labTempStartC = '22,5';
    d.labTempEndC = '';
    d.baroPressureTorr = '640';
    d.factorsBefore = [
      { name: 'span', value: '1,002' },
      { name: 'zero', value: '-0,3' },
      { name: '', value: '' },
    ];
    d.checklist.warmup = true;
    d.warmupMinutes = '45';
    d.lossPercent = '2';
    d.linearityErrorPercent = '-1,2';
    const { payload, problems } = toPayload(d);
    expect(problems).toEqual([]);
    expect(payload.labTempStartC).toBe(22.5);
    expect(payload.labTempEndC).toBeNull();
    expect(payload.baroPressureTorr).toBe(640);
    expect(payload.internalFactorsBefore).toEqual({ span: 1.002, zero: -0.3 });
    expect(payload.internalFactorsAfter).toBeNull();
    expect(payload.acceptanceChecklist).toMatchObject({ warmup: true, leakTest: false, warmupMinutes: 45 });
    expect(payload.photometry).toEqual({ lossFraction: 0.02, linearityErrorPercent: -1.2 });
    expect(payload.cycles.every((c) => c.points.length === 0)).toBe(true);
  });

  it('rowOrders maps each table row to the point order it produced (null = not sent)', () => {
    const d = emptyDraft('2026-09-29');
    d.cycles[0].rows[0] = { ...d.cycles[0].rows[0], x: '0', y: '0' };
    d.cycles[0].rows[2] = { ...d.cycles[0].rows[2], x: '15', y: '' };
    d.cycles[0].rows[3] = { ...d.cycles[0].rows[3], x: '15', y: '15' };
    const { rowOrders } = toPayload(d);
    expect(rowOrders[1]).toEqual([1, null, null, 2, null, null, null]);
    expect(rowOrders[2]).toEqual([null, null, null, null, null, null, null]);
  });

  it('reports incomplete rows and invalid numbers instead of silently dropping them', () => {
    const d = emptyDraft('2026-09-29');
    d.cycles[1].rows[2] = { ...d.cycles[1].rows[2], setpoint: '52', x: '52', y: '' };
    d.cycles[0].rows[0] = { ...d.cycles[0].rows[0], x: '1,2,3', y: '1' };
    d.labRhPct = 'mucho';
    d.factorsBefore = [{ name: 'span', value: 'x' }];
    const { problems } = toPayload(d);
    expect(problems).toEqual([
      expect.stringMatching(/humedad/i),
      expect.stringMatching(/factor.*span/i),
      expect.stringMatching(/Ciclo 1, fila 1.*x/),
      expect.stringMatching(/Ciclo 2, fila 3.*y/),
    ]);
  });
});

describe('fromDetail', () => {
  it('round-trips a stored verification back to the same payload', () => {
    const { payload } = toPayload({
      ...t3Draft(),
      location: 'Laboratorio',
      referenceRoute: 'SAMPLE_IN',
      traceabilityOption: 2,
      factorsAfter: [{ name: 'span', value: '1,1' }],
      lossPercent: '1',
    });
    const detail = {
      ...payload,
      id: 'v1',
      status: 'DRAFT',
      version: 1,
      cycles: payload.cycles.map((c) => ({
        index: c.index,
        slope: null,
        intercept: null,
        r2: null,
        pass: null,
        regressionError: null,
        points: c.points.map((p) => ({ ...p, xStdPpb: null, diffValue: null, diffType: null, pass: null })),
      })),
    } as unknown as VerificationDetail;
    expect(toPayload(fromDetail(detail)).payload).toEqual(payload);
  });
});

describe('convertUnit', () => {
  it('converts the concentration columns of every row, both ways, without float noise', () => {
    const d = emptyDraft('2026-09-29');
    d.cycles[0].rows[0] = { ...d.cycles[0].rows[0], setpoint: '15', x: '15,2', y: '', cellTempX: '25' };
    const ppm = convertUnit(d, 'ppm');
    expect(ppm.unit).toBe('ppm');
    expect(ppm.cycles[0].rows[0]).toMatchObject({ setpoint: '0,015', x: '0,0152', y: '', cellTempX: '25' });
    expect(convertUnit(ppm, 'ppb').cycles[0].rows[0]).toMatchObject({ setpoint: '15', x: '15,2' });
    expect(convertUnit(d, 'ppb')).toBe(d);
  });
  it('invalid text is left untouched (the problem list still reports it)', () => {
    const d = emptyDraft('2026-09-29');
    d.cycles[0].rows[0] = { ...d.cycles[0].rows[0], x: 'abc' };
    expect(convertUnit(d, 'ppm').cycles[0].rows[0].x).toBe('abc');
  });
});

describe('liveEngineInput', () => {
  it('T3 evaluated in the browser with the engine gives the TAD values and CONFORME', () => {
    const { payload } = toPayload(t3Draft());
    const input = liveEngineInput(payload, {});
    const r = evaluateVerification(input, DEFAULT_CONFIG, DEFAULT_LIMITS);
    expect(r.overallResult).toBe('CONFORME');
    expect(r.cycles[0].regression!.slope).toBeCloseTo(1.00706, 4);
    expect(r.aggregates!.meanSlope).toBeCloseTo(1.007383, 5);
    expect(r.aggregates!.sdIntercept).toBeCloseTo(0.041873, 5);
  });
  it('same shape as the server: lastVerification only for reverifications; factors and photometry passed', () => {
    const { payload } = toPayload({ ...t3Draft(), factorsBefore: [{ name: 'span', value: '1' }], lossPercent: '6' });
    const ctx = {
      referenceVerification: { traceabilityOption: 2 as const, meanSlope: 1.01, meanIntercept: 0.2 },
      lastVerification: { meanSlope: 1, meanIntercept: 0 },
    };
    const v = liveEngineInput(payload, ctx);
    expect(v.lastVerification).toBeUndefined();
    expect(v.referenceVerification).toEqual(ctx.referenceVerification);
    expect(v.internalFactors).toEqual({ span: 1 });
    expect(v.photometry).toEqual({ lossFraction: 0.06 });
    const r = liveEngineInput({ ...payload, kind: 'REVERIFICATION_1_CYCLE' }, ctx);
    expect(r.lastVerification).toEqual(ctx.lastVerification);
    expect(r.cycles[0].points[0]).toEqual({ order: 1, setpointPpb: 0, xPpb: 0, yPpb: 0.3 });
  });
});

describe('acceptance helpers', () => {
  it('checklistComplete needs every item', () => {
    const d = emptyDraft('2026-09-29');
    expect(checklistComplete(d)).toBe(false);
    for (const k of Object.keys(d.checklist) as (keyof DraftState['checklist'])[]) d.checklist[k] = true;
    expect(checklistComplete(d)).toBe(true);
  });
  it('lab temperature warning outside 20–30 °C (§7.7), inclusive bounds', () => {
    const d = emptyDraft('2026-09-29');
    expect(labTemperatureWarning(d)).toBeNull();
    d.labTempStartC = '20';
    d.labTempEndC = '30';
    expect(labTemperatureWarning(d)).toBeNull();
    d.labTempEndC = '31,5';
    expect(labTemperatureWarning(d)).toMatch(/31,5 °C/);
  });
});
