import { describe, it, expect, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { getInventoryData } from './inventory.js';

// TEST-710 — el mapeo año→clave es crítico: las 4 consultas anuales son el MISMO
// SQL con distinto parámetro de año, y si el orden se altera la app mostraría la
// demanda de un año bajo la etiqueta de otro (bug financiero silencioso).

const isSalesByYear = (sql: string) => /extract\(month from so\.date\)/.test(sql);

describe('inventory — getInventoryData', () => {
  it('mapea cada consulta anual a su clave correcta (sales2026←2026, …)', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) =>
      isSalesByYear(sql) ? { rows: [{ sku: 'X', anioParam: params?.[0] }] } : { rows: [] });
    const data = await getInventoryData({ query } as unknown as Pool);
    expect(data.sales2026[0].anioParam).toBe(2026);
    expect(data.sales2025[0].anioParam).toBe(2025);
    expect(data.sales2024[0].anioParam).toBe(2024);
    expect(data.sales2023[0].anioParam).toBe(2023);
  });

  it('usa exactamente los años 2023-2026 en las consultas anuales', async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] }));
    await getInventoryData({ query } as unknown as Pool);
    const years = query.mock.calls
      .filter(([sql]) => isSalesByYear(sql))
      .map(([, params]) => params?.[0])
      .sort();
    expect(years).toEqual([2023, 2024, 2025, 2026]);
  });

  it('SQL de inventario: comprometido = Σ GREATEST(cant − entregado − cancelado), gated por track_inventory, excluye void/draft/pending_approval', async () => {
    let invSql = '';
    const query = vi.fn(async (sql: string) => {
      if (/"Existencias comprometidas"/.test(sql)) invSql = sql;
      return { rows: [] };
    });
    await getInventoryData({ query } as unknown as Pool);
    expect(invSql).toMatch(/GREATEST\(/);
    expect(invSql).toMatch(/quantity_delivered/);
    expect(invSql).toMatch(/quantity_cancelled/);
    expect(invSql).toMatch(/track_inventory/);
    expect(invSql).toMatch(/so\.status NOT IN \('void', 'draft', 'pending_approval'\)/);
  });

  it('devuelve las 6 claves (4 años + inventory + leadTime)', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const data = await getInventoryData({ query } as unknown as Pool);
    expect(Object.keys(data).sort()).toEqual(
      ['inventory', 'leadTime', 'sales2023', 'sales2024', 'sales2025', 'sales2026'],
    );
  });
});
