import { describe, it, expect } from 'vitest';
import { hashMatriz, construirCuerpo, computarPendiente } from './email.js';
import { DEFAULT_CONFIG } from './config.js';
import { buildWorldOfficeCsv } from './builder.js';
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

  /** Fake db: `filas` son los destinatarios que devuelve destinatariosConEstado (sin
   *  hash_recibido ni frecuencia = usuario nuevo en 'inmediato'). `cortes` captura los
   *  parámetros de cada sellado de franja. */
  function fakeDb(filas: Record<string, unknown>[]) {
    const cortes: unknown[][] = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        if (sql.includes('UPDATE portal.wo_sales_email_frecuencia')) {
          cortes.push(params);
          return { rows: [] };
        }
        if (sql.includes('wo_sales_email_estado')) return { rows: [] };
        if (sql.includes('wo_sales_email_sent')) return { rows: filas };
        if (sql.includes('books.sales_orders')) return { rows: [{ salesorder_number: 'OV-1' }] };
        return { rows: [] };
      },
    };
    return Object.assign(db, { cortes }) as any;
  }

  // Hora de Colombia → instante; diario a las 8 con la franja de hoy ya pasada.
  const ahora = new Date('2026-09-25T10:00-05:00');
  const hoy8 = new Date('2026-09-25T08:00-05:00');
  const ayer8 = new Date('2026-09-24T08:00-05:00');
  const tokenActual = () => hashMatriz(buildWorldOfficeCsv([ov], DEFAULT_CONFIG).matriz);
  const diario = { frecuencia: 'diario', hora: 8, dia_semana: null };

  it('diario: franja nueva con cambios → se envía, y la franja NO se sella hasta confirmar', async () => {
    const db = fakeDb([{ email: 'x@x.co', nombre: 'X', hash_recibido: 'viejo', ...diario, ultimo_corte: ayer8 }]);
    const r = await computarPendiente(db, source, DEFAULT_CONFIG, filtro, 'a.xls', ahora);
    expect(r.enviar).toBe(true);
    expect(db.cortes).toEqual([]);
  });

  it('diario: franja ya procesada → no se envía aunque haya cambios', async () => {
    const db = fakeDb([{ email: 'x@x.co', nombre: 'X', hash_recibido: 'viejo', ...diario, ultimo_corte: hoy8 }]);
    expect((await computarPendiente(db, source, DEFAULT_CONFIG, filtro, 'a.xls', ahora)).enviar).toBe(false);
  });

  it('diario: franja nueva SIN cambios → no se envía y la franja se cierra ya', async () => {
    const db = fakeDb([{ email: 'x@x.co', nombre: 'X', hash_recibido: tokenActual(), ...diario, ultimo_corte: ayer8 }]);
    expect((await computarPendiente(db, source, DEFAULT_CONFIG, filtro, 'a.xls', ahora)).enviar).toBe(false);
    expect(db.cortes).toEqual([[['x@x.co'], [hoy8.toISOString()]]]);
  });

  it('nunca: no se envía aunque haya cambios', async () => {
    const db = fakeDb([{ email: 'x@x.co', nombre: 'X', hash_recibido: 'viejo', frecuencia: 'nunca', hora: null, dia_semana: null, ultimo_corte: null }]);
    expect((await computarPendiente(db, source, DEFAULT_CONFIG, filtro, 'a.xls', ahora)).enviar).toBe(false);
  });

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

// §9: el correo automático adjunta el archivo consolidado. Es la puerta por la que el
// archivo llega a contabilidad sin pasar por el panel de advertencias de la app, así
// que el aviso de no subirlo tal cual tiene que ir en el cuerpo del mensaje.
describe('construirCuerpo — aviso del archivo consolidado (§9)', () => {
  const resumen = (ordenes: number) => ({ ordenes, filas: ordenes * 3, cambiadas: [], advertencias: 0 });

  it('avisa de no subir el archivo cuando lleva varias órdenes', () => {
    const cuerpo = construirCuerpo(resumen(25), DEFAULT_CONFIG);
    expect(cuerpo).toMatch(/no lo subas/i);
    expect(cuerpo).toContain('25');
  });

  it('no avisa cuando el archivo lleva una sola orden', () => {
    const cuerpo = construirCuerpo(resumen(1), DEFAULT_CONFIG);
    expect(cuerpo).not.toMatch(/no lo subas/i);
  });
});
