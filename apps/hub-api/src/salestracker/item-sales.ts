import type { Pool } from '@algarpibe/zoho-sync';
import type { ItemSalesRow, RecordTypeIO } from './types.js';

// Tablas por tipo elegidas en servidor (NO input de usuario → sin inyección).
const SOURCES = {
  SALES_ORDER: { lines: 'books.salesorder_line_items', header: 'books.sales_orders', fk: 'salesorder_id' },
  INVOICE: { lines: 'books.invoice_line_items', header: 'books.invoices', fk: 'invoice_id' },
} as const;

/** Coacciona una fila cruda del hub al contrato ItemSalesRow (pura, testeable). */
export function mapItemSalesRow(r: Record<string, unknown>): ItemSalesRow {
  const cantidad = Number(r.cantidad);
  const importe = Number(r.importe);
  return {
    itemId: String(r.item_id),
    sku: (r.sku as string | null) ?? null,
    nombre: String(r.nombre ?? ''),
    categoria: (r.categoria as string | null) ?? null,
    cantidad: Number.isFinite(cantidad) ? cantidad : 0,
    importe: Number.isFinite(importe) ? importe : 0,
  };
}

/** Ventas por artículo entre dos fechas, para OV o FAC. Lee del zoho-hub. */
export async function getItemSalesRows(
  db: Pool,
  f: { tipo: RecordTypeIO; desde: string; hasta: string },
): Promise<ItemSalesRow[]> {
  const src = f.tipo === 'SALES_ORDER' ? SOURCES.SALES_ORDER : SOURCES.INVOICE;
  const sql = `
    SELECT it.item_id, it.sku, it.name AS nombre, it.category_name AS categoria,
           sum(l.quantity) AS cantidad,
           round(sum(l.bcy_rate * l.quantity)::numeric, 2)::float8 AS importe
    FROM ${src.lines} l
    JOIN ${src.header} h ON h.${src.fk} = l.${src.fk}
    JOIN books.items it ON it.item_id = l.item_id
    WHERE h.date BETWEEN $1 AND $2
      AND l.bcy_rate IS NOT NULL
      AND h.status NOT IN ('void','draft')
    GROUP BY it.item_id, it.sku, it.name, it.category_name
    ORDER BY importe DESC`;
  const { rows } = await db.query(sql, [f.desde, f.hasta]);
  return (rows as Record<string, unknown>[]).map(mapItemSalesRow);
}
