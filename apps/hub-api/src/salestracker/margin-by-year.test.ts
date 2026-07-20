import { describe, it, expect } from 'vitest';
import { mapMarginYearRow } from './margin-by-year.js';

describe('mapMarginYearRow', () => {
  it('coacciona', () => {
    expect(mapMarginYearRow({ year: '2026', ventas: '1000', costo: '600' })).toEqual({ year: 2026, ventas: 1000, costo: 600 });
  });
  it('no numéricos → 0', () => {
    expect(mapMarginYearRow({ year: 2025, ventas: null, costo: 'x' })).toEqual({ year: 2025, ventas: 0, costo: 0 });
  });
});
