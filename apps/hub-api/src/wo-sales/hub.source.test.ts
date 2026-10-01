import { describe, it, expect } from 'vitest';
import { pendientePorFacturar, facturadaEnviada, createHubSalesOrderSource } from './hub.source.js';
import { cambiadasDesde } from './email.repo.js';
import { DEFAULT_CONFIG } from './config.js';

// OV de prueba de otro software: no deben llegar ni a la tabla, ni al archivo, ni al
// correo. El filtro vive en el SQL; aquí se comprueba que las dos consultas lo aplican
// y reciben la lista de config.
describe('ordenesExcluidas', () => {
  const capturar = () => {
    const llamadas: { sql: string; params: unknown[] }[] = [];
    const db = { query: async (sql: string, params: unknown[]) => (llamadas.push({ sql, params }), { rows: [] }) };
    return { db: db as never, llamadas };
  };
  const filtro = { desde: '2000-01-01', hasta: '2026-12-31' };

  it('la OV-2026-1000-01 (prueba de otro software) está excluida por defecto', () => {
    expect(DEFAULT_CONFIG.ordenesExcluidas).toContain('OV-2026-1000-01');
  });

  it('ordenesVivas y ordenesAntiguas filtran por la lista de excluidas', async () => {
    const { db, llamadas } = capturar();
    const source = createHubSalesOrderSource(db, DEFAULT_CONFIG);
    await source.ordenesVivas(filtro);
    await source.ordenesAntiguas(filtro);
    for (const { sql, params } of llamadas) {
      expect(sql).toMatch(/salesorder_number\s*=\s*ANY\(\$\d+::text\[\]\)/);
      expect(params).toContainEqual(DEFAULT_CONFIG.ordenesExcluidas);
    }
  });
});

// La cantidad que World Office debe cargar es la PENDIENTE de facturar, no la pedida:
// cargar lo ya facturado duplicaría inventario y facturación. Esta es la aritmética
// que lo decide; los números salen de OV-2026-077 real (cada línea: pedida 7, ya
// facturada 3 → pendiente 4).
describe('pendientePorFacturar', () => {
  it('descuenta lo ya facturado (OV-2026-077 real: 7 − 3 = 4)', () => {
    expect(pendientePorFacturar(7, 3, 0)).toEqual({ cantidad: 4, incluir: true });
  });

  it('una OV no facturada exporta la cantidad completa', () => {
    expect(pendientePorFacturar(50, 0, 0)).toEqual({ cantidad: 50, incluir: true });
  });

  it('una línea facturada del todo NO entra al archivo', () => {
    expect(pendientePorFacturar(7, 7, 0)).toEqual({ cantidad: 0, incluir: false });
  });

  it('también descuenta lo cancelado', () => {
    expect(pendientePorFacturar(10, 2, 3)).toEqual({ cantidad: 5, incluir: true });
  });

  it('un descuadre (facturada > pedida) no entra: no queda nada pendiente', () => {
    expect(pendientePorFacturar(5, 8, 0)).toEqual({ cantidad: -3, incluir: false });
  });

  it('NaN (dato corrupto) SÍ entra: no se descarta en silencio, lo cazará el builder', () => {
    const r = pendientePorFacturar(NaN, 0, 0);
    expect(Number.isNaN(r.cantidad)).toBe(true);
    expect(r.incluir).toBe(true);
  });
});

// Facturas de Zoho aún sin enviar (draft/approved): la OV ya figura 'invoiced' y sus
// líneas ya cuentan esa cantidad en quantity_invoiced, pero el pedido de World Office
// todavía no se ha cargado. Caso real 01/10/26: AM1495..AM1504 (approved) sacaron del
// archivo las OV-2026-168/173/175..182. Esa cantidad vuelve a "pendiente para WO".
describe('facturas sin enviar siguen pendientes para World Office', () => {
  it('facturadaEnviada descuenta lo facturado sin enviar', () => {
    expect(facturadaEnviada(7, 7)).toBe(0);
    expect(facturadaEnviada(7, 3)).toBe(4);
    expect(facturadaEnviada(0, 0)).toBe(0);
  });

  it('facturadaEnviada no baja de 0 (sin enviar > facturada por descuadre)', () => {
    expect(facturadaEnviada(2, 5)).toBe(0);
  });

  it('facturadaEnviada propaga NaN para que el builder lo cace', () => {
    expect(Number.isNaN(facturadaEnviada(NaN, 0))).toBe(true);
  });

  it('los estados de factura sin enviar son draft y approved', () => {
    expect(DEFAULT_CONFIG.estadosFacturaSinEnviar).toEqual(['draft', 'approved']);
  });

  it('las tres consultas aceptan OV invoiced con factura sin enviar', async () => {
    const llamadas: { sql: string; params: unknown[] }[] = [];
    const db = { query: async (sql: string, params: unknown[]) => (llamadas.push({ sql, params }), { rows: [] }) } as never;
    const filtro = { desde: '2000-01-01', hasta: '2026-12-31' };
    const source = createHubSalesOrderSource(db, DEFAULT_CONFIG);
    await source.ordenesVivas(filtro);
    await source.ordenesAntiguas(filtro);
    await cambiadasDesde(db, DEFAULT_CONFIG, filtro, null);
    expect(llamadas).toHaveLength(3);
    for (const { sql, params } of llamadas) {
      expect(sql).toContain("so.status = 'invoiced'");
      expect(sql).toContain('books.invoices');
      expect(params).toContainEqual(DEFAULT_CONFIG.estadosFacturaSinEnviar);
    }
  });

  it('una OV invoiced con su factura approved sale con la cantidad completa', async () => {
    const fila = {
      salesorder_id: '1', salesorder_number: 'OV-2026-179', fecha: '2026-09-25', customer_name: 'Ambienciq',
      currency_code: 'COP', nit: '800153696', fecha_entrega: null, forma_pago: null, plazo_pago: '15',
      descuento_cabecera: null, line_item_id: 'L1', quantity: 2, rate: 476000, sku: 'AMB-STDIAMOAPNA-001',
      item_name: 'Rep', descuento: null, cantidad_facturada: '2', cantidad_cancelada: null,
      cantidad_sin_enviar: '2', centro_costos: null,
    };
    const db = { query: async () => ({ rows: [fila] }) } as never;
    const [ov] = await createHubSalesOrderSource(db, DEFAULT_CONFIG).ordenesVivas({ desde: '2000-01-01', hasta: '2026-12-31' });
    expect(ov.lineas.map((l) => l.cantidad)).toEqual([2]);
    expect(ov.cantidadFacturada).toBe(0);
  });
});
