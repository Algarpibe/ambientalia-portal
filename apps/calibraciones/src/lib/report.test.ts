import { describe, expect, it } from 'vitest';
import { BENCH_6103, SRP, t3Detail } from './fixtures.test-data';
import { buildReportModel, documentFileName, reportAvailability, type ReportModel } from './report';

const model = (overrides = {}): ReportModel =>
  buildReportModel({ verification: t3Detail(overrides), reference: SRP, candidate: BENCH_6103, referenceVerification: null, generatedAt: '2026-09-29' });

const value = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label)?.value;

describe('reportAvailability', () => {
  it('APPROVED → available, no watermark', () => {
    expect(reportAvailability(t3Detail())).toEqual({ ok: true, watermark: null });
  });
  it('CALCULATED → available with the draft watermark', () => {
    expect(reportAvailability(t3Detail({ status: 'CALCULATED' }))).toEqual({ ok: true, watermark: 'BORRADOR – sin validez' });
  });
  it('REJECTED → available with the rejected watermark', () => {
    expect(reportAvailability(t3Detail({ status: 'REJECTED' }))).toEqual({ ok: true, watermark: 'RECHAZADA – sin validez' });
  });
  it('DRAFT or no server result → not available, with the reason', () => {
    const d = reportAvailability(t3Detail({ status: 'DRAFT' }));
    expect(d.ok).toBe(false);
    expect(reportAvailability(t3Detail({ status: 'CALCULATED', evaluation: null })).ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/calcul/i);
  });
});

