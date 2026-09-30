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
// Activos E inactivos: el informe de Zoho lista también los inactivos (comparado el
// 30/09/26: 76 inactivos, uno con stock — GRM-SPK-01 con 4). A diferencia de
// INVENTORY_SQL (inventory.ts), que sí los excluye porque allí se decide reorden.
// NULLIF(...,'') porque Zoho manda "" en vez de número en algunos campos de stock.
const INVENTARIO_SQL = `
  SELECT it.sku                                                 AS sku,
         it.name                                                AS item_name,
         COALESCE(NULLIF(it.raw ->> 'stock_on_hand', '')::numeric, 0) AS quantity_available
    FROM books.items it
   WHERE it.sku IS NOT NULL AND it.sku <> ''
     AND COALESCE(it.raw ->> 'track_inventory', 'false') = 'true'
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
// multiplicar filas; se reportan como contexto (no deciden nada, ver mapConsolidacion).
// Facturas en 'approved' (aprobadas pero sin enviar): la línea ya las cuenta en
// quantity_invoiced, pero Zoho no descuenta el stock contable hasta que la factura
// se envía, así que su informe las sigue mostrando como comprometidas (casos
// AMI-2026-001/005/015/016, comparado el 30/09/26). Se devuelven a "por facturar",
// con tope en lo pedido menos lo cancelado.
const LINEAS_SQL = `
  SELECT it.sku                                  AS sku,
         it.name                                 AS item_name,
         so.salesorder_number                    AS transaction,
         so.status                               AS status,
         so.raw ->> 'order_status'               AS order_status,
         so.raw ->> 'shipped_status'             AS shipped_status,
         SUM(GREATEST(LEAST(
                      COALESCE(soli.quantity, 0)
                      - COALESCE(NULLIF(soli.raw ->> 'quantity_cancelled', '')::numeric, 0),
                      COALESCE(soli.quantity, 0)
                      - COALESCE(NULLIF(soli.raw ->> 'quantity_invoiced', '')::numeric, 0)
                      - COALESCE(NULLIF(soli.raw ->> 'quantity_cancelled', '')::numeric, 0)
                      + COALESCE((SELECT SUM(li.quantity)
                                    FROM books.invoice_line_items li
                                    JOIN books.invoices i ON i.invoice_id = li.invoice_id
                                   WHERE i.salesorder_id = so.salesorder_id
                                     AND li.item_id = soli.item_id
                                     AND i.status = 'approved'), 0)), 0)) AS por_facturar,
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

// Mandan las LÍNEAS, no el estado de la orden, igual que el informe de Zoho. Un guard
// por estado (closed/invoiced/fulfilled) escondía justo los casos de facturas
// 'approved' (OVI-2026-005 está closed+invoiced y Zoho la cuenta), y verificado en la
// réplica el 30/09/26 no había ninguna orden vieja con contadores de línea erróneos
// que ese guard estuviera tapando.
const porFacturar = (r: LineaComprometidaRow) => num(r.por_facturar);
const porEnviar = (r: LineaComprometidaRow) => num(r.por_enviar);

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
