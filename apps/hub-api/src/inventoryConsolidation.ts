import type { Pool } from '@algarpibe/zoho-sync';

// Alimenta el "Consolidador de Inventario" (inventory-consolidation) con los mismos
// tres listados que hoy se exportan a mano de Zoho, para generar el xlsx sin subir
// archivos:
// - inventory ← "Resumen de inventario": sku, item_name, quantity_available (a mano CONTABLE).
// - fact      ← "Detalles de existencias comprometidas" contable: una fila por
//               artículo×OV con lo pendiente de FACTURAR.
// - env       ← el mismo informe en base física: una fila por artículo×OV con lo
//               pendiente de ENVIAR/entregar.
// Las fórmulas (físicas = contable − ENV; disponible = contable − FACT) siguen en el
// frontend (processInventoryData), igual que con los archivos.
//
// Regla de la casa: el SQL solo REPORTA números y estados; quién cuenta como "por
// facturar" / "por enviar" lo decide mapConsolidacion(), que es donde se testea.

export interface InventarioRow {
  sku: string;
  item_name: string;
  quantity_available: string | number | null;
}

/** Una fila por artículo×OV (varias líneas del mismo artículo en la OV ya sumadas). */
export interface LineaComprometidaRow {
  sku: string;
  item_name: string;
  transaction: string;               // salesorder_number (la "Transacción#" del informe)
  status: string;                    // estado de facturación de la OV (open, invoiced…)
  order_status: string | null;       // raw->>'order_status' (closed = orden terminada)
  shipped_status: string | null;     // raw->>'shipped_status' (fulfilled = despacho completo)
  por_facturar: string | number | null; // Σ GREATEST(cant − facturado − cancelado, 0)
  por_enviar: string | number | null;   // Σ GREATEST(cant − entregado − cancelado, 0)
}

export interface ComprometidoItem {
  sku: string;
  item_name: string;
  quantity: number;
  transaction: string;
}

export interface InventoryConsolidationData {
  inventory: { sku: string; item_name: string; quantity_available: number }[];
  fact: ComprometidoItem[];
  env: ComprometidoItem[];
  generatedAt: string;
}

// Solo artículos CON seguimiento de inventario: el "Resumen de inventario" de Zoho
// es un informe de stock y un servicio/alquiler no tiene existencias.
// Activos solamente: mismo criterio que INVENTORY_SQL (inventory.ts), que excluye
// los 'inactive' (dados de baja/sustituidos). Un inactivo con OV viva quedaría
// fuera del xlsx — validar contra una exportación de Zoho del mismo día.
// NULLIF(...,'') porque Zoho manda "" en vez de número en algunos campos de stock.
const INVENTARIO_SQL = `
  SELECT it.sku                                                 AS sku,
         it.name                                                AS item_name,
         COALESCE(NULLIF(it.raw ->> 'stock_on_hand', '')::numeric, 0) AS quantity_available
    FROM books.items it
   WHERE it.sku IS NOT NULL AND it.sku <> ''
     AND COALESCE(it.raw ->> 'track_inventory', 'false') = 'true'
     AND (it.raw ->> 'status') IS DISTINCT FROM 'inactive'
   ORDER BY it.sku`;

