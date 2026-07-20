import type { Pool } from '@algarpibe/zoho-sync';
import type { MarginYearRow, RecordTypeIO } from './types.js';

const SOURCES = {
  SALES_ORDER: { lines: 'books.salesorder_line_items', header: 'books.sales_orders', fk: 'salesorder_id' },
  INVOICE: { lines: 'books.invoice_line_items', header: 'books.invoices', fk: 'invoice_id' },
} as const;

const VENTAS = `round(sum(l.bcy_rate * l.quantity *
  COALESCE(1 - COALESCE((h.raw->>'bcy_discount_total')::numeric, 0) / NULLIF(h.bcy_sub_total, 0), 1)
)::numeric, 2)::float8`;
const COSTO = `round(sum(NULLIF(it.raw->>'purchase_rate','')::numeric * l.quantity)::numeric, 2)::float8`;
const COMMON_WHERE = `l.bcy_rate IS NOT NULL
      AND h.status NOT IN ('void','draft')
      AND NULLIF(it.raw->>'purchase_rate','')::numeric > 0`;

export function mapMarginYearRow(r: Record<string, unknown>): MarginYearRow {
  const ventas = Number(r.ventas);
  const costo = Number(r.costo);
  return { year: Number(r.year), ventas: Number.isFinite(ventas) ? ventas : 0, costo: Number.isFinite(costo) ? costo : 0 };
}

export async function getMarginByYearRows(db: Pool, f: { tipo: RecordTypeIO }): Promise<MarginYearRow[]> {
  const s = f.tipo === 'SALES_ORDER' ? SOURCES.SALES_ORDER : SOURCES.INVOICE;
  const sql = `
    SELECT extract(year from h.date)::int AS year, ${VENTAS} AS ventas, ${COSTO} AS costo
    FROM ${s.lines} l
    JOIN ${s.header} h ON h.${s.fk} = l.${s.fk}
    JOIN books.items it ON it.item_id = l.item_id
    WHERE ${COMMON_WHERE}
    GROUP BY 1
    ORDER BY 1`;
  const { rows } = await db.query(sql);
  return (rows as Record<string, unknown>[]).map(mapMarginYearRow);
}
