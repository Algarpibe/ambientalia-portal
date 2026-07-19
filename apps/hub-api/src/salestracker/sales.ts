import type { Pool } from '@algarpibe/zoho-sync';
import type { SalesRow, RecordType } from './types.js';

// Portado de salestracker-next/src/db/hub-sales.ts (HUB_SALES_AGG_SQL), sin cambios
// de lógica: INVOICE/SALES_ORDER = bcy_rate*qty neto del descuento de cabecera;
// BACKLOG = porción no facturada por orden (invoiced_status). Excluye void/draft.
const HUB_SALES_AGG_SQL = `
WITH ord AS (
  SELECT s.salesorder_id, s.date, (s.raw->>'invoiced_status') st,
    sum(l.bcy_rate*l.quantity) gross
  FROM books.salesorder_line_items l JOIN books.sales_orders s ON s.salesorder_id=l.salesorder_id
  WHERE s.date IS NOT NULL AND l.bcy_rate IS NOT NULL AND s.status NOT IN ('void','draft')
  GROUP BY 1,2,3
),
oi AS (
  SELECT i.salesorder_id, sum(li.bcy_rate*li.quantity) inv
  FROM books.invoice_line_items li JOIN books.invoices i ON i.invoice_id=li.invoice_id
  WHERE i.salesorder_id IS NOT NULL AND i.salesorder_id<>'' AND li.bcy_rate IS NOT NULL AND i.status NOT IN ('void','draft')
  GROUP BY 1
),
frac AS (
  SELECT o.salesorder_id, o.date,
    CASE WHEN o.st='not_invoiced' THEN 1
         WHEN o.st='partially_invoiced' AND o.gross>0 THEN greatest(0,(o.gross-coalesce(oi.inv,0))/o.gross)
         ELSE 0 END f
  FROM ord o LEFT JOIN oi ON oi.salesorder_id=o.salesorder_id
),
lines AS (
  SELECT it.category_name cat,'INVOICE' rt, extract(year from i.date)::int yy, extract(month from i.date)::int mm,
    l.bcy_rate*l.quantity * COALESCE(1 - COALESCE((i.raw->>'bcy_discount_total')::numeric,0)/NULLIF(i.bcy_sub_total,0),1) amt
  FROM books.invoice_line_items l JOIN books.invoices i ON i.invoice_id=l.invoice_id LEFT JOIN books.items it ON it.item_id=l.item_id
  WHERE i.date IS NOT NULL AND l.bcy_rate IS NOT NULL AND i.status NOT IN ('void','draft')
  UNION ALL
  SELECT it.category_name,'SALES_ORDER', extract(year from s.date)::int, extract(month from s.date)::int,
    l.bcy_rate*l.quantity * COALESCE(1 - COALESCE((s.raw->>'bcy_discount_total')::numeric,0)/NULLIF(s.bcy_sub_total,0),1)
  FROM books.salesorder_line_items l JOIN books.sales_orders s ON s.salesorder_id=l.salesorder_id LEFT JOIN books.items it ON it.item_id=l.item_id
  WHERE s.date IS NOT NULL AND l.bcy_rate IS NOT NULL AND s.status NOT IN ('void','draft')
  UNION ALL
  SELECT it.category_name,'BACKLOG', extract(year from f.date)::int, extract(month from f.date)::int,
    l.bcy_rate*l.quantity * f.f
  FROM books.salesorder_line_items l JOIN frac f ON f.salesorder_id=l.salesorder_id LEFT JOIN books.items it ON it.item_id=l.item_id
  WHERE l.bcy_rate IS NOT NULL AND f.f > 0
)
SELECT cat AS category_name, rt AS record_type, mm AS record_month, yy AS record_year, round(sum(amt),2)::float8 AS amount_usd
FROM lines WHERE cat IS NOT NULL GROUP BY cat, rt, mm, yy
`;

/** Coacciona una fila cruda del hub al contrato SalesRow (función pura, testeable). */
export function mapSalesRow(r: Record<string, unknown>): SalesRow {
  const amount = Number(r.amount_usd);
  return {
    categoryName: String(r.category_name),
    recordType: r.record_type as RecordType,
    month: Number(r.record_month),
    year: Number(r.record_year),
    amountUsd: Number.isFinite(amount) ? amount : 0,
  };
}

/** Ejecuta la agregación de ventas sobre el hub y devuelve las filas ya mapeadas. */
export async function getSalesRows(db: Pool): Promise<SalesRow[]> {
  const { rows } = await db.query(HUB_SALES_AGG_SQL);
  return (rows as Record<string, unknown>[]).map(mapSalesRow);
}
