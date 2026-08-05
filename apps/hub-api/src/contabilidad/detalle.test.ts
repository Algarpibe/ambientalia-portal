import { describe, it, expect } from 'vitest';
import { buildLineas, type LineaRow } from './detalle.js';

describe('buildLineas — por despachar', () => {
  it('mapea las unidades pendientes de la línea (0 si no hay)', () => {
    const r = buildLineas([
      { sku: 'A', nombre: 'x', cantidad: 3, precio: 10, por_despachar: 2 },
      { sku: 'B', nombre: 'y', cantidad: 1, precio: 10, por_despachar: null },
    ] as LineaRow[]);
    expect(r[0].porDespachar).toBe(2);
    expect(r[1].porDespachar).toBe(0);
  });
});

describe('buildLineas', () => {
  it('mapea y calcula total = cantidad * precio', () => {
    const rows: LineaRow[] = [
      { sku: 'CIL-1', nombre: 'Cilindro', cantidad: 3, precio: 100, por_despachar: 0 },
      { sku: null, nombre: null, cantidad: null, precio: null, por_despachar: null },
    ];
    const r = buildLineas(rows);
    expect(r[0]).toEqual({ sku: 'CIL-1', nombre: 'Cilindro', cantidad: 3, precio: 100, total: 300, porDespachar: 0 });
    expect(r[1]).toEqual({ sku: '', nombre: '', cantidad: 0, precio: 0, total: 0, porDespachar: 0 });
  });

  it('valores no numéricos → 0 (no rompe)', () => {
    const r = buildLineas([{ sku: 'X', nombre: 'Y', cantidad: 'n/a' as unknown as number, precio: '' as unknown as number, por_despachar: null }]);
    expect(r[0].total).toBe(0);
  });
});