// Saldos pendientes por artículo×OV. GREATEST por LÍNEA antes de sumar (una línea
// sobre-facturada no debe restar lo pendiente de otra). Solo OV confirmadas — mismo
// filtro que el comprometido de inventory.ts: anuladas, borradores y pendientes de
// aprobación no reservan stock.
// Solo artículos con seguimiento de inventario: en un servicio 'quantity_delivered'
// se queda en 0 de por vida y saldría como pendiente toda su historia (gotcha de
// inventory.ts / contabilidad/source.ts). Además el Consolidador cruza por el
// inventario, que ya excluye esos artículos.
// Se agrupa por sku+nombre+OV porque el Consolidador toma UNA cantidad por OV y
// artículo (con dos líneas del mismo artículo en la OV se quedaría con la última).
// status/order_status/shipped_status son por ORDEN: entran al GROUP BY sin
// multiplicar filas, y los usa mapConsolidacion() para el guard de órdenes cerradas.
const LINEAS_SQL = `
  SELECT it.sku                                  AS sku,
         it.name                                 AS item_name,
         so.salesorder_number                    AS transaction,
         so.status                               AS status,
         so.raw ->> 'order_status'               AS order_status,
         so.raw ->> 'shipped_status'             AS shipped_status,
         SUM(GREATEST(COALESCE(soli.quantity, 0)
                      - COALESCE(NULLIF(soli.raw ->> 'quantity_invoiced', '')::numeric, 0)
                      - COALESCE(NULLIF(soli.raw ->> 'quantity_cancelled', '')::numeric, 0), 0)) AS por_facturar,
         SUM(GREATEST(COALESCE(soli.quantity, 0)
                      - COALESCE(NULLIF(soli.raw ->> 'quantity_delivered', '')::numeric, 0)
                      - COALESCE(NULLIF(soli.raw ->> 'quantity_cancelled', '')::numeric, 0), 0)) AS por_enviar
    FROM books.salesorder_line_items soli
    JOIN books.sales_orders so ON so.salesorder_id = soli.salesorder_id
    JOIN books.items it        ON it.item_id       = soli.item_id
   WHERE so.status NOT IN ('void', 'draft', 'pending_approval')
     AND it.sku IS NOT NULL AND it.sku <> ''
     AND COALESCE(it.raw ->> 'track_inventory', 'false') = 'true'
   GROUP BY it.sku, it.name, so.salesorder_number, so.status,
            so.raw ->> 'order_status', so.raw ->> 'shipped_status'
   ORDER BY it.sku, so.salesorder_number`;

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Manda el estado de la ORDEN sobre sus líneas: en órdenes viejas los contadores de
// línea no son fiables (contabilidad/source.ts, UNIDADES_POR_DESPACHAR, caso
// FP-454/OV-2021-072: cerrada en 2022 y con las líneas a 0). Una OV cerrada no tiene
// nada pendiente; una OV 'invoiced' no tiene nada por facturar; una 'fulfilled' no
// tiene nada por enviar.
const cerrada = (r: LineaComprometidaRow) => r.order_status === 'closed';
const porFacturar = (r: LineaComprometidaRow) =>
  cerrada(r) || r.status === 'invoiced' ? 0 : num(r.por_facturar);
const porEnviar = (r: LineaComprometidaRow) =>
  cerrada(r) || r.shipped_status === 'fulfilled' ? 0 : num(r.por_enviar);

/** Filas SQL → las tres listas que consume el Consolidador. Pura (testeable). */
export function mapConsolidacion(
  inventario: InventarioRow[],
  lineas: LineaComprometidaRow[],
): Omit<InventoryConsolidationData, 'generatedAt'> {
  const fact: ComprometidoItem[] = [];
  const env: ComprometidoItem[] = [];
  for (const r of lineas) {
    const f = porFacturar(r);
    const e = porEnviar(r);
    if (f > 0) fact.push({ sku: r.sku, item_name: r.item_name, quantity: f, transaction: r.transaction });
    if (e > 0) env.push({ sku: r.sku, item_name: r.item_name, quantity: e, transaction: r.transaction });
  }
  return {
    inventory: inventario.map((r) => ({
      sku: r.sku,
      item_name: r.item_name,
      quantity_available: num(r.quantity_available),
    })),
    fact,
    env,
  };
}

export async function getInventoryConsolidationData(db: Pool): Promise<InventoryConsolidationData> {
  const [inv, lin] = await Promise.all([db.query(INVENTARIO_SQL), db.query(LINEAS_SQL)]);
  return {
    ...mapConsolidacion(inv.rows as InventarioRow[], lin.rows as LineaComprometidaRow[]),
    generatedAt: new Date().toISOString(),
  };
}
