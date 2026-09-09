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
  seguimiento_stock: true,
  es_mercancia: true,
  stock_fisico: '0',
  comprometido: '0',
  por_recibir: '0',
  falta: '0',
  trato: null,
  qt: null,
  ticket: null,
  quantity: 2,
  rate: 100,
  cantidad_facturada: '0',
  cantidad_cancelada: '0',
  ...over,
});

// Línea de mercancía con estante de sobra: 10 físicas, 1 comprometida en total
// (la de esta misma línea), así que se puede armar.
const CON_STOCK: Partial<LineRow> = {
  es_mercancia: true,
  seguimiento_stock: true,
  stock_fisico: '10',
  comprometido: '1',
  por_recibir: '0',
  falta: '1',
};

// La misma línea, pero sin nada en el estante.
const SIN_STOCK: Partial<LineRow> = { ...CON_STOCK, stock_fisico: '0' };

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

  it('despachada = SOLO fulfilled (el parcial tiene su propio indicio)', () => {
    expect(aggregateFacturables([line({ shipped_status: 'fulfilled' })])[0].despachada).toBe(true);
    expect(aggregateFacturables([line({ shipped_status: 'partially_shipped' })])[0].despachada).toBe(false);
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

describe('trato y qt', () => {
  it('mapea el trato y la cotizacion del deal, vacios si no hay', () => {
    const r = aggregateFacturables([line({ trato: 'Chemilab - 0726 - Cilindros', qt: '2026-041' })]);
    expect(r[0].trato).toBe('Chemilab - 0726 - Cilindros');
    expect(r[0].qt).toBe('2026-041');
  });

  it('sin deal ni cotizacion quedan como cadena vacia', () => {
    const r = aggregateFacturables([line({ trato: null, qt: null })]);
    expect(r[0].trato).toBe('');
    expect(r[0].qt).toBe('');
  });
});

describe('despachoParcial', () => {
  it('partially_shipped → despachoParcial, NO despachada', () => {
    const r = aggregateFacturables([line({ shipped_status: 'partially_shipped' })]);
    expect(r[0].despachoParcial).toBe(true);
    expect(r[0].despachada).toBe(false);
    expect(r[0].facturable).toBe(true); // se puede facturar lo ya despachado
  });

  it('fulfilled → despachada, NO parcial', () => {
    const r = aggregateFacturables([line({ shipped_status: 'fulfilled' })]);
    expect(r[0].despachada).toBe(true);
    expect(r[0].despachoParcial).toBe(false);
  });

  it('con despacho parcial no se muestran soloPaquete ni paquetePorCrear', () => {
    const r = aggregateFacturables([
      line({ ...CON_STOCK, shipped_status: 'partially_shipped', tiene_paquete: true }),
    ]);
    expect(r[0].despachoParcial).toBe(true);
    expect(r[0].soloPaquete).toBe(false);
    expect(r[0].paquetePorCrear).toBe(false);
  });
});

describe('paquetePorCrear', () => {
  it('true si puede armarse y NO está despachada ni tiene paquete', () => {
    const r = aggregateFacturables([line({ ...CON_STOCK, shipped_status: 'pending', tiene_paquete: false })]);
    expect(r[0].paquetePorCrear).toBe(true);
    expect(r[0].facturable).toBe(true); // entra en "solo facturables"
  });

  it('false si ya está despachada (no tiene sentido "por crear")', () => {
    const r = aggregateFacturables([line({ ...CON_STOCK, shipped_status: 'fulfilled' })]);
    expect(r[0].paquetePorCrear).toBe(false);
    expect(r[0].despachada).toBe(true);
  });

  it('false si ya tiene paquete', () => {
    const r = aggregateFacturables([line({ ...CON_STOCK, shipped_status: 'pending', tiene_paquete: true })]);
    expect(r[0].paquetePorCrear).toBe(false);
    expect(r[0].soloPaquete).toBe(true);
  });

  it('false si no hay stock suficiente', () => {
    const r = aggregateFacturables([line({ ...SIN_STOCK, shipped_status: 'pending', tiene_paquete: false })]);
    expect(r[0].paquetePorCrear).toBe(false);
    expect(r[0].facturable).toBe(false);
  });
});

describe('regla de stock: qué comprometido bloquea de verdad', () => {
  // Caso real OV-2026-163 / SKU 1142.A4 (tarjeta PCMCIA que acompaña al Grimm EDM 180C):
  // 2 unidades en el estante y 7 comprometidas entre todas las OV vivas — 1 de esta OV y
  // 6 de OV-2026-153 y OV-2026-156, que esperan las OC-2026-049 y OC-2026-057 (3+3, sin
  // recibir). Esas 6 llegan compradas, no salen del estante, así que no deben bloquearlo.
  it('las OV que esperan una orden de compra no bloquean el estante', () => {
    const r = aggregateFacturables([
      line({
        es_mercancia: true,
        seguimiento_stock: true,
        stock_fisico: '2',
        comprometido: '7',
        por_recibir: '6',
        falta: '1',
      }),
    ]);
    expect(r[0].paquetePorCrear).toBe(true);
  });

  it('sin OC en camino, lo comprometido por otras OV sigue bloqueando', () => {
    // Mismos números, pero sin nada comprado: esas 6 SÍ saldrían del estante.
    const r = aggregateFacturables([
      line({ stock_fisico: '2', comprometido: '7', por_recibir: '0', falta: '1' }),
    ]);
    expect(r[0].paquetePorCrear).toBe(false);
  });

  it('las OC no inventan stock: con el estante vacío no se puede armar', () => {
    // 6 compradas y ninguna recibida. Llegarán, pero hoy no hay con qué empaquetar.
    const r = aggregateFacturables([
      line({ stock_fisico: '0', comprometido: '1', por_recibir: '6', falta: '1' }),
    ]);
    expect(r[0].paquetePorCrear).toBe(false);
  });

  it('un artículo sin seguimiento de inventario bloquea (OV-2026-146)', () => {
    const r = aggregateFacturables([line({ ...CON_STOCK, seguimiento_stock: false })]);
    expect(r[0].paquetePorCrear).toBe(false);
  });

  it('sin líneas de mercancía pendientes no hay paquete que armar', () => {
    const r = aggregateFacturables([line({ ...CON_STOCK, es_mercancia: false })]);
    expect(r[0].paquetePorCrear).toBe(false);
  });

  it('basta con que UNA línea no alcance para no marcar la orden', () => {
    const r = aggregateFacturables([line({ ...CON_STOCK }), line({ ...SIN_STOCK })]);
    expect(r[0].paquetePorCrear).toBe(false);
  });
});
