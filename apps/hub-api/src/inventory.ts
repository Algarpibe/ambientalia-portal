import type { Pool } from '@algarpibe/zoho-sync';

// Feeds the "Análisis de Inventario" SPA (inventory-optimization), replacing its
// six Excel uploads with hub data:
// - sales{year}: monthly quantities sold per SKU (invoice lines by month/year).
// - inventory: current stock from books.items (reorder level, on-hand, committed,
//   available, manufacturer).
// - leadTime: per-item lead time from the Zoho "Lead Time" custom field (in the
//   item raw). Returns null until the field is created + populated in Zoho.
// Keys match what the SPA's calculations read (flexible key matching).

export interface InventoryData {
  sales2026: Record<string, unknown>[];
  sales2025: Record<string, unknown>[];
  sales2024: Record<string, unknown>[];
  sales2023: Record<string, unknown>[];
  inventory: Record<string, unknown>[];
  leadTime: Record<string, unknown>[];
}

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const SALES_BY_YEAR_SQL = `
  SELECT it.sku                AS sku,
         MAX(it.name)          AS item_name,
         MAX(it.category_name) AS category_name,
         ${MONTHS.map((m, i) => `SUM(CASE WHEN extract(month from inv.date) = ${i + 1} THEN li.quantity ELSE 0 END) AS "${m}"`).join(',\n         ')},
         AVG(li.bcy_rate)      AS average_price
    FROM books.invoice_line_items li
    JOIN books.invoices inv ON inv.invoice_id = li.invoice_id
    JOIN books.items it     ON it.item_id     = li.item_id
   WHERE inv.status NOT IN ('void', 'draft')
     AND extract(year from inv.date) = $1
     AND it.sku IS NOT NULL AND it.sku <> ''
   GROUP BY it.sku`;

// NULLIF(...,'') guards against service/non-inventory items whose Zoho stock
// fields come as empty strings ("") instead of numbers, which would break ::numeric.
// "Cantidad pedida" (por recibir) is the exact outstanding across open purchase
// orders per item = SUM(quantity - received - cancelled), from books.purchase_orders.
const INVENTORY_SQL = `
  SELECT it.sku                                                  AS "SKU (Código de artículo)",
         it.name                                                 AS "Nombre del artículo",
         COALESCE(it.raw ->> 'manufacturer', it.raw ->> 'brand', '') AS "Fabricante",
         COALESCE(NULLIF(it.raw ->> 'reorder_level', '')::numeric, -1)         AS "Nivel de reposición",
         COALESCE(NULLIF(it.raw ->> 'stock_on_hand', '')::numeric, 0)          AS "Existencias a mano",
         COALESCE(NULLIF(it.raw ->> 'actual_available_stock', '')::numeric, 0) AS "Existencias físicas",
         COALESCE(NULLIF(it.raw ->> 'stock_on_hand', '')::numeric, 0)
           - COALESCE(NULLIF(it.raw ->> 'available_for_sale', '')::numeric, NULLIF(it.raw ->> 'available_stock', '')::numeric, 0) AS "Existencias comprometidas",
         COALESCE(NULLIF(it.raw ->> 'available_for_sale', '')::numeric, NULLIF(it.raw ->> 'available_stock', '')::numeric, 0) AS "Disponible para la venta",
         COALESCE(por.por_recibir, 0) AS "Cantidad pedida"
    FROM books.items it
    LEFT JOIN (
      SELECT poli.item_id,
             SUM(GREATEST(COALESCE(poli.quantity, 0) - COALESCE(poli.quantity_received, 0) - COALESCE(poli.quantity_cancelled, 0), 0)) AS por_recibir
        FROM books.purchase_order_line_items poli
        JOIN books.purchase_orders po ON po.purchaseorder_id = poli.purchaseorder_id
       WHERE po.status NOT IN ('draft', 'cancelled')
       GROUP BY poli.item_id
    ) por ON por.item_id = it.item_id
   WHERE it.sku IS NOT NULL AND it.sku <> ''`;

// Lead time: prefer the Zoho item "Lead Time" custom field (cf_lead_time, synced
// into the item raw as the user fills it in Zoho); fall back to the seeded
// public.item_lead_times table (from the Importar Excel) for items not yet set
// in Zoho. Requires public.item_lead_times to exist (see seed_lead_times.sql).
const LEAD_TIME_SQL = `
  SELECT it.sku                                 AS "Código de Producto",
         COALESCE(it.raw ->> 'manufacturer', '') AS "Fabricante",
         COALESCE(
           NULLIF(it.raw ->> 'cf_lead_time', ''),
           NULLIF(it.raw -> 'custom_field_hash' ->> 'cf_lead_time', ''),
           lt.lead_time_days::text
         )                                       AS "Lead Time"
    FROM books.items it
    LEFT JOIN public.item_lead_times lt ON lt.sku = it.sku
   WHERE it.sku IS NOT NULL AND it.sku <> ''`;

export async function getInventoryData(db: Pool): Promise<InventoryData> {
  const [s2026, s2025, s2024, s2023, inv, lt] = await Promise.all([
    db.query(SALES_BY_YEAR_SQL, [2026]),
    db.query(SALES_BY_YEAR_SQL, [2025]),
    db.query(SALES_BY_YEAR_SQL, [2024]),
    db.query(SALES_BY_YEAR_SQL, [2023]),
    db.query(INVENTORY_SQL),
    db.query(LEAD_TIME_SQL),
  ]);
  return {
    sales2026: s2026.rows,
    sales2025: s2025.rows,
    sales2024: s2024.rows,
    sales2023: s2023.rows,
    inventory: inv.rows,
    leadTime: lt.rows,
  };
}
