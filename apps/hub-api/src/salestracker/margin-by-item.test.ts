import { describe, it, expect } from 'vitest';
import { mapMarginItemRow } from './margin-by-item.js';

describe('mapMarginItemRow', () => {
  it('coacciona (item_id→itemId)', () => {
    expect(mapMarginItemRow({ item_id: 123, sku: 'ABC', nombre: 'Uno', ventas: '1000', costo: '600' })).toEqual({
      itemId: '123', sku: 'ABC', nombre: 'Uno', ventas: 1000, costo: 600,
    });
  });
  it('sku null-safe, nombre→"", no numéricos → 0', () => {
    expect(mapMarginItemRow({ item_id: '9', sku: null, nombre: null, ventas: null, costo: 'x' })).toEqual({
      itemId: '9', sku: null, nombre: '', ventas: 0, costo: 0,
    });
  });
});
