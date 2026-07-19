import type { Pool } from '@algarpibe/zoho-sync';
import type { CustomerItemRow, RecordTypeIO } from './types.js';

const SOURCES = {
  SALES_ORDER: { lines: 'books.salesorder_line_items', header: 'books.sales_orders', fk: 'salesorder_id' },
  INVOICE: { lines: 'books.invoice_line_items', header: 'books.invoices', fk: 'invoice_id' },
} as const;

export function mapCustomerItemRow(r: Record<string, unknown>): CustomerItemRow {
  const cantidad = Number(r.cantidad);
  const importe = Number(r.importe);
  return {
    customer: String(r.customer),
    sku: (r.sku as string | null) ?? null,
    marca: (r.marca as string | null) ?? null,
    nombre: String(r.nombre ?? ''),
    categoria: (r.categoria as string | null) ?? null,
    cantidad: Number.isFinite(cantidad) ? cantidad : 0,
    importe: Number.isFinite(importe) ? importe : 0,
  };
}

export async function getCustomerItemSalesRows(db: Pool, f: { tipo: RecordTypeIO; anio: number }): Promise<CustomerItemRow[]> {
  const src = f.tipo === 'SALES_ORDER' ? SOURCES.SALES_ORDER : SOURCES.INVOICE;
  const sql = `
    SELECT h.customer_name AS customer, it.sku, it.raw->>'manufacturer' AS marca,
           it.name AS nombre, it.category_name AS categoria,
           sum(l.quantity) AS cantidad,
           round(sum(l.bcy_rate * l.quantity *
             COALESCE(1 - COALESCE((h.raw->>'bcy_discount_total')::numeric,0) / NULLIF(h.bcy_sub_total,0), 1)
           )::numeric, 2)::float8 AS importe
    FROM ${src.lines} l
    JOIN ${src.header} h ON h.${src.fk} = l.${src.fk}
    JOIN books.items it ON it.item_id = l.item_id
    WHERE extract(year from h.date) = $1
      AND l.bcy_rate IS NOT NULL
      AND h.status NOT IN ('void','draft')
      AND h.customer_name IS NOT NULL
    GROUP BY h.customer_name, it.sku, it.raw->>'manufacturer', it.name, it.category_name`;
  const { rows } = await db.query(sql, [f.anio]);
  return (rows as Record<string, unknown>[]).map(mapCustomerItemRow);
}
