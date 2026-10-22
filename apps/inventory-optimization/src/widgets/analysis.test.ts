import { describe, it, expect } from 'vitest';
import { formatMoney } from './analysis';

// ARQ-611 — formatMoney era una copia de formatCOP de @suite/format cuyo guard
// `value || 0` tapaba NaN pero no Infinity, que salía como "$ ∞". El espacio tras
// "$" es duro (U+00A0), por eso el escape en los textos esperados.
describe('formatMoney (widgets de inventario)', () => {
  it('pesos sin decimales, igual que formatCOP', () => {
    expect(formatMoney(1234567.6)).toBe('$\u00a01.234.568');
  });

  it('NaN e Infinity se pintan como $ 0, no como "$ ∞"', () => {
    expect(formatMoney(NaN)).toBe('$\u00a00');
    expect(formatMoney(Infinity)).toBe('$\u00a00');
  });
});
