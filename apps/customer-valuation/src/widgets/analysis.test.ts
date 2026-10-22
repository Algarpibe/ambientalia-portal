import { describe, it, expect } from 'vitest';
import { formatPercent } from './analysis';

// ARQ-611 — formatPercent era una copia de formatPct de @suite/format con un
// guard `value || 0` que tapaba NaN pero no Infinity: un premiumPercent infinito
// salía como "Infinity%" en el widget de segmentos.
describe('formatPercent (widgets de valoración)', () => {
  it('fracción a porcentaje con un decimal, como formatPct', () => {
    expect(formatPercent(0.1234)).toBe('12.3%');
    expect(formatPercent(0)).toBe('0.0%');
  });

  it('NaN e Infinity se pintan como 0.0%, no como "Infinity%"', () => {
    expect(formatPercent(NaN)).toBe('0.0%');
    expect(formatPercent(Infinity)).toBe('0.0%');
  });
});
