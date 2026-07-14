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
         -- Comprometido (base FÍSICA) = Σ (cantidad − entregado − cancelado) de las OV
         -- abiertas. Zoho NO sincroniza 'committed_stock' (viene vacío) y 'available_stock'
         -- queda igual al a-mano, así que el comprometido hay que calcularlo desde las
         -- líneas. Esto reconstruye exacto el bloque "Existencias físicas" de Zoho.
         -- Disponible = a-mano FÍSICO (actual_available_stock) − comprometido, para que
         -- reconcilien: p. ej. Disposition 16 − 21 = −5 (idéntico a Zoho).
         COALESCE(com.comprometido, 0) AS "Existencias comprometidas",
         COALESCE(NULLIF(it.raw ->> 'actual_available_stock', '')::numeric, 0) - COALESCE(com.comprometido, 0) AS "Disponible para la venta",
         COALESCE(it.purchase_rate, 0) AS "Costo",
         -- Precio de venta configurado en el ítem de Zoho (maestro, no el facturado).
         COALESCE(NULLIF(it.raw ->> 'rate', '')::numeric, 0) AS "Precio de venta",
         -- Estado del artículo en Zoho ('active'/'inactive'). Permite excluir del
         -- análisis de reposición los artículos dados de baja/sustituidos.
         COALESCE(NULLIF(it.raw ->> 'status', ''), 'active') AS "Estado del artículo",
         -- ¿El artículo hace seguimiento de inventario en Zoho? ('true'/'false').
         -- Define "con seguimiento" (Análisis Principal), independiente del
         -- reorder_level (que muchos artículos no tienen configurado).
         COALESCE(it.raw ->> 'track_inventory', 'false') AS "Seguimiento inventario",
         COALESCE(por.por_recibir, 0) AS "Cantidad pedida",
         por.proxima_oc_fecha AS "Fecha OC próxima",
         COALESCE(por.proxima_oc_num, por.ultima_oc_num, '') AS "OC Número",
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
             )::text AS proxima_oc_fecha,
             -- Nº de OC a mostrar: la OC abierta más próxima (con saldo pendiente);
             -- si ninguna está abierta, la OC más reciente.
             (array_agg(po.raw ->> 'purchaseorder_number' ORDER BY po.date ASC)
               FILTER (WHERE GREATEST(COALESCE(poli.quantity, 0) - COALESCE(poli.quantity_received, 0) - COALESCE(poli.quantity_cancelled, 0), 0) > 0))[1] AS proxima_oc_num,
             (array_agg(po.raw ->> 'purchaseorder_number' ORDER BY po.date DESC))[1] AS ultima_oc_num
        FROM books.purchase_order_line_items poli
        JOIN books.purchase_orders po ON po.purchaseorder_id = poli.purchaseorder_id
       WHERE po.status NOT IN ('draft', 'cancelled')
       GROUP BY poli.item_id
    ) por ON por.item_id = it.item_id
    LEFT JOIN (
      -- Comprometido real = Σ (cantidad − entregado − cancelado) de las líneas de OV
      -- cuyo pedido NO está anulado, en borrador ni pendiente de aprobación (solo
      -- órdenes confirmadas reservan stock). Las OV ya facturadas/entregadas aportan 0
      -- porque quantity_delivered = quantity. Validado: Xenon 3030020915 = 2 (open+overdue).
      SELECT soli.item_id,
             SUM(GREATEST(
               COALESCE(soli.quantity, 0)
               - COALESCE(NULLIF(soli.raw ->> 'quantity_delivered', '')::numeric, 0)
               - COALESCE(NULLIF(soli.raw ->> 'quantity_cancelled', '')::numeric, 0), 0)) AS comprometido
        FROM books.salesorder_line_items soli
        JOIN books.sales_orders so ON so.salesorder_id = soli.salesorder_id
       WHERE so.status NOT IN ('void', 'draft', 'pending_approval')
       GROUP BY soli.item_id
    ) com ON com.item_id = it.item_id
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

// Lead time (POR AHORA): SOLO el valor sembrado desde el Excel de importación
// (public.item_lead_times, columna G de "Importar_120726"). Un artículo sin valor
// en esa tabla queda con lead time 0 → aparece en el análisis pero sin sugerencia
// de pedido hasta que se cargue su lead time.
//
// MEJORAS FUTURAS (aún no implementadas — no estamos preparados para ello):
//   1) Tomar el lead time del campo habilitado de Zoho (cf_lead_time).
//   2) Calcular el lead time REAL = tiempo entre la OC y la recepción
//      (min fecha de recepción − fecha de la OC), con su desviación, cuando el
//      artículo tenga suficientes OC recibidas.
const LEAD_TIME_SQL = `
  SELECT it.sku                                  AS "Código de Producto",
         COALESCE(it.raw ->> 'manufacturer', '') AS "Fabricante",
         seed.lead_time_days::text               AS "Lead Time",
         0                                        AS "Lead Time Desv",
         'Manual'                                 AS "Lead Time Fuente",
         0                                        AS "Lead Time N"
    FROM books.items it
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
