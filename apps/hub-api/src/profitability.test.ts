import { describe, it, expect, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { getProfitabilityData } from './profitability.js';

// TEST-710 — la app calcula el margen a partir de products (costo/precio) y sales
// (importe = Σ bcy_rate*quantity). Se verifica el mapeo de las 2 consultas a sus
// claves y que el importe de ventas conserve la fórmula y el filtro void/draft.

const isSales = (sql: string) => /invoice_line_items/.test(sql);

describe('profitability — getProfitabilityData', () => {
  it('mapea las 2 consultas a { products, sales }', async () => {
    const query = vi.fn(async (sql: string) =>
      isSales(sql) ? { rows: [{ Cliente: 'ACME' }] } : { rows: [{ 'Código de Producto': 'SKU1' }] });
    const data = await getProfitabilityData({ query } as unknown as Pool);
    expect(data.products[0]['Código de Producto']).toBe('SKU1');
    expect(data.sales[0].Cliente).toBe('ACME');
  });

  it('SQL de ventas: importe = Σ bcy_rate*quantity y excluye void/draft', async () => {
    let salesSql = '';
    const query = vi.fn(async (sql: string) => { if (isSales(sql)) salesSql = sql; return { rows: [] }; });
    await getProfitabilityData({ query } as unknown as Pool);
    expect(salesSql).toMatch(/SUM\(li\.bcy_rate \* li\.quantity\)/);
    expect(salesSql).toMatch(/inv\.status NOT IN \('void', 'draft'\)/);
  });
});
