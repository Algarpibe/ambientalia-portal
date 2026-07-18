import { describe, it, expect } from 'vitest';
import {
  mapFacturaRow,
  dedupeByInvoiceNumber,
  withParticipacion,
  buildResumen,
  PRESUPUESTO_2026,
  type FacturaRawRow,
} from './domain.js';

// Fila cruda mínima (como la devuelve el SQL). Campos irrelevantes por defecto.
const raw = (over: Partial<FacturaRawRow>): FacturaRawRow => ({
  invoice_number: 'AM0001',
  reference_number: 'OV-2026-001',
  customer_name: 'ACME',
  date: '2026-01-15',
  due_date: '2026-02-15',
  status: 'paid',
  sub_total: 1000,
  total: 1190,
  iva: '190',
  balance: '0',
  retenciones: '0',
  deal_name: null,
  ticket_number: null,
  synced_at: '2026-01-16T00:00:00Z',
  ...over,
});

describe('mapFacturaRow', () => {
  it('mapea y calcula total+iva, cobrado, cobrado% y por cobrar (factura saldada)', () => {
    // Fila 3 del Excel: sub 1523592, iva 289482.48, total 1813074.48,
    // retención 54910.26, balance 0 -> cobrado% 1, cobrado = total-balance-ret.
    const f = mapFacturaRow(
      raw({ sub_total: 1523592, total: 1813074.48, iva: '289482.48', balance: '0', retenciones: '54910.26' }),
      new Map(),
    );
    expect(f.total).toBe(1523592);
    expect(f.iva).toBeCloseTo(289482.48, 2);
    expect(f.totalConIva).toBeCloseTo(1813074.48, 2);
    expect(f.porCobrar).toBe(0);
    expect(f.cobradoPct).toBeCloseTo(1, 6);
    expect(f.cobrado).toBeCloseTo(1758164.22, 2);
    expect(f.retenciones).toBeCloseTo(54910.26, 2);
  });

  it('cobrado% = 1 - balance/total cuando hay saldo pendiente', () => {
    // Excel fila IHA: total 15404550, balance 0.3 -> cobrado% ~0.99999998
    const f = mapFacturaRow(raw({ total: 15404550, balance: '0.3', retenciones: '642848.7' }), new Map());
    expect(f.cobradoPct).toBeCloseTo(0.99999998, 8);
    expect(f.porCobrar).toBeCloseTo(0.3, 6);
  });

  it('total 0 no divide por cero (cobrado% = 0)', () => {
    const f = mapFacturaRow(raw({ total: 0, sub_total: 0, iva: '0', balance: '0' }), new Map());
    expect(f.cobradoPct).toBe(0);
  });

  it('valores no numéricos de raw cuentan como 0, sin romper', () => {
    const f = mapFacturaRow(raw({ iva: 'N/A', balance: '', retenciones: null }), new Map());
    expect(f.iva).toBe(0);
    expect(f.porCobrar).toBe(0);
    expect(f.retenciones).toBe(0);
  });

  it('fusiona la cartera del override por invoice_number', () => {
    const f = mapFacturaRow(raw({ invoice_number: 'AM0009' }), new Map([['AM0009', 'En gestión']]));
    expect(f.cartera).toBe('En gestión');
  });

  it('cartera vacía cuando no hay override', () => {
    expect(mapFacturaRow(raw({ invoice_number: 'AM0009' }), new Map()).cartera).toBe('');
  });
});

describe('dedupeByInvoiceNumber', () => {
  it('elimina facturas fantasma duplicadas, se queda con el synced_at más reciente', () => {
    const rows = [
      raw({ invoice_number: 'AM1', total: 100, synced_at: '2026-01-01T00:00:00Z' }),
      raw({ invoice_number: 'AM1', total: 200, synced_at: '2026-02-01T00:00:00Z' }),
      raw({ invoice_number: 'AM2', total: 300, synced_at: '2026-01-01T00:00:00Z' }),
    ];
    const out = dedupeByInvoiceNumber(rows);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.invoice_number === 'AM1')!.total).toBe(200);
  });
});

describe('withParticipacion', () => {
  it('asigna %participación = totalConIva de la factura / suma total', () => {
    const facturas = [
      mapFacturaRow(raw({ invoice_number: 'A', total: 300 }), new Map()),
      mapFacturaRow(raw({ invoice_number: 'B', total: 100 }), new Map()),
    ];
    const out = withParticipacion(facturas);
    expect(out[0].participacion).toBeCloseTo(0.75, 6);
    expect(out[1].participacion).toBeCloseTo(0.25, 6);
  });

  it('suma total 0 -> participación 0 sin dividir por cero', () => {
    const out = withParticipacion([mapFacturaRow(raw({ total: 0 }), new Map())]);
    expect(out[0].participacion).toBe(0);
  });
});

describe('buildResumen', () => {
  it('agrega facturación e IVA por mes y calcula acumulado', () => {
    const facturas = [
      mapFacturaRow(raw({ invoice_number: 'A', date: '2026-01-10', total: 1190, iva: '190' }), new Map()),
      mapFacturaRow(raw({ invoice_number: 'B', date: '2026-01-20', total: 2380, iva: '380' }), new Map()),
      mapFacturaRow(raw({ invoice_number: 'C', date: '2026-03-05', total: 1190, iva: '190' }), new Map()),
    ];
    const r = buildResumen(facturas);
    expect(r.meses[0].facturacion).toBeCloseTo(3570, 2); // enero: 1190+2380
    expect(r.meses[0].iva).toBeCloseTo(570, 2);
    expect(r.meses[1].facturacion).toBe(0);              // febrero
    expect(r.meses[0].acumulado).toBeCloseTo(3570, 2);
    expect(r.meses[2].acumulado).toBeCloseTo(4760, 2);   // marzo acumula enero+marzo
  });

  it('calcula el cumplimiento del presupuesto sobre el subtotal facturado del año', () => {
    const facturas = [mapFacturaRow(raw({ total: 1190, sub_total: 1000 }), new Map())];
    const r = buildResumen(facturas);
    expect(r.totalFacturadoSinIva).toBe(1000);
    expect(r.presupuesto2026).toBe(PRESUPUESTO_2026);
    expect(r.cumplimientoPct).toBeCloseTo(1000 / PRESUPUESTO_2026, 10);
  });
});
