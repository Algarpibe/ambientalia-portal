import { describe, it, expect } from 'vitest';
import { deriveMargin } from './analytics-margin';

describe('deriveMargin', () => {
  it('calcula margen y margenPct', () => {
    expect(deriveMargin(1000, 600)).toEqual({ margen: 400, margenPct: 40 });
  });
  it('ventas 0 → margenPct 0', () => {
    expect(deriveMargin(0, 0)).toEqual({ margen: 0, margenPct: 0 });
  });
  it('costo > ventas → margen negativo', () => {
    const d = deriveMargin(100, 150);
    expect(d.margen).toBe(-50);
    expect(d.margenPct).toBe(-50);
  });
});
