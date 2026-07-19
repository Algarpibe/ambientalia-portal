import { describe, it, expect } from 'vitest';
import { mapCustomerItemRow } from './customer-item-sales.js';

describe('mapCustomerItemRow', () => {
  it('coacciona una fila cruda', () => {
    const raw = { customer: 'ACME', sku: 'A1', marca: 'X', nombre: 'Sensor', categoria: 'Equipos', cantidad: '2', importe: '500.5' };
    expect(mapCustomerItemRow(raw)).toEqual({ customer: 'ACME', sku: 'A1', marca: 'X', nombre: 'Sensor', categoria: 'Equipos', cantidad: 2, importe: 500.5 });
  });
  it('normaliza nulos', () => {
    expect(mapCustomerItemRow({ customer: 'X', sku: null, marca: null, nombre: null, categoria: null, cantidad: null, importe: null }))
      .toEqual({ customer: 'X', sku: null, marca: null, nombre: '', categoria: null, cantidad: 0, importe: 0 });
  });
});
