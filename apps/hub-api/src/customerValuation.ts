import type { Pool } from '@algarpibe/zoho-sync';

// Feeds the "Valoración de Clientes" SPA (customer-valuation), replacing its five
// Excel uploads with hub data. Shapes are keyed so the SPA's hub loader maps them
// directly to its record types (SalesRecord, MasterCostRecord, InvoiceRecord,
// PaymentRecord, CustomerSalesYearRecord). Ambientalia itself is excluded.

export interface CustomerValuationData {
  sales: Record<string, unknown>[];
  master: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  salesHistory: Record<string, unknown>[];
}

const NOT_AMBIENTALIA = `inv.customer_name IS NOT NULL AND inv.customer_name NOT ILIKE '%ambientalia%'`;

// Ventas por cliente × SKU × año (líneas de factura). Importe en USD (bcy_rate).
const SALES_SQL = `
  SELECT inv.customer_name                                        AS "Cliente",
         it.sku                                                   AS "SKU",
         MAX(COALESCE(it.raw ->> 'manufacturer', it.raw ->> 'brand', '')) AS "Marca",
         MAX(it.name)                                             AS "Nombre del articulo",
         MAX(it.category_name)                                    AS "Categoria",
         extract(year from inv.date)::int                         AS "Anio",
         SUM(li.quantity)                                         AS "Cantidad vendida",
         SUM(li.bcy_rate * li.quantity)                           AS "Importe"
    FROM books.invoice_line_items li
    JOIN books.invoices inv ON inv.invoice_id = li.invoice_id
    JOIN books.items it     ON it.item_id     = li.item_id
   WHERE inv.status NOT IN ('void', 'draft')
     AND ${NOT_AMBIENTALIA}
     AND it.sku IS NOT NULL AND it.sku <> ''
   GROUP BY inv.customer_name, it.sku, extract(year from inv.date)`;

// Base maestra de productos: costo de compra, fabricante, categoría.
const MASTER_SQL = `
  SELECT sku                                                 AS "Codigo de Producto",
         COALESCE(raw ->> 'manufacturer', raw ->> 'brand', '') AS "Fabricante",
         category_name                                       AS "Categoria",
         name                                                AS "Nombre de Producto",
         COALESCE(purchase_rate, 0)                          AS "Costo"
    FROM books.items
   WHERE sku IS NOT NULL AND sku <> ''`;

// Facturas (cabecera). balance viene del raw de Zoho, fallback a total.
const INVOICES_SQL = `
  SELECT inv.invoice_number                                        AS "Numero de factura",
         inv.customer_name                                         AS "Cliente",
         inv.date::text                                            AS "Fecha de la factura",
         inv.due_date::text                                        AS "Fecha de vencimiento",
         inv.status                                                AS "Estado",
         inv.total                                                 AS "Total",
         COALESCE(NULLIF((inv.raw::jsonb) ->> 'balance', '')::numeric, inv.total, 0) AS "Saldo"
    FROM books.invoices inv
   WHERE ${NOT_AMBIENTALIA}
   ORDER BY inv.date`;

// Pagos: una fila por factura aplicada. Monto en USD (BCY = aplicado × tasa).
const PAYMENTS_SQL = `
  SELECT p.payment_number                                    AS "Numero de pago",
         p.customer_name                                     AS "Cliente",
         cpi.invoice_number                                  AS "Numero de factura",
         p.date::text                                        AS "Fecha",
         cpi.amount_applied * COALESCE(p.exchange_rate, 1)   AS "Importe (BCY)"
    FROM books.customer_payments p
    JOIN books.customer_payment_invoices cpi ON cpi.payment_id = p.payment_id
   WHERE p.customer_name IS NOT NULL AND p.customer_name NOT ILIKE '%ambientalia%'`;

// Histórico de ventas por cliente × año (USD), desde líneas de factura.
const SALES_HISTORY_SQL = `
  SELECT inv.customer_name                 AS "Cliente",
         extract(year from inv.date)::int  AS "Anio",
         SUM(li.bcy_rate * li.quantity)    AS "Ventas"
    FROM books.invoice_line_items li
    JOIN books.invoices inv ON inv.invoice_id = li.invoice_id
   WHERE inv.status NOT IN ('void', 'draft')
     AND ${NOT_AMBIENTALIA}
   GROUP BY inv.customer_name, extract(year from inv.date)`;

export async function getCustomerValuationData(db: Pool): Promise<CustomerValuationData> {
  const [sales, master, invoices, payments, salesHistory] = await Promise.all([
    db.query(SALES_SQL),
    db.query(MASTER_SQL),
    db.query(INVOICES_SQL),
    db.query(PAYMENTS_SQL),
    db.query(SALES_HISTORY_SQL),
  ]);
  return {
    sales: sales.rows,
    master: master.rows,
    invoices: invoices.rows,
    payments: payments.rows,
    salesHistory: salesHistory.rows,
  };
}
