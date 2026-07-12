import type { Pool } from '@algarpibe/zoho-sync';

// Feeds the "Rentabilidad Clientes" SPA, replacing its two Excel uploads:
// - products (the "Base Maestra R22"): item master from books.items, with the
//   purchase cost + manufacturer that Zoho already stores.
// - sales (the "Archivo de Ventas"): invoice lines aggregated by customer+item,
//   with amounts in the base currency (USD): bcy_rate * quantity.
// Keys match what the SPA's Dashboard reads, so its margin logic is untouched.

export interface ProfitabilityData {
  products: Record<string, unknown>[];
  sales: Record<string, unknown>[];
}

const PRODUCTS_SQL = `
  SELECT sku                                                 AS "Código de Producto",
         COALESCE(raw ->> 'manufacturer', raw ->> 'brand', '') AS "Fabricante",
         category_name                                       AS "Categoría",
         name                                                AS "Nombre de Producto",
         purchase_rate                                       AS "Precio de Compra por unidad",
         rate                                                AS "Precio de Venta por unidad"
    FROM books.items
   WHERE sku IS NOT NULL AND sku <> ''`;

const SALES_SQL = `
  SELECT inv.customer_name                                            AS "Cliente",
         MAX(it.sku)                                                  AS "SKU",
         MAX(COALESCE(it.raw ->> 'manufacturer', it.raw ->> 'brand', '')) AS "Marca",
         MAX(it.name)                                                AS "Nombre del artículo",
         SUM(li.quantity)                                            AS "Cantidad vendida",
         SUM(li.bcy_rate * li.quantity)                              AS "Importe"
    FROM books.invoice_line_items li
    JOIN books.invoices inv ON inv.invoice_id = li.invoice_id
    JOIN books.items it     ON it.item_id     = li.item_id
   WHERE inv.status NOT IN ('void', 'draft')
     AND li.bcy_rate IS NOT NULL
     AND it.sku IS NOT NULL AND it.sku <> ''
   GROUP BY inv.customer_name, it.item_id`;

export async function getProfitabilityData(db: Pool): Promise<ProfitabilityData> {
  const [products, sales] = await Promise.all([db.query(PRODUCTS_SQL), db.query(SALES_SQL)]);
  return { products: products.rows, sales: sales.rows };
}
