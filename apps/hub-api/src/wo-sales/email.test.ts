import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const MAX_SEMBRADO = 37; // MAX(documento_numero) que ve la fakeDb: la primera OV nueva recibe MAX_SEMBRADO + 1

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
  };
  const filtro: SalesOrderFiltro = { desde: '2026-01-01', hasta: '2026-12-31' };

  /** Fake db: `filas` son los destinatarios que devuelve destinatariosConEstado (sin
   *  hash_recibido ni frecuencia = usuario nuevo en 'inmediato'). `cortes` captura los
   *  parámetros de cada sellado de franja. `connect()` da un cliente que comparte la
   *  misma `query`: la transacción y el candado (DATA-339) los prueba email.db.test.ts
   *  contra Postgres real; aquí BEGIN/COMMIT/advisory lock y las reservas caen al
   *  `rows: []` del final (nadie tiene reserva vigente). */
  function fakeDb(filas: Record<string, unknown>[]) {
    const cortes: unknown[][] = [];
    const query = async (sql: string, params: unknown[]) => {
      // asignarDocumentoNumeros: tabla con las MAX_SEMBRADO congeladas → 'OV-1' recibe MAX_SEMBRADO + 1.
      if (sql.includes('MAX(documento_numero)')) return { rows: [{ max: MAX_SEMBRADO }] };
      if (sql.includes('UPDATE portal.wo_sales_email_frecuencia')) {
        cortes.push(params);
        return { rows: [] };
      }
      if (sql.includes('wo_sales_email_estado')) return { rows: [] };
      if (sql.includes('wo_sales_email_sent')) return { rows: filas };
      if (sql.includes('books.sales_orders')) return { rows: [{ salesorder_number: 'OV-1' }] };
      return { rows: [] };
    };
    const db = { query, connect: async () => ({ query, release: () => {} }) };
    return Object.assign(db, { cortes }) as any;
  }

  // Hora de Colombia → instante; diario a las 8 con la franja de hoy ya pasada.
  const ahora = new Date('2026-09-25T10:00-05:00');
  const hoy8 = new Date('2026-09-25T08:00-05:00');
  const ayer8 = new Date('2026-09-24T08:00-05:00');
  const tokenActual = () => hashMatriz(buildWorldOfficeCsv([ov], DEFAULT_CONFIG, new Map([['OV-1', MAX_SEMBRADO + 1]])).matriz);
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

  it('una corrida normal no trae OV repetidas ni la línea en el cuerpo', async () => {
    const r = await computarPendiente(fakeDb([{ email: 'nuevo@x.co', nombre: 'Nuevo' }]), source, DEFAULT_CONFIG, filtro, 'a.xls');
    expect(r.enviar).toBe(true);
    if (r.enviar) {
      expect(r.resumen.repetidas).toEqual([]);
      expect(r.cuerpo).not.toContain('OV con número repetido en Zoho');
    }
  });

  it('dos OV de Zoho con el mismo número: el cuerpo y el resumen las nombran', async () => {
    const otra: SalesOrder = { ...ov, lineas: [{ ...ov.lineas[0], sku: 'S2', cantidad: 5 }] };
    const dupSource = {
      ordenesVivas: async () => [ov, otra],
      ordenesAntiguas: async () => [],
    };
    const r = await computarPendiente(fakeDb([{ email: 'nuevo@x.co', nombre: 'Nuevo' }]), dupSource, DEFAULT_CONFIG, filtro, 'a.xls');
    expect(r.enviar).toBe(true);
    if (r.enviar) {
      expect(r.resumen.repetidas).toEqual(['OV-1']);
      expect(r.cuerpo).toContain(
        'OV con número repetido en Zoho (comparten DocumentoNúmero): OV-1. Revisa en Zoho cuál es la vigente antes de subir el archivo.'
      );
    }
  });

  it('una OV sin líneas no consume número: la asignación solo recibe la OV con líneas', async () => {
    const vacia: SalesOrder = { ...ov, numero: 'OV-0', lineas: [] };
    const mixSource: SalesOrderSource = {
      ordenesVivas: async () => [vacia, ov],
      ordenesAntiguas: async () => [],
    };
    const db = fakeDb([{ email: 'nuevo@x.co', nombre: 'Nuevo' }]);
    const originalConnect = db.connect;
    const select: unknown[][] = [];
    db.connect = async () => {
      const c = await originalConnect();
      const q = c.query;
      c.query = async (sql: string, params: unknown[]) => {
        if (sql.includes('numero_ov = ANY')) select.push(params);
        return q(sql, params);
      };
      return c;
    };
    const r = await computarPendiente(db, mixSource, DEFAULT_CONFIG, filtro, 'a.xls');
    expect(r.enviar).toBe(true);
    expect(select).toEqual([[['OV-1']]]);
  });

  it('dos números repetidos: resumen.repetidas los trae en el orden del archivo', async () => {
    const mk = (numero: string, sku: string): SalesOrder => ({ ...ov, numero, lineas: [{ ...ov.lineas[0], sku }] });
    const dupSource: SalesOrderSource = {
      ordenesVivas: async () => [mk('OV-9', 'a'), mk('OV-9', 'b'), mk('OV-2', 'c'), mk('OV-2', 'd')],
      ordenesAntiguas: async () => [],
    };
    const r = await computarPendiente(fakeDb([{ email: 'nuevo@x.co', nombre: 'Nuevo' }]), dupSource, DEFAULT_CONFIG, filtro, 'a.xls');
    expect(r.enviar).toBe(true);
    if (r.enviar) expect(r.resumen.repetidas).toEqual(['OV-2', 'OV-9']);
  });

  it('no envía cuando no hay pendientes (todos ya tienen el archivo actual o no hay destinatarios)', async () => {
    const r = await computarPendiente(fakeDb([]), source, DEFAULT_CONFIG, filtro, 'a.xls');
    expect(r.enviar).toBe(false);
  });
});

