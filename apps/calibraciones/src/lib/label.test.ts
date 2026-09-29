import { describe, expect, it } from 'vitest';
import { BENCH_6103, SRP, t3Detail } from './fixtures.test-data';
import { buildLabelModel, DEFAULT_LABEL_SIZE, LABEL_SIZES, labelAvailability, labelPageSize } from './label';

const ctx = (overrides = {}, candidate = BENCH_6103) => ({
  verification: t3Detail(overrides),
  reference: SRP,
  candidate,
  referenceVerification: null,
});
const field = (m: ReturnType<typeof buildLabelModel>, label: string) => m.fields.find((f) => f.label === label)?.value;

describe('labelAvailability', () => {
  it('only APPROVED + CONFORME', () => {
    expect(labelAvailability(t3Detail()).ok).toBe(true);
    expect(labelAvailability(t3Detail({ status: 'CALCULATED' })).ok).toBe(false);
    expect(labelAvailability(t3Detail({ overallResult: 'NO_CONFORME' })).ok).toBe(false);
    const r = labelAvailability(t3Detail({ status: 'REJECTED' }));
    if (!r.ok) expect(r.reason).toMatch(/aprobad/i);
  });
});

describe('label sizes', () => {
  it('default 100 × 150 mm, converted to PDF points', () => {
    expect(DEFAULT_LABEL_SIZE).toBe('100x150');
    const [w, h] = labelPageSize(LABEL_SIZES[DEFAULT_LABEL_SIZE]);
    expect(w).toBeCloseTo(283.46, 2);
    expect(h).toBeCloseTo(425.2, 1);
  });
  it('every preset has a Spanish label', () => {
    for (const s of Object.values(LABEL_SIZES)) expect(s.label).toMatch(/mm/);
  });
});

describe('buildLabelModel (§11.1)', () => {
  it('dates, people, reference standard and candidate', () => {
    const m = buildLabelModel(ctx());
    expect(field(m, 'Verificado')).toBe('01/09/2026');
    expect(field(m, 'Vence')).toBe('01/09/2027');
    expect(field(m, 'Realizó')).toBe('tecnico@ambientalia.test');
    expect(field(m, 'Aprobó')).toBe('director@ambientalia.test');
    expect(field(m, 'Patrón usado')).toBe('NIST SRP · S/N DEMO-SRP-001 · Nivel 1');
    expect(field(m, 'Equipo')).toBe('Environics 6103 · S/N DEMO-6103-S');
    expect(field(m, 'Código interno / nivel')).toBe('6103-S · Nivel 2');
    expect(field(m, 'Factores internos vigentes')).toBe('span = 1; zero = 0');
  });

  it('cycles, means, range, conditions, flow and routes', () => {
    const m = buildLabelModel(ctx());
    expect(m.cycles.map((c) => [c.index, c.date, c.slope, c.intercept])).toEqual([
      [1, '01/09/2026', '1,00706', '0,221'],
      [2, '02/09/2026', '1,00872', '0,168'],
      [3, '03/09/2026', '1,00637', '0,270'],
    ]);
    expect(m.mean).toEqual({ slope: '1,00738', intercept: '0,220' });
    expect(field(m, 'Rango verificado (límite de uso)')).toBe('200,00 ppb');
    expect(field(m, 'Condiciones ambientales')).toBe('T 22–23,5 °C · HR 45 % · P 560,2 torr');
    expect(field(m, 'Flujo total')).toBe('5 L/min');
    expect(field(m, 'Rutas (patrón / candidato)')).toBe('Entrada de muestra (SAMPLE IN) / Entrada de muestra (SAMPLE IN)');
  });

  it('bench legend for the Level 2 bench standard; Eq. 10 only with option 2', () => {
    const bench = buildLabelModel(ctx());
    expect(bench.benchLegend).toBe('PATRÓN DE BANCO');
    expect(bench.eq10).toBeNull();

    const field6103 = buildLabelModel(ctx({ candidateLevel: 3, traceabilityOption: 2 }, { ...BENCH_6103, application: 'FIELD' }));
    expect(field6103.benchLegend).toBeNull();
    expect(field6103.eq10).toBe('Patrón = (Indicado − 0,220) / 1,00738');
  });

  it('header: company, procedure code and record reference', () => {
    const m = buildLabelModel(ctx());
    expect(m.company).toBe('Ambientalia S.A.S.');
    expect(m.procedureCode).toBe('IN.5.5.3-XX');
    expect(m.recordRef).toBe('3f2a9c1e v1');
  });

  it('refuses a record that cannot carry a label', () => {
    expect(() => buildLabelModel(ctx({ status: 'CALCULATED' }))).toThrow();
  });
});
