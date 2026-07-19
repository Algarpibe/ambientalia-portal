import { describe, it, expect } from 'vitest';
import { buildLineas, type LineaRow } from './detalle.js';

describe('buildLineas', () => {
  it('mapea y calcula total = cantidad * precio', () => {
    const rows: LineaRow[] = [
      { sku: 'CIL-1', nombre: 'Cilindro', cantidad: 3, precio: 100 },
      { sku: null, nombre: null, cantidad: null, precio: null },
    ];
    const r = buildLineas(rows);
    expect(r[0]).toEqual({ sku: 'CIL-1', nombre: 'Cilindro', cantidad: 3, precio: 100, total: 300 });
    expect(r[1]).toEqual({ sku: '', nombre: '', cantidad: 0, precio: 0, total: 0 });
  });

  it('valores no numéricos → 0 (no rompe)', () => {
    const r = buildLineas([{ sku: 'X', nombre: 'Y', cantidad: 'n/a' as unknown as number, precio: '' as unknown as number }]);
    expect(r[0].total).toBe(0);
  });
});
