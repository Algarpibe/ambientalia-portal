import { describe, it, expect } from 'vitest';
import { aggregateFacturables, type LineRow } from './ovPendientes.js';

const line = (over: Partial<LineRow>): LineRow => ({
  salesorder_id: 'so1',
  salesorder_number: 'OV-1',
  date: '2026-05-01',
  customer_name: 'ACME',
  status: 'open',
  currency_code: 'COP',
  shipment_date: null,
  shipped_status: 'pending',
  tiene_paquete: false,
  ticket_por_facturar: false,
  ticket: null,
  quantity: 2,
  rate: 100,
  cantidad_facturada: '0',
  cantidad_cancelada: '0',
  ...over,
});

describe('aggregateFacturables', () => {
  it('suma total y pendiente por orden (una fila por orden)', () => {
    const r = aggregateFacturables([
      line({ quantity: 2, rate: 100, cantidad_facturada: '1' }),
      line({ quantity: 1, rate: 50 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].total).toBe(250);            // 2*100 + 1*50
    expect(r[0].pending).toBe(150);          // (2-1)*100 + 1*50
  });

  it('despachada = shipped_status fulfilled o partially_shipped', () => {
    expect(aggregateFacturables([line({ shipped_status: 'fulfilled' })])[0].despachada).toBe(true);
    expect(aggregateFacturables([line({ shipped_status: 'partially_shipped' })])[0].despachada).toBe(true);
    expect(aggregateFacturables([line({ shipped_status: 'pending' })])[0].despachada).toBe(false);
  });

  it('soloPaquete = tiene paquete y NO despachada', () => {
    expect(aggregateFacturables([line({ tiene_paquete: true, shipped_status: 'pending' })])[0].soloPaquete).toBe(true);
    expect(aggregateFacturables([line({ tiene_paquete: true, shipped_status: 'fulfilled' })])[0].soloPaquete).toBe(false);
    expect(aggregateFacturables([line({ tiene_paquete: false })])[0].soloPaquete).toBe(false);
  });

  it('facturable = despachada OR soloPaquete OR ticketPorFacturar', () => {
    expect(aggregateFacturables([line({ shipped_status: 'pending', tiene_paquete: false, ticket_por_facturar: false })])[0].facturable).toBe(false);
    expect(aggregateFacturables([line({ ticket_por_facturar: true })])[0].facturable).toBe(true);
    expect(aggregateFacturables([line({ shipped_status: 'fulfilled' })])[0].facturable).toBe(true);
  });

  it('ordena por pendiente descendente', () => {
    const r = aggregateFacturables([
      line({ salesorder_id: 'a', salesorder_number: 'A', quantity: 1, rate: 10 }),
      line({ salesorder_id: 'b', salesorder_number: 'B', quantity: 1, rate: 90 }),
    ]);
    expect(r.map((o) => o.salesorder_number)).toEqual(['B', 'A']);
  });
});
