import type { Pool } from '@algarpibe/zoho-sync';
import { ESTADOS_OV_POR_FACTURAR } from '../salesOrderStatus.js';

// OV pendientes de facturar ENRIQUECIDAS con las señales "facturable" para la app
// Contabilidad. NO reusar en el Conciliador (ese usa salesOrders.ts sin joins).

export interface OVPendienteFacturable {
  salesorder_number: string;
  date: string;
  customer_name: string | null;
  status: string;
  currency_code: string | null;
  total: number;
  pending: number;
  shipment_date: string | null;
  despachada: boolean;        // shipped_status ∈ {fulfilled, partially_shipped}
  soloPaquete: boolean;       // tiene paquete && !despachada
  ticketPorFacturar: boolean; // ticket de la OV (vía deal) en estado 'Por Facturar'
  facturable: boolean;        // despachada || soloPaquete || ticketPorFacturar
  ticket: string | null;      // nº de ticket de la OV (crm.deals.numero_ticket vía deal)
}

// Una fila por LÍNEA de OV (mismo motivo que salesOrders.ts: cantidades en texto).
// shipped_status/tiene_paquete/ticket_por_facturar son por ORDEN (iguales en todas
// sus líneas), calculados en SQL.
export interface LineRow {
  salesorder_id: string;
  salesorder_number: string;
  date: string;
  customer_name: string | null;
  status: string;
  currency_code: string | null;
  shipment_date: string | null;
  shipped_status: string | null;
  tiene_paquete: boolean;
  ticket_por_facturar: boolean;
  ticket: string | null;
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
         so.raw ->> 'shipped_status'                AS shipped_status,
         (jsonb_typeof(so.raw -> 'packages') = 'array'
           AND jsonb_array_length(so.raw -> 'packages') > 0) AS tiene_paquete,
         EXISTS (
           SELECT 1
             FROM crm.deals d
             JOIN desk.tickets t ON t.number = d.numero_ticket
            WHERE d.id = NULLIF(so.raw ->> 'zcrm_potential_id', '')
              AND t.status = 'Por Facturar'
         )                                          AS ticket_por_facturar,
         (SELECT d.numero_ticket::text
            FROM crm.deals d
           WHERE d.id = NULLIF(so.raw ->> 'zcrm_potential_id', '')
           LIMIT 1)                                  AS ticket,
         li.quantity,
         li.rate,
         NULLIF(li.raw ->> 'quantity_invoiced', '') AS cantidad_facturada,
         NULLIF(li.raw ->> 'quantity_cancelled', '') AS cantidad_cancelada
    FROM books.sales_orders so
    LEFT JOIN books.salesorder_line_items li ON li.salesorder_id = so.salesorder_id
   WHERE so.status = ANY($1::text[])
   ORDER BY so.date, so.salesorder_number`;

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const DESPACHADO = new Set(['fulfilled', 'partially_shipped']);

/** Agrega las líneas a una fila por orden con las señales "facturable". */
export function aggregateFacturables(rows: LineRow[]): OVPendienteFacturable[] {
  const byId = new Map<string, OVPendienteFacturable>();
  for (const r of rows) {
    let o = byId.get(r.salesorder_id);
    if (!o) {
      const despachada = DESPACHADO.has(r.shipped_status ?? '');
      const soloPaquete = r.tiene_paquete && !despachada;
      o = {
        salesorder_number: r.salesorder_number,
        date: r.date,
        customer_name: r.customer_name,
        status: r.status,
        currency_code: r.currency_code,
        total: 0,
        pending: 0,
        shipment_date: r.shipment_date,
        despachada,
        soloPaquete,
        ticketPorFacturar: r.ticket_por_facturar,
        facturable: despachada || soloPaquete || r.ticket_por_facturar,
        ticket: r.ticket,
      };
      byId.set(r.salesorder_id, o);
    }
    const qty = num(r.quantity);
    const rate = num(r.rate);
    const pendienteUds = Math.max(0, qty - num(r.cantidad_facturada) - num(r.cantidad_cancelada));
    o.total += qty * rate;
    o.pending += pendienteUds * rate;
  }
  return [...byId.values()].sort((a, b) => b.pending - a.pending);
}

/** Consulta + agrega las OV por facturar con las señales "facturable". */
export async function getOVPendientesFacturables(db: Pool): Promise<OVPendienteFacturable[]> {
  const { rows } = await db.query(SQL, [[...ESTADOS_OV_POR_FACTURAR]]);
  return aggregateFacturables(rows as LineRow[]);
}
