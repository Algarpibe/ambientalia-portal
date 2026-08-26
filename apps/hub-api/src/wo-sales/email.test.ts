import { describe, it, expect } from 'vitest';
import { hashMatriz, construirCuerpo, computarPendiente } from './email.js';
import { DEFAULT_CONFIG } from './config.js';
import type { SalesOrder } from './types.js';
import type { SalesOrderSource, SalesOrderFiltro } from './source.js';

describe('hashMatriz', () => {
  it('la misma matriz da el mismo hash (estable)', () => {
    const m = [['a', 'b'], ['1', '2']];
    expect(hashMatriz(m)).toBe(hashMatriz([['a', 'b'], ['1', '2']]));
  });
  it('una celda distinta cambia el hash', () => {
    expect(hashMatriz([['a', 'b'], ['1', '2']])).not.toBe(hashMatriz([['a', 'b'], ['1', '3']]));
  });
  it('una fila de menos (OV que sale) cambia el hash', () => {
    expect(hashMatriz([['a'], ['1'], ['2']])).not.toBe(hashMatriz([['a'], ['1']]));
  });
});

describe('computarPendiente', () => {
  // Una OV mínima válida; el builder real produce una matriz estable a partir de ella.
  const ov: SalesOrder = {
    numero: 'OV-1',
    fecha: '2026-07-14',
    clienteNombre: 'ACME',
    nit: '900123',
    formaPagoZoho: '100% Anticipado',
    fechaEntrega: '2026-07-20',
    plazoPago: 30,
    moneda: 'COP',
    descuentoCabecera: 0,
    cantidadFacturada: 0,
    lineas: [
      { sku: 'S1', descripcion: 'x', cantidad: 2, valorUnitario: 100, descuento: 0, centroCostos: '330801 X', centrosCostosCount: 1 },
    ],
  };
  const source: SalesOrderSource = {
    ordenesVivas: async () => [ov],
    ordenesAntiguas: async () => [],
  } as unknown as SalesOrderSource;
  const filtro: SalesOrderFiltro = { desde: '2026-01-01', hasta: '2026-12-31' };

  /** Fake db: `pendientes` son los destinatarios que devuelve recipientesPendientes. */
  function fakeDb(pendientes: { email: string; nombre: string }[]) {
    return {
      query: async (sql: string) => {
        if (sql.includes('wo_sales_email_estado')) return { rows: [] };
        if (sql.includes('wo_sales_email_sent')) return { rows: pendientes };
        if (sql.includes('books.sales_orders')) return { rows: [{ salesorder_number: 'OV-1' }] };
        return { rows: [] };
      },
    } as any;
  }

  it('envía solo a los destinatarios pendientes de ese hash', async () => {
    const r = await computarPendiente(fakeDb([{ email: 'nuevo@x.co', nombre: 'Nuevo' }]), source, DEFAULT_CONFIG, filtro, 'a.xls');
    expect(r.enviar).toBe(true);
    if (r.enviar) {
      expect(r.destinatarios).toEqual([{ email: 'nuevo@x.co', nombre: 'Nuevo' }]);
      expect(r.token).toMatch(/^[0-9a-f]{64}$/); // el token es el sha256 del contenido
    }
  });

  it('no envía cuando no hay pendientes (todos ya tienen el archivo actual o no hay destinatarios)', async () => {
    const r = await computarPendiente(fakeDb([]), source, DEFAULT_CONFIG, filtro, 'a.xls');
    expect(r.enviar).toBe(false);
  });
});

describe('construirCuerpo', () => {
  it('incluye el asunto, los totales y las OV cambiadas', () => {
    const cuerpo = construirCuerpo(
      { ordenes: 3, filas: 7, cambiadas: ['OV-2026-138', 'OV-2026-077'], advertencias: 0 },
      DEFAULT_CONFIG
    );
    expect(cuerpo).toContain('Nueva actualización de MovimientoInventarioWO');
    expect(cuerpo).toContain('3');
    expect(cuerpo).toContain('7');
    expect(cuerpo).toContain('OV-2026-138');
  });
  it('menciona las advertencias solo si las hay', () => {
    const con = construirCuerpo({ ordenes: 1, filas: 1, cambiadas: [], advertencias: 5 }, DEFAULT_CONFIG);
    expect(con).toContain('5');
    const sin = construirCuerpo({ ordenes: 1, filas: 1, cambiadas: [], advertencias: 0 }, DEFAULT_CONFIG);
    expect(sin.toLowerCase()).not.toContain('advertencia');
  });
});
