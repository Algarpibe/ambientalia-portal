import { describe, it, expect } from 'vitest';
import { mapCategoryMonthRow } from './category-month-sales.js';
describe('mapCategoryMonthRow', () => {
  it('coacciona', () => {
    expect(mapCategoryMonthRow({ mes: '3', categoria: 'Equipos', importe: '500.5' })).toEqual({ mes: 3, categoria: 'Equipos', importe: 500.5 });
  });
  it('categoria null + importe no numérico → 0', () => {
    expect(mapCategoryMonthRow({ mes: 1, categoria: null, importe: null })).toEqual({ mes: 1, categoria: null, importe: 0 });
  });
});