describe('buildReportModel (Annex A)', () => {
  it('header: company, procedure, record id, version and status', () => {
    const m = model();
    expect(m.company).toBe('Ambientalia S.A.S.');
    expect(m.procedure.code).toBe('IN.5.5.3-XX');
    expect(m.recordId).toBe('3f2a9c1e-0000-4000-8000-000000000001');
    expect(m.version).toBe(1);
    expect(m.statusLabel).toBe('Aprobada');
    expect(m.watermark).toBeNull();
    expect(m.generatedAt).toBe('29/09/2026');
  });

  it('section 1: general data and acceptance tests', () => {
    const m = model();
    expect(value(m.general, 'Fecha de la verificación')).toBe('01/09/2026');
    expect(value(m.general, 'Técnico')).toBe('tecnico@ambientalia.test');
    expect(value(m.general, 'Patrón de referencia (x)')).toBe('NIST SRP · S/N DEMO-SRP-001 · SRP-CALAIRE · Nivel 1');
    expect(value(m.general, 'Certificado del patrón')).toBe('DEMO-CERT-001 · vence 30/06/2027');
    expect(value(m.general, 'Candidato (y)')).toBe('Environics 6103 · S/N DEMO-6103-S · 6103-S');
    expect(value(m.general, 'Tipo')).toBe('Verificación (3 ciclos)');
    expect(value(m.general, 'Opción de trazabilidad')).toBe('Opción 1 – ajuste de factores internos');
    expect(value(m.general, 'Factores internos antes')).toBe('span = 1,0021; zero = 0,3');
    expect(value(m.general, 'Factores internos después')).toBe('span = 1; zero = 0');
    expect(value(m.acceptance, 'Temperatura del laboratorio inicio / fin')).toBe('22 °C / 23,5 °C');
    expect(value(m.acceptance, 'Humedad relativa')).toBe('45 %');
    expect(value(m.acceptance, 'Presión barométrica')).toBe('560,2 torr');
    expect(value(m.acceptance, 'Prueba de fugas')).toBe('Sí');
    expect(value(m.acceptance, 'Calentamiento ≥ 30 min')).toBe('Sí (45 min)');
    expect(value(m.acceptance, 'Contraste T/P del fotómetro con instrumentos certificados')).toBe('Sí');
    expect(value(m.acceptance, 'NOISE FILT')).toBe('No');
    expect(value(m.acceptance, 'Flujo total')).toBe('5 L/min');
  });

  it('section 2: one table per cycle, rows 0 (zero) and 1–6, with the §10 decimals', () => {
    const m = model();
    expect(m.cycles).toHaveLength(3);
    const c2 = m.cycles[1];
    expect(c2.date).toBe('02/09/2026');
    expect(c2.rows.map((r) => r.label)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    const row52 = c2.rows[2];
    expect(row52).toMatchObject({ setpoint: '52,00', x: '52,00', y: '52,90', diff: '1,73 %', pass: 'Sí' });
    expect(c2.rows[0]).toMatchObject({ diff: '0,10 ppb', cellT: '25,1 / 25,3', cellP: '560,1 / 559,8' });
    expect(m.eq10Applied).toBe(false);
  });

  it('row 7 is labelled optional', () => {
    const v = t3Detail();
    const extra = { ...v.cycles[0].points[6], order: 8, setpointPpb: 220, xPpb: 220, yPpb: 221 };
    v.cycles[0].points.push(extra);
    const ep = v.evaluation!.cycles[0].points;
    ep.push({ ...ep[6], order: 8, setpointPpb: 220, xPpb: 220, xRawPpb: 220, yPpb: 221 });
    const m = buildReportModel({ verification: v, reference: SRP, candidate: BENCH_6103, referenceVerification: null });
    expect(m.cycles[0].rows.at(-1)?.label).toBe('7 (opcional)');
  });

  it('section 3: per-cycle m, b with their checks; means, SDs and conclusion', () => {
    const m = model();
    expect(m.results.cycles[0]).toMatchObject({ index: 1, date: '01/09/2026', slope: '1,00706', intercept: '0,221', slopeCheck: { limit: '1 ± 0,03', pass: true } });
    expect(m.results.cycles[0].interceptCheck).toMatchObject({ limit: '0 ± 3 ppb', pass: true });
    expect(m.results.summary.map((s) => s.label)).toEqual(['m prom. (Ec. 6)', 'b prom. (Ec. 7)', 'SDm (Ec. 8)', 'SDb (Ec. 9)', 'Rango verificado (punto más alto)']);
    expect(m.results.summary[0].value).toBe('1,00738');
    expect(m.results.summary[1].value).toBe('0,220 ppb');
    expect(m.results.summary[2]).toMatchObject({ value: '0,00099', limit: '< 0,0075', pass: true });
    expect(m.results.summary[3]).toMatchObject({ value: '0,042 ppb', limit: '< 1 ppb', pass: true });
    expect(m.results.summary[4].value).toBe('200,00 ppb');
    expect(m.results.reverification).toEqual([]);
    expect(m.conclusion).toMatchObject({
      result: 'CONFORME',
      level: '2',
      validUntil: '01/09/2027',
      technician: 'tecnico@ambientalia.test',
      director: 'director@ambientalia.test',
      approvedAt: '02/09/2026',
    });
    expect(m.conclusion.eq10).toBe('Patrón = (Indicado − 0,220) / 1,00738');
    expect(m.conclusion.eq10Applies).toBe(false);
  });

  it('rule table with the normative reference, versions and chart data', () => {
    const m = model();
    const v5 = m.rules.find((r) => r.id === 'V5')!;
    expect(v5.reference).toMatch(/TAD 2023/);
    expect(v5.result).toBe('Cumple');
    expect(m.rules.some((r) => r.id === 'V1')).toBe(false);
    expect(m.engineVersion).toBe('1.0.0');
    expect(m.limitsVersion).toBe('1.0.0');
    expect(m.chart.cycles).toHaveLength(3);
  });

  it('reverification: Δm/Δb (R1/R2) rows and R3/R4 as the cycle checks', () => {
    const base = t3Detail();
    const rules = base.evaluation!.rules.filter((r) => !['V3', 'V4', 'V5', 'V6', 'V7'].includes(r.id));
    const r1 = { ...rules[0], id: 'R1' as const, value: 0.0166, limitText: '≤ 0,015', pass: false, cycleIndex: undefined, pointOrder: undefined };
    const r2 = { ...r1, id: 'R2' as const, value: 0.1, limitText: '≤ 1,5 ppb', pass: true };
    const r3 = { ...r1, id: 'R3' as const, value: 1.024, limitText: '1 ± 0,03', pass: true, cycleIndex: 1 };
    const r4 = { ...r1, id: 'R4' as const, value: 0.2, limitText: '0 ± 3 ppb', pass: true, cycleIndex: 1 };
    const v = t3Detail({
      kind: 'REVERIFICATION_1_CYCLE',
      evaluation: { ...base.evaluation!, kind: 'REVERIFICATION_1_CYCLE', cycles: base.evaluation!.cycles.slice(0, 1), rules: [...rules, r1, r2, r3, r4] },
    });
    v.cycles = v.cycles.slice(0, 1);
    const m = buildReportModel({ verification: v, reference: SRP, candidate: BENCH_6103, referenceVerification: null });
    expect(m.results.reverification).toEqual([
      { label: '|m − m prom. última verificación| (R1)', value: '0,01660', limit: '≤ 0,015', pass: false },
      { label: '|b − b prom. última verificación| (R2)', value: '0,100 ppb', limit: '≤ 1,5 ppb', pass: true },
    ]);
    expect(m.results.cycles[0].slopeCheck).toMatchObject({ limit: '1 ± 0,03', pass: true });
  });

  it('draft watermark and Eq. 10 flag for option 2', () => {
    const m = model({ status: 'CALCULATED', traceabilityOption: 2 });
    expect(m.watermark).toBe('BORRADOR – sin validez');
    expect(m.conclusion.eq10Applies).toBe(true);
  });

  it('YY for 6103 → 6103 and the reference verification as its "certificate"', () => {
    const ref = { ...BENCH_6103, id: 'eq-ref' };
    const cand = { ...BENCH_6103, id: 'eq-t', internalCode: '6103-T', serial: 'DEMO-6103-T', currentLevel: 3 as const };
    const refVer = { ...t3Detail(), id: 'abcdef12-0000-4000-8000-000000000009', version: 2, validUntil: '2027-01-15' };
    const m = buildReportModel({ verification: t3Detail(), reference: ref, candidate: cand, referenceVerification: refVer });
    expect(m.procedure.code).toBe('IN.5.5.3-YY');
    expect(value(m.general, 'Certificado del patrón')).toBe('Verificación abcdef12 v2 · vence 15/01/2027');
  });
});

describe('documentFileName', () => {
  it('builds a safe file name with the candidate code, date and version', () => {
    expect(documentFileName('informe', t3Detail(), '6103-S', 'pdf')).toBe('informe_6103-S_2026-09-01_v1.pdf');
    expect(documentFileName('etiqueta', t3Detail(), 'Sabio 2010D/F', 'pdf')).toBe('etiqueta_Sabio_2010D_F_2026-09-01_v1.pdf');
  });
});
