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
     AND inv.date >= make_date($1::int, 1, 1)
     AND inv.date <  make_date($1::int + 1, 1, 1)
     AND it.sku IS NOT NULL AND it.sku <> ''
     AND (it.raw ->> 'status') IS DISTINCT FROM 'inactive'
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
         COALESCE(it.purchase_rate, 0) AS "Costo",
         -- Estado del artículo en Zoho ('active'/'inactive'). Permite excluir del
         -- análisis de reposición los artículos dados de baja/sustituidos.
         COALESCE(NULLIF(it.raw ->> 'status', ''), 'active') AS "Estado del artículo",
         COALESCE(por.por_recibir, 0) AS "Cantidad pedida",
         por.proxima_oc_fecha AS "Fecha OC próxima",
         -- Proveedor real: el vendor más frecuente en las OC pasadas del artículo,
         -- con fallback al Fabricante y luego a un literal.
         COALESCE(ven.vendor_name, NULLIF(it.raw ->> 'manufacturer', ''), NULLIF(it.raw ->> 'brand', ''), 'Sin proveedor') AS "Proveedor"
    FROM books.items it
    LEFT JOIN (
      SELECT poli.item_id,
             SUM(GREATEST(COALESCE(poli.quantity, 0) - COALESCE(poli.quantity_received, 0) - COALESCE(poli.quantity_cancelled, 0), 0)) AS por_recibir,
             -- Fecha de la OC abierta más próxima a llegar (la más antigua con saldo
             -- pendiente): fecha OC + lead time = ETA de la próxima entrada de stock.
             MIN(po.date) FILTER (
               WHERE GREATEST(COALESCE(poli.quantity, 0) - COALESCE(poli.quantity_received, 0) - COALESCE(poli.quantity_cancelled, 0), 0) > 0
             )::text AS proxima_oc_fecha
        FROM books.purchase_order_line_items poli
        JOIN books.purchase_orders po ON po.purchaseorder_id = poli.purchaseorder_id
       WHERE po.status NOT IN ('draft', 'cancelled')
       GROUP BY poli.item_id
    ) por ON por.item_id = it.item_id
    LEFT JOIN (
      SELECT item_id, vendor_name FROM (
        SELECT poli.item_id, po.vendor_name,
               ROW_NUMBER() OVER (
                 PARTITION BY poli.item_id
                 ORDER BY COUNT(*) DESC, MAX(po.date) DESC
               ) AS rn
          FROM books.purchase_order_line_items poli
          JOIN books.purchase_orders po ON po.purchaseorder_id = poli.purchaseorder_id
         WHERE po.vendor_name IS NOT NULL AND po.vendor_name <> ''
         GROUP BY poli.item_id, po.vendor_name
      ) ranked WHERE rn = 1
    ) ven ON ven.item_id = it.item_id
   WHERE it.sku IS NOT NULL AND it.sku <> ''
     AND (it.raw ->> 'status') IS DISTINCT FROM 'inactive'`;

// Lead time: prefer the REAL lead time computed from received purchase orders
// (min receive date − order date), when the item has >= 3 received POs — with its
// standard deviation for the safety-stock formula. Otherwise fall back to the
// manual value: the Zoho item "Lead Time" custom field (cf_lead_time), then the
// seeded public.item_lead_times table (from the Importar Excel).
const LEAD_TIME_SQL = `
  WITH po_lt AS (
    SELECT poli.item_id,
           ((SELECT MIN(NULLIF(r ->> 'date', '')::date)
               FROM jsonb_array_elements(po.raw -> 'purchasereceives') r) - po.date) AS lt_days
      FROM books.purchase_order_line_items poli
      JOIN books.purchase_orders po ON po.purchaseorder_id = poli.purchaseorder_id
     WHERE po.date IS NOT NULL
       AND jsonb_typeof(po.raw -> 'purchasereceives') = 'array'
       AND jsonb_array_length(po.raw -> 'purchasereceives') > 0
  ),
  lt_stats AS (
    SELECT item_id,
           round(avg(lt_days))::int              AS lt_avg,
           round(COALESCE(stddev_pop(lt_days), 0))::int AS lt_std,
           count(*)::int                         AS lt_n
      FROM po_lt
     WHERE lt_days IS NOT NULL AND lt_days >= 0
     GROUP BY item_id
  )
  SELECT it.sku                                  AS "Código de Producto",
         COALESCE(it.raw ->> 'manufacturer', '') AS "Fabricante",
         CASE WHEN s.lt_n >= 3 THEN s.lt_avg::text
              ELSE COALESCE(
                NULLIF(it.raw ->> 'cf_lead_time', ''),
                NULLIF(it.raw -> 'custom_field_hash' ->> 'cf_lead_time', ''),
                seed.lead_time_days::text
              ) END                              AS "Lead Time",
         CASE WHEN s.lt_n >= 3 THEN s.lt_std ELSE 0 END AS "Lead Time Desv",
         CASE WHEN s.lt_n >= 3 THEN 'Calculado' ELSE 'Manual' END AS "Lead Time Fuente",
         COALESCE(s.lt_n, 0)                     AS "Lead Time N"
    FROM books.items it
    LEFT JOIN lt_stats s ON s.item_id = it.item_id
    LEFT JOIN public.item_lead_times seed ON seed.sku = it.sku
   WHERE it.sku IS NOT NULL AND it.sku <> ''
     AND (it.raw ->> 'status') IS DISTINCT FROM 'inactive'`;

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
