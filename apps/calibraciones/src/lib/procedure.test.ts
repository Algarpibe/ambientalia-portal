import { describe, expect, it } from 'vitest';
import { procedureFor } from './procedure';

const eq = (model: string, internalCode: string, type = 'PHOTOMETRIC_CALIBRATOR') => ({ model, internalCode, type }) as const;

describe('procedureFor (IN.5.5.3-XX vs -YY)', () => {
  it('6103 Level 2 → 6103 Level 3 is YY', () => {
    expect(procedureFor(eq('6103', '6103-S'), eq('6103', '6103-T')).code).toBe('IN.5.5.3-YY');
  });
  it('6103 → Sabio 2010D is XX', () => {
    expect(procedureFor(eq('6103', '6103-S'), eq('2010D', 'SABIO-2010D-F')).code).toBe('IN.5.5.3-XX');
  });
  it('SRP → 6103 is XX (the reference is not a 6103)', () => {
    expect(procedureFor(eq('SRP', 'SRP-CALAIRE', 'SRP'), eq('6103', '6103-S')).code).toBe('IN.5.5.3-XX');
  });
  it('detects 6103 in the model or the internal code, case-insensitive', () => {
    expect(procedureFor(eq('Series 6103', 'P-1'), eq('X', 'env-6103-t')).code).toBe('IN.5.5.3-YY');
  });
  it('unknown equipment → XX with a title', () => {
    const p = procedureFor(null, null);
    expect(p.code).toBe('IN.5.5.3-XX');
    expect(p.title).toMatch(/Sabio 2010D/);
  });
});
