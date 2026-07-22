import { describe, it, expect, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { getInvoices, getPayments, getReconciliationData } from './reconciliation.js';

// TEST-710 — cobertura del núcleo financiero de conciliación. Sin BD real: un pool
// falso registra las llamadas y devuelve filas de fixture. Se verifica el paso de
// parámetros de rango, el mapeo a InvoiceDetails/PaymentRecord y la invariante BCY.

function poolReturning(rowsBySql: (sql: string) => Record<string, unknown>[]) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => ({ rows: rowsBySql(sql) }));
  return { pool: { query } as unknown as Pool, query };
}

describe('reconciliation — getInvoices', () => {
  it('con rango pasa [from,to] y filtra por i.date', async () => {
    const { pool, query } = poolReturning(() => []);
    await getInvoices(pool, '2026-01-01', '2026-12-31');
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual(['2026-01-01', '2026-12-31']);
    expect(sql).toMatch(/WHERE i\.date BETWEEN \$1 AND \$2/);
  });

  it('sin rango no pasa params ni WHERE', async () => {
    const { pool, query } = poolReturning(() => []);
    await getInvoices(pool);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([]);
    expect(sql).not.toMatch(/WHERE/);
  });

  it('mapea filas a InvoiceDetails con total/balance numéricos', async () => {
    const { pool } = poolReturning(() => [{
      invoice_number: 'FV-1', reference_number: 'OV-1', customer_name: 'ACME',
      date: '2026-01-05', due_date: '2026-02-05', status: 'sent', total: 100, balance: '40',
    }]);
    const inv = await getInvoices(pool);
    expect(inv[0]).toEqual({
      invoiceNumber: 'FV-1', orderNumber: 'OV-1', clientName: 'ACME',
      invoiceDate: '2026-01-05', dueDate: '2026-02-05', status: 'sent', total: 100, balance: 40,
    });
  });
});

describe('reconciliation — getPayments', () => {
  it('el SQL deriva BCY = amount_applied * COALESCE(exchange_rate, 1)', async () => {
    const { pool, query } = poolReturning(() => []);
    await getPayments(pool);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/cpi\.amount_applied \* COALESCE\(p\.exchange_rate, 1\)/);
  });

  it('con rango filtra por p.date y pasa [from,to]', async () => {
    const { pool, query } = poolReturning(() => []);
    await getPayments(pool, '2026-01-01', '2026-06-30');
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual(['2026-01-01', '2026-06-30']);
    expect(sql).toMatch(/WHERE p\.date BETWEEN \$1 AND \$2/);
  });
});

describe('reconciliation — getReconciliationData', () => {
  it('devuelve { invoices, payments } mapeados', async () => {
    const { pool } = poolReturning((sql) =>
      /customer_payments/.test(sql)
        ? [{ payment_number: 'RC-1', customer_name: 'ACME', invoice_number: 'FV-1', date: '2026-01-10', amount_fcy: 10, amount_bcy: 42 }]
        : [{ invoice_number: 'FV-1', total: 100, balance: 40 }]);
    const data = await getReconciliationData(pool);
    expect(data.invoices).toHaveLength(1);
    expect(data.payments).toHaveLength(1);
    expect(data.invoices[0].invoiceNumber).toBe('FV-1');
    expect(data.payments[0].amountBCY).toBe(42);
  });
});
