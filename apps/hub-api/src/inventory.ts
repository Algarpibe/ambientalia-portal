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

const INVENTORY_SQL = `
  SELECT sku                                                  AS "SKU (Código de artículo)",
         name                                                 AS "Nombre del artículo",
         COALESCE(raw ->> 'manufacturer', raw ->> 'brand', '') AS "Fabricante",
         COALESCE((raw ->> 'reorder_level')::numeric, -1)     AS "Nivel de reposición",
         COALESCE((raw ->> 'stock_on_hand')::numeric, 0)      AS "Existencias a mano",
         COALESCE((raw ->> 'stock_on_hand')::numeric, 0)
           - COALESCE((raw ->> 'available_for_sale')::numeric, (raw ->> 'available_stock')::numeric, 0) AS "Existencias comprometidas",
         COALESCE((raw ->> 'available_for_sale')::numeric, (raw ->> 'available_stock')::numeric, 0) AS "Disponible para la venta"
    FROM books.items
   WHERE sku IS NOT NULL AND sku <> ''`;

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
