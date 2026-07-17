import { describe, it, expect } from 'vitest';
import { aggregatePendingOrders } from './salesOrders.js';

// Fila de línea mínima; los campos no relevantes al cálculo se rellenan por defecto.
const line = (over: Partial<Parameters<typeof aggregatePendingOrders>[0][number]>) => ({
  salesorder_id: 'so1',
  salesorder_number: 'OV-2026-001',
  date: '2026-07-01',
  customer_name: 'ACME',
  status: 'open',
  currency_code: 'COP',
  shipment_date: null,
  quantity: 0,
  rate: 0,
  cantidad_facturada: null,
  cantidad_cancelada: null,
  ...over,
});

describe('aggregatePendingOrders', () => {
  it('suma total y pendiente por orden a partir de sus líneas', () => {
    const [o] = aggregatePendingOrders([
      line({ quantity: 10, rate: 100, cantidad_facturada: '4' }),  // total 1000, pend (10-4)*100=600
      line({ quantity: 5, rate: 200, cantidad_cancelada: '1' }),   // total 1000, pend (5-1)*200=800
    ]);
    expect(o.total).toBe(2000);
    expect(o.pending).toBe(1400);
  });

  it('una orden sin nada facturado tiene pendiente = total', () => {
    const [o] = aggregatePendingOrders([line({ quantity: 3, rate: 500 })]);
    expect(o.total).toBe(1500);
    expect(o.pending).toBe(1500);
  });

  it('una línea totalmente facturada no aporta pendiente (nunca negativo)', () => {
    const [o] = aggregatePendingOrders([
      line({ quantity: 2, rate: 100, cantidad_facturada: '5' }), // facturada > pedida → pend 0, no -300
    ]);
    expect(o.total).toBe(200);
    expect(o.pending).toBe(0);
  });

  it('agrupa por salesorder_id y ordena por pendiente descendente', () => {
    const rows = aggregatePendingOrders([
      line({ salesorder_id: 'a', salesorder_number: 'A', quantity: 1, rate: 100 }),   // pend 100
      line({ salesorder_id: 'b', salesorder_number: 'B', quantity: 1, rate: 900 }),   // pend 900
      line({ salesorder_id: 'a', salesorder_number: 'A', quantity: 1, rate: 100 }),   // a: pend 200
    ]);
    expect(rows.map((o) => o.salesorder_number)).toEqual(['B', 'A']);
    expect(rows[0].pending).toBe(900);
    expect(rows[1].pending).toBe(200);
  });

  it('valores nulos o no numéricos cuentan como 0, sin romper la suma', () => {
    const [o] = aggregatePendingOrders([
      line({ quantity: null, rate: 100 }),          // qty 0
      line({ quantity: 4, rate: null }),            // rate 0
      line({ quantity: 2, rate: 50, cantidad_facturada: 'abc' }), // facturada 0 → pend 100
    ]);
    expect(o.total).toBe(100);
    expect(o.pending).toBe(100);
  });
});
