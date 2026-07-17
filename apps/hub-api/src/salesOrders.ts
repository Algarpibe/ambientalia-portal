import type { Pool } from '@algarpibe/zoho-sync';
import { ESTADOS_OV_POR_FACTURAR } from './salesOrderStatus.js';

// Órdenes de venta pendientes de facturar (Conciliador de Pagos). Devuelve una
// fila por ORDEN, agregando sus líneas: total del pedido y valor aún por facturar.
// Reutiliza la definición de "por facturar" compartida con WO-sales.

export interface PendingSalesOrder {
  salesorder_number: string;
  date: string;             // fecha de la OV (ISO date)
  customer_name: string | null;
  status: string;           // 'open' | 'overdue' | 'partially_invoiced'
  currency_code: string | null;
  total: number;            // Σ (cantidad × tarifa) de las líneas
  pending: number;          // Σ (max(0, cantidad − facturada − cancelada) × tarifa)
  shipment_date: string | null; // fecha de entrega prevista, si existe
}

// Una fila por LÍNEA de OV viva (se agregan por orden en TS, no en SQL: las
// cantidades vienen como texto en raw y castearlas en SQL puede abortar la
// consulta, mismo motivo que en wo-sales/hub.source.ts).
interface LineRow {
  salesorder_id: string;
  salesorder_number: string;
  date: string;
  customer_name: string | null;
  status: string;
  currency_code: string | null;
  shipment_date: string | null;
  quantity: number | null;
  rate: number | null;
  cantidad_facturada: string | null;
  cantidad_cancelada: string | null;
}

const SQL = `
  SELECT so.salesorder_id,
         so.salesorder_number,
         so.date::text                              AS date,
         so.customer_name,
         so.status,
         so.currency_code,
         NULLIF(so.raw ->> 'shipment_date', '')     AS shipment_date,
         li.quantity,
         li.rate,
         NULLIF(li.raw ->> 'quantity_invoiced', '') AS cantidad_facturada,
         NULLIF(li.raw ->> 'quantity_cancelled', '') AS cantidad_cancelada
    FROM books.sales_orders so
    LEFT JOIN books.salesorder_line_items li ON li.salesorder_id = so.salesorder_id
   WHERE so.status = ANY($1::text[])
   ORDER BY so.date, so.salesorder_number`;

/** Número tolerante: null/''/no-numérico → 0 (un dato ausente no debe romper la suma). */
function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Agrega las filas de línea a una fila por orden con total y pendiente por facturar. */
export function aggregatePendingOrders(rows: LineRow[]): PendingSalesOrder[] {
  const byId = new Map<string, PendingSalesOrder>();

  for (const r of rows) {
    let order = byId.get(r.salesorder_id);
    if (!order) {
      order = {
        salesorder_number: r.salesorder_number,
        date: r.date,
        customer_name: r.customer_name,
        status: r.status,
        currency_code: r.currency_code,
        total: 0,
        pending: 0,
        shipment_date: r.shipment_date,
      };
      byId.set(r.salesorder_id, order);
    }

    const qty = num(r.quantity);
    const rate = num(r.rate);
    const facturada = num(r.cantidad_facturada);
    const cancelada = num(r.cantidad_cancelada);
    const pendienteUds = Math.max(0, qty - facturada - cancelada);

    order.total += qty * rate;
    order.pending += pendienteUds * rate;
  }

  // Del pendiente más alto al más bajo: lo que más queda por facturar, primero.
  return [...byId.values()].sort((a, b) => b.pending - a.pending);
}

/** Consulta y agrega las OV por facturar. */
export async function getPendingSalesOrders(db: Pool): Promise<PendingSalesOrder[]> {
  const { rows } = await db.query(SQL, [[...ESTADOS_OV_POR_FACTURAR]]);
  return aggregatePendingOrders(rows as LineRow[]);
}
