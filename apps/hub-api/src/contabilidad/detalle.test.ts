import { describe, it, expect } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { buildLineas, getDetalleFactura, getDetalleOV, type LineaRow } from './detalle.js';

describe('buildLineas — por despachar', () => {
  it('mapea las unidades pendientes de la línea (0 si no hay)', () => {
    const r = buildLineas([
      { sku: 'A', nombre: 'x', cantidad: 3, precio: 10, por_despachar: 2 },
      { sku: 'B', nombre: 'y', cantidad: 1, precio: 10, por_despachar: null },
    ] as LineaRow[]);
    expect(r[0].porDespachar).toBe(2);
    expect(r[1].porDespachar).toBe(0);
  });
});

describe('buildLineas', () => {
  it('mapea y calcula total = cantidad * precio', () => {
    const rows: LineaRow[] = [
      { sku: 'CIL-1', nombre: 'Cilindro', cantidad: 3, precio: 100, por_despachar: 0 },
      { sku: null, nombre: null, cantidad: null, precio: null, por_despachar: null },
    ];
    const r = buildLineas(rows);
    expect(r[0]).toEqual({ sku: 'CIL-1', nombre: 'Cilindro', cantidad: 3, precio: 100, total: 300, porDespachar: 0 });
    expect(r[1]).toEqual({ sku: '', nombre: '', cantidad: 0, precio: 0, total: 0, porDespachar: 0 });
  });

  it('valores no numéricos → 0 (no rompe)', () => {
    const r = buildLineas([{ sku: 'X', nombre: 'Y', cantidad: 'n/a' as unknown as number, precio: '' as unknown as number, por_despachar: null }]);
    expect(r[0].total).toBe(0);
  });
});

describe('detalle — moneda del documento', () => {
  const fakeDb = (head: Record<string, unknown>) => {
    const queries: string[] = [];
    const db = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: queries.length === 1 ? [head] : [] };
      },
    } as unknown as Pool;
    return { db, queries };
  };

  it('la factura selecciona currency_code y lo normaliza a mayúsculas', async () => {
    const { db, queries } = fakeDb({ invoice_number: 'F1', moneda: ' usd ' });
    expect((await getDetalleFactura(db, 'F1'))?.moneda).toBe('USD');
    expect(queries[0]).toContain("i.raw ->> 'currency_code'");
  });

  it('la OV selecciona currency_code y lo normaliza a mayúsculas', async () => {
    const { db, queries } = fakeDb({ salesorder_number: 'OV1', moneda: 'eur' });
    expect((await getDetalleOV(db, 'OV1'))?.moneda).toBe('EUR');
    expect(queries[0]).toContain("so.raw ->> 'currency_code'");
  });

  it('sin moneda (null o vacía) → COP', async () => {
    expect((await getDetalleFactura(fakeDb({ invoice_number: 'F1', moneda: null }).db, 'F1'))?.moneda).toBe('COP');
    expect((await getDetalleOV(fakeDb({ salesorder_number: 'OV1', moneda: '  ' }).db, 'OV1'))?.moneda).toBe('COP');
  });
});
