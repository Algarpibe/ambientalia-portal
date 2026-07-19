import type { Pool } from '@algarpibe/zoho-sync';
import type { CustomerYearRow, RecordTypeIO } from './types.js';

const SOURCES = {
  SALES_ORDER: { lines: 'books.salesorder_line_items', header: 'books.sales_orders', fk: 'salesorder_id' },
  INVOICE: { lines: 'books.invoice_line_items', header: 'books.invoices', fk: 'invoice_id' },
} as const;

/** Coacciona una fila cruda del hub al contrato CustomerYearRow (pura, testeable). */
export function mapCustomerYearRow(r: Record<string, unknown>): CustomerYearRow {
  const ventas = Number(r.ventas);
  return {
    customer: String(r.customer),
    year: Number(r.year),
    ventas: Number.isFinite(ventas) ? ventas : 0,
  };
}

/** Ventas por cliente y año (rango), neto de descuento de cabecera. Lee del zoho-hub. */
export async function getCustomerSalesRows(
  db: Pool,
  f: { tipo: RecordTypeIO; desdeAnio: number; hastaAnio: number },
): Promise<CustomerYearRow[]> {
  const src = f.tipo === 'SALES_ORDER' ? SOURCES.SALES_ORDER : SOURCES.INVOICE;
  const sql = `
    SELECT h.customer_name AS customer,
           extract(year from h.date)::int AS year,
           round(sum(l.bcy_rate * l.quantity *
             COALESCE(1 - COALESCE((h.raw->>'bcy_discount_total')::numeric, 0) / NULLIF(h.bcy_sub_total, 0), 1)
           )::numeric, 2)::float8 AS ventas
    FROM ${src.lines} l
    JOIN ${src.header} h ON h.${src.fk} = l.${src.fk}
    WHERE extract(year from h.date) BETWEEN $1 AND $2
      AND l.bcy_rate IS NOT NULL
      AND h.status NOT IN ('void','draft')
      AND h.customer_name IS NOT NULL
    GROUP BY h.customer_name, extract(year from h.date)`;
  const { rows } = await db.query(sql, [f.desdeAnio, f.hastaAnio]);
  return (rows as Record<string, unknown>[]).map(mapCustomerYearRow);
}
