import { describe, it, expect } from 'vitest';
import { mapItemSalesRow } from './item-sales.js';

describe('mapItemSalesRow', () => {
  it('coacciona una fila cruda al contrato ItemSalesRow', () => {
    const raw = { item_id: 42, sku: 'ABC-1', nombre: 'Sensor', categoria: 'Equipos', cantidad: '3', importe: '1500.5' };
    expect(mapItemSalesRow(raw)).toEqual({
      itemId: '42', sku: 'ABC-1', nombre: 'Sensor', categoria: 'Equipos', cantidad: 3, importe: 1500.5,
    });
  });

  it('normaliza nulos: sku/categoria null, nombre vacío, números a 0', () => {
    const raw = { item_id: 7, sku: null, nombre: null, categoria: null, cantidad: null, importe: null };
    expect(mapItemSalesRow(raw)).toEqual({
      itemId: '7', sku: null, nombre: '', categoria: null, cantidad: 0, importe: 0,
    });
  });
});
