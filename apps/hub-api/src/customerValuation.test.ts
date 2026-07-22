import { describe, it, expect, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { getCustomerValuationData } from './customerValuation.js';

// TEST-710 — 5 consultas → 5 claves; el orden importa (una permutación mandaría
// pagos donde van ventas, etc.). Además se blindan invariantes de negocio:
// exclusión de Ambientalia en todas las consultas con cliente, fórmula BCY, y
// exclusión de facturas void/draft.

// Fragmentos únicos por consulta (columnas exclusivas de cada SELECT).
function tag(sql: string): string | null {
  if (/"Cantidad vendida"/.test(sql)) return 'sales';
  if (/"Codigo de Producto"/.test(sql)) return 'master';
  if (/"Saldo"/.test(sql)) return 'invoices';
  if (/"Numero de pago"/.test(sql)) return 'payments';
  if (/"Ventas"/.test(sql)) return 'salesHistory';
  return null;
}

describe('customerValuation — getCustomerValuationData', () => {
  it('mapea las 5 consultas a sus 5 claves', async () => {
    const query = vi.fn(async (sql: string) => ({ rows: [{ k: tag(sql) }] }));
    const data = await getCustomerValuationData({ query } as unknown as Pool);
    expect(data.sales[0].k).toBe('sales');
    expect(data.master[0].k).toBe('master');
    expect(data.invoices[0].k).toBe('invoices');
    expect(data.payments[0].k).toBe('payments');
    expect(data.salesHistory[0].k).toBe('salesHistory');
  });

  it('todas las consultas con cliente excluyen a Ambientalia', async () => {
    const sqls: string[] = [];
    const query = vi.fn(async (sql: string) => { sqls.push(sql); return { rows: [] }; });
    await getCustomerValuationData({ query } as unknown as Pool);
    expect(sqls).toHaveLength(5);
    const withCustomer = sqls.filter((s) => /customer_name/.test(s));
    expect(withCustomer.length).toBeGreaterThanOrEqual(4); // master (books.items) no tiene cliente
    for (const s of withCustomer) expect(s).toMatch(/ambientalia/i);
  });

  it('SQL: ventas usan bcy_rate*quantity + excluyen void/draft; pagos derivan BCY', async () => {
    const sqls: string[] = [];
    const query = vi.fn(async (sql: string) => { sqls.push(sql); return { rows: [] }; });
    await getCustomerValuationData({ query } as unknown as Pool);
    const salesSql = sqls.find((s) => /"Cantidad vendida"/.test(s))!;
    expect(salesSql).toMatch(/SUM\(li\.bcy_rate \* li\.quantity\)/);
    expect(salesSql).toMatch(/status NOT IN \('void', 'draft'\)/);
    const paySql = sqls.find((s) => /"Numero de pago"/.test(s))!;
    expect(paySql).toMatch(/cpi\.amount_applied \* COALESCE\(p\.exchange_rate, 1\)/);
  });
});
