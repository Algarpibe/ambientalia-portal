import { describe, it, expect } from 'vitest';
import { semanaDelMes, rangoDeSemana, agruparPagos, type FilaPago } from './pagos.js';

// Regla aprobada (2026-10-01): la semana empieza en lunes; la semana 1 va del día 1 al
// primer domingo, aunque quede corta; puede haber hasta 6 semanas.
describe('semanaDelMes', () => {
  it.each([
    // septiembre 2026: empieza en martes, 30 días
    ['2026-09-01', 1], ['2026-09-06', 1], ['2026-09-07', 2], ['2026-09-13', 2],
    ['2026-09-14', 3], ['2026-09-27', 4], ['2026-09-28', 5], ['2026-09-30', 5],
    // febrero 2027: empieza en lunes, 28 días → exactamente 4 semanas
    ['2027-02-01', 1], ['2027-02-07', 1], ['2027-02-08', 2], ['2027-02-28', 4],
    // marzo 2026: empieza en domingo → semana 1 de un solo día, y semana 6
    ['2026-03-01', 1], ['2026-03-02', 2], ['2026-03-29', 5], ['2026-03-30', 6], ['2026-03-31', 6],
  ])('%s → semana %i', (fecha, semana) => {
    const [anio, mes] = fecha.split('-').map(Number);
    expect(semanaDelMes(fecha)).toEqual({ anio, mes, semana });
  });
});

describe('rangoDeSemana', () => {
  it.each([
    [2026, 9, 1, '2026-09-01', '2026-09-06', '1-6 sep 2026'],
    [2026, 9, 2, '2026-09-07', '2026-09-13', '7-13 sep 2026'],
    [2026, 9, 5, '2026-09-28', '2026-09-30', '28-30 sep 2026'],
    [2026, 3, 1, '2026-03-01', '2026-03-01', '1 mar 2026'],
    [2026, 3, 6, '2026-03-30', '2026-03-31', '30-31 mar 2026'],
    [2027, 2, 4, '2027-02-22', '2027-02-28', '22-28 feb 2027'],
  ])('%i-%i semana %i → %s a %s', (anio, mes, semana, desde, hasta, etiqueta) => {
    expect(rangoDeSemana(anio, mes, semana)).toEqual({ desde, hasta, etiqueta });
  });
});

// Una fila SQL por (pago, factura aplicada). Caso real: PC-2026-276 de SHI, que pagó
// ANT-2026-061 / AM1492 de OV-2026-162. Los numéricos de pg llegan como texto.
const fila = (over: Partial<FilaPago>): FilaPago => ({
  payment_id: 'p1', payment_number: 'PC-2026-276', customer_name: 'SHI', fecha: '2026-09-02',
  payment_mode: 'Transferencia bancaria', reference_number: null, currency_code: 'COP',
  amount: '1500', unused_amount: '0',
  invoice_number: 'AM1492', amount_applied: '1000', salesorder_number: 'OV-2026-162',
  ...over,
});

describe('agruparPagos', () => {
  it('un pago aplicado a dos facturas es UN pago con dos aplicaciones, sin duplicar el importe', () => {
    const r = agruparPagos([
      fila({}),
      fila({ invoice_number: 'AM1500', amount_applied: '500', salesorder_number: null }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ cantidadPagos: 1, totales: [{ moneda: 'COP', total: 1500 }] });
    expect(r[0].pagos[0].aplicaciones).toEqual([
      { factura: 'AM1492', ov: 'OV-2026-162', importe: 1000 },
      { factura: 'AM1500', ov: null, importe: 500 },
    ]);
  });

  it('un pago sin ninguna aplicación sigue apareciendo, con su saldo sin aplicar', () => {
    const r = agruparPagos([
      fila({ invoice_number: null, amount_applied: null, salesorder_number: null, unused_amount: '1500' }),
    ]);
    expect(r[0].pagos[0]).toMatchObject({ importe: 1500, sinAplicar: 1500, aplicaciones: [] });
  });

  it('arma la semana con su rango y su etiqueta', () => {
    const r = agruparPagos([fila({})]);
    expect(r[0]).toMatchObject({
      anio: 2026, mes: 9, semana: 1, desde: '2026-09-01', hasta: '2026-09-06', etiqueta: '1-6 sep 2026',
    });
  });

  it('dos pagos de la misma semana suman y cuentan; el más reciente primero', () => {
    const r = agruparPagos([
      fila({ payment_id: 'p1', payment_number: 'PC-1', fecha: '2026-09-02', amount: '100' }),
      fila({ payment_id: 'p2', payment_number: 'PC-2', fecha: '2026-09-05', amount: '200' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ cantidadPagos: 2, totales: [{ moneda: 'COP', total: 300 }] });
    expect(r[0].pagos.map((p) => p.numero)).toEqual(['PC-2', 'PC-1']);
  });

  it('no mezcla monedas: un total por moneda, COP primero (hay 16 pagos en USD y 2 en EUR)', () => {
    const r = agruparPagos([
      fila({ payment_id: 'p1', currency_code: 'USD', amount: '5000' }),
      fila({ payment_id: 'p2', currency_code: 'COP', amount: '1000' }),
      fila({ payment_id: 'p3', currency_code: 'EUR', amount: '70' }),
      fila({ payment_id: 'p4', currency_code: 'COP', amount: '500' }),
    ]);
    expect(r[0].totales).toEqual([
      { moneda: 'COP', total: 1500 },
      { moneda: 'EUR', total: 70 },
      { moneda: 'USD', total: 5000 },
    ]);
    expect(r[0].pagos.find((p) => p.importe === 5000)?.moneda).toBe('USD');
  });

  it('una moneda vacía se toma como COP', () => {
    const r = agruparPagos([fila({ currency_code: null })]);
    expect(r[0].pagos[0].moneda).toBe('COP');
    expect(r[0].totales).toEqual([{ moneda: 'COP', total: 1500 }]);
  });

  it('las semanas van de la más reciente a la más antigua, también entre meses', () => {
    const r = agruparPagos([
      fila({ payment_id: 'p1', fecha: '2026-08-31' }),
      fila({ payment_id: 'p2', fecha: '2026-09-15' }),
      fila({ payment_id: 'p3', fecha: '2026-09-01' }),
    ]);
    expect(r.map((s) => `${s.mes}-${s.semana}`)).toEqual(['9-3', '9-1', '8-6']);
  });

  it('un pago sin fecha se descarta: no tiene semana a la que pertenecer', () => {
    expect(agruparPagos([fila({ fecha: null })])).toEqual([]);
  });
});