describe('construirCuerpo', () => {
  it('incluye el asunto, los totales y las OV cambiadas', () => {
    const cuerpo = construirCuerpo(
      { ordenes: 3, filas: 7, cambiadas: ['OV-2026-138', 'OV-2026-077'], advertencias: 0, repetidas: [] },
      DEFAULT_CONFIG
    );
    expect(cuerpo).toContain('Nueva actualización de MovimientoInventarioWO');
    expect(cuerpo).toContain('3');
    expect(cuerpo).toContain('7');
    expect(cuerpo).toContain('OV-2026-138');
  });
  it('menciona las advertencias solo si las hay', () => {
    const con = construirCuerpo({ ordenes: 1, filas: 1, cambiadas: [], advertencias: 5, repetidas: [] }, DEFAULT_CONFIG);
    expect(con).toContain('5');
    const sin = construirCuerpo({ ordenes: 1, filas: 1, cambiadas: [], advertencias: 0, repetidas: [] }, DEFAULT_CONFIG);
    expect(sin.toLowerCase()).not.toContain('advertencia');
  });
});

// Cada OV lleva su propio DocumentoNúmero, fijo y persistente: el correo ya no avisa de un
// número de documento compartido por varias órdenes, aunque el archivo lleve muchas.
describe('construirCuerpo — varias órdenes en el archivo', () => {
  const resumen = (ordenes: number) => ({ ordenes, filas: ordenes * 3, cambiadas: [], advertencias: 0, repetidas: [] });

  it('con varias órdenes no avisa de un número de documento compartido', () => {
    const cuerpo = construirCuerpo(resumen(25), DEFAULT_CONFIG);
    expect(cuerpo).not.toContain('ATENCIÓN');
    expect(cuerpo).not.toContain('mismo número de documento');
    expect(cuerpo).not.toMatch(/no lo subas/i);
    expect(cuerpo).toContain('Órdenes de venta: 25 · Líneas de producto: 75');
  });

  it('cuerpo exacto sin cambiadas, sin repetidas y sin advertencias', () => {
    expect(construirCuerpo(resumen(1), DEFAULT_CONFIG)).toBe(
      [
        DEFAULT_CONFIG.emailAsunto,
        '',
        'Se adjunta el archivo actualizado de pedidos para World Office.',
        'Órdenes de venta: 1 · Líneas de producto: 3',
      ].join('\n')
    );
  });

  it('orden de las líneas: cambios, luego OV repetidas, luego advertencias', () => {
    const cuerpo = construirCuerpo(
      { ordenes: 2, filas: 2, cambiadas: ['OV-1'], advertencias: 3, repetidas: ['OV-1'] },
      DEFAULT_CONFIG
    );
    const i = (t: string) => cuerpo.indexOf(t);
    expect(i('OV con cambios')).toBeGreaterThan(-1);
    expect(i('OV con cambios')).toBeLessThan(i('OV con número repetido en Zoho'));
    expect(i('OV con número repetido en Zoho')).toBeLessThan(i('Advertencias:'));
    expect(cuerpo).toContain(
      'OV con número repetido en Zoho (comparten DocumentoNúmero): OV-1. Revisa en Zoho cuál es la vigente antes de subir el archivo.'
    );
  });
});

// DATA-339: la reserva por destinatario. Las migraciones se re-ejecutan en CADA arranque
// sin tabla de control, y si una falla hub-api no arranca: tiene que ser solo DDL
// idempotente. El comportamiento lo prueba email.db.test.ts contra Postgres real.
describe('065_wo_sales_email_reserva.sql', () => {
  const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
  const sinComentarios = fuente('../users/migrations/065_wo_sales_email_reserva.sql').replace(/--.*$/gm, '');
  const sentencias = sinComentarios.split(';').map((s) => s.trim()).filter(Boolean);

  it('solo crea con IF NOT EXISTS y no toca datos en un segundo arranque', () => {
    expect(sentencias.map((s) => /^CREATE (?:SCHEMA|TABLE) IF NOT EXISTS \S+/.exec(s)?.[0])).toEqual([
      'CREATE SCHEMA IF NOT EXISTS portal',
      'CREATE TABLE IF NOT EXISTS portal.wo_sales_email_reserva',
    ]);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i);
  });

  // Ya no es la última (la 066 va detrás): basta con que esté justo detrás de la
  // 064, como se relajaron en su día las comprobaciones de la 062 y la 063.
  it('está apuntada en MIGRATIONS, detrás de la 064', () => {
    expect(fuente('../db.ts')).toMatch(/'064_trazabilidad_contratos\.sql',\s*'065_wo_sales_email_reserva\.sql'/);
  });
});
