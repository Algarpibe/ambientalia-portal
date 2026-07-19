import type { Pool } from '@algarpibe/zoho-sync';
import type { CustomerMonthRow, RecordTypeIO } from './types.js';

const SOURCES = {
  SALES_ORDER: { lines: 'books.salesorder_line_items', header: 'books.sales_orders', fk: 'salesorder_id' },
  INVOICE: { lines: 'books.invoice_line_items', header: 'books.invoices', fk: 'invoice_id' },
} as const;

export function mapCustomerMonthRow(r: Record<string, unknown>): CustomerMonthRow {
  const importe = Number(r.importe);
  return { customer: String(r.customer), mes: Number(r.mes), importe: Number.isFinite(importe) ? importe : 0 };
}

export async function getCustomerMonthSalesRows(db: Pool, f: { tipo: RecordTypeIO; anio: number }): Promise<CustomerMonthRow[]> {
  const src = f.tipo === 'SALES_ORDER' ? SOURCES.SALES_ORDER : SOURCES.INVOICE;
  const sql = `
    SELECT h.customer_name AS customer,
           extract(month from h.date)::int AS mes,
           round(sum(l.bcy_rate * l.quantity *
             COALESCE(1 - COALESCE((h.raw->>'bcy_discount_total')::numeric, 0) / NULLIF(h.bcy_sub_total, 0), 1)
           )::numeric, 2)::float8 AS importe
    FROM ${src.lines} l
    JOIN ${src.header} h ON h.${src.fk} = l.${src.fk}
    WHERE extract(year from h.date) = $1
      AND l.bcy_rate IS NOT NULL
      AND h.status NOT IN ('void','draft')
      AND h.customer_name IS NOT NULL
    GROUP BY h.customer_name, extract(month from h.date)`;
  const { rows } = await db.query(sql, [f.anio]);
  return (rows as Record<string, unknown>[]).map(mapCustomerMonthRow);
}
