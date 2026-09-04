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
  despachada: boolean;        // shipped_status = 'fulfilled' (despacho COMPLETO)
  despachoParcial: boolean;   // shipped_status = 'partially_shipped' (salió parte, falta mercancía)
  soloPaquete: boolean;       // tiene paquete && sin despacho (ni completo ni parcial)
  ticketPorFacturar: boolean; // ticket de la OV (vía deal) en estado 'Por Facturar'
  paquetePorCrear: boolean;   // hay stock disponible para armar el paquete (y aún no hay despacho ni paquete)
  facturable: boolean;        // cualquiera de los indicios anteriores
  ticket: string | null;      // nº de ticket de la OV (crm.deals.numero_ticket vía deal)
  trato: string;              // crm.deals.deal_name del deal enlazado
  qt: string;                 // nº de la última cotización del deal (crm.quotes.no_cotizacion)
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
  puede_armarse: boolean;
  ticket: string | null;
  trato: string | null;
  qt: string | null;
  quantity: number | null;
  rate: number | null;
  cantidad_facturada: string | null;
  cantidad_cancelada: string | null;
}

const SQL = `
  WITH pend AS (
    -- Líneas aún por despachar de TODAS las OV vivas (base del comprometido).
    SELECT so2.salesorder_id, li2.item_id,
           GREATEST(COALESCE(li2.quantity, 0)
                    - COALESCE(NULLIF(li2.raw ->> 'quantity_delivered', '')::numeric, 0)
                    - COALESCE(NULLIF(li2.raw ->> 'quantity_cancelled', '')::numeric, 0), 0) AS falta
      FROM books.sales_orders so2
      JOIN books.salesorder_line_items li2 ON li2.salesorder_id = so2.salesorder_id
     WHERE so2.status = ANY($1::text[])
  ), comp AS (
    -- Comprometido por artículo = suma de lo pendiente en todas las OV vivas.
    SELECT item_id, SUM(falta) AS comprometido FROM pend GROUP BY item_id
  ), armable AS (
    -- ¿Alcanza el stock DISPONIBLE para todas las líneas de PRODUCTO pendientes de la OV?
    -- Disponible = físico − comprometido por OTRAS OV (se resta la propia 'falta').
    --
    -- Solo se evalúan las líneas con product_type='goods' (mercancía): los SERVICIOS no
    -- se despachan, así que se excluyen del cálculo. Si la OV no tiene ninguna línea de
    -- producto, no hay paquete que armar → sin fila aquí → puede_armarse=false abajo.
    --
    -- Un producto SIN seguimiento de inventario (track_inventory=false) BLOQUEA: no
    -- tenemos stock que consultar, así que no podemos afirmar que se pueda armar. Antes
    -- se eximía (pensando en servicios) y encendía la luz en falso — p. ej. OV-2026-146
    -- con CIL-MULT-CA05-1.4M3, que es 'goods' sin seguimiento. Ante la duda, no se marca.
    SELECT p.salesorder_id,
           bool_and(
             COALESCE(NULLIF(it.raw ->> 'track_inventory', '')::boolean, false) = true
             AND COALESCE(NULLIF(it.raw ->> 'actual_available_stock', '')::numeric, 0)
                 - (COALESCE(c.comprometido, 0) - p.falta) >= p.falta
           ) AS puede_armarse
      FROM pend p
      LEFT JOIN books.items it ON it.item_id = p.item_id
      LEFT JOIN comp c ON c.item_id = p.item_id
     WHERE p.falta > 0
       -- product_type ausente → se asume 'goods' (conservador: exige seguimiento+stock).
       AND COALESCE(NULLIF(it.raw ->> 'product_type', ''), 'goods') = 'goods'
     GROUP BY p.salesorder_id
  )
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
         d.numero_ticket::text                       AS ticket,
         d.deal_name                                 AS trato,
         qt.no_cotizacion                            AS qt,
         COALESCE(arm.puede_armarse, false)          AS puede_armarse,
         li.quantity,
         li.rate,
         NULLIF(li.raw ->> 'quantity_invoiced', '') AS cantidad_facturada,
         NULLIF(li.raw ->> 'quantity_cancelled', '') AS cantidad_cancelada
    FROM books.sales_orders so
    LEFT JOIN books.salesorder_line_items li ON li.salesorder_id = so.salesorder_id
    LEFT JOIN armable arm ON arm.salesorder_id = so.salesorder_id
    -- Trato y ticket salen del deal de CRM enlazado por raw->>'zcrm_potential_id'
    -- (crm.deals.id es PK, así que este join no multiplica filas).
    LEFT JOIN crm.deals d ON d.id = NULLIF(so.raw ->> 'zcrm_potential_id', '')
    -- QT = nº de la última cotización del deal, misma regla que la tabla de facturación.
    LEFT JOIN LATERAL (
           SELECT q.no_cotizacion
             FROM crm.quotes q
            WHERE q.deal_id = d.id
            ORDER BY q.fecha_cotizacion DESC NULLS LAST, q.created_time DESC
            LIMIT 1
         ) qt ON TRUE
   WHERE so.status = ANY($1::text[])
   ORDER BY so.date, so.salesorder_number`;

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Zoho distingue tres estados de despacho; los separamos porque mezclar 'fulfilled' con
// 'partially_shipped' en una sola luz ocultaba que a la OV aún le falta mercancía por enviar.
const COMPLETO = 'fulfilled';
const PARCIAL = 'partially_shipped';

/** Agrega las líneas a una fila por orden con las señales "facturable". */
export function aggregateFacturables(rows: LineRow[]): OVPendienteFacturable[] {
  const byId = new Map<string, OVPendienteFacturable>();
  for (const r of rows) {
    let o = byId.get(r.salesorder_id);
    if (!o) {
      const despachada = r.shipped_status === COMPLETO;
      const despachoParcial = r.shipped_status === PARCIAL;
      // Con despacho (completo o parcial) ya no aplica "sólo paquete" ni "por crear":
      // esas dos señalan OV que todavía no han movido mercancía.
      const soloPaquete = r.tiene_paquete && !despachada && !despachoParcial;
      const paquetePorCrear = r.puede_armarse && !despachada && !despachoParcial && !soloPaquete;
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
        despachoParcial,
        soloPaquete,
        ticketPorFacturar: r.ticket_por_facturar,
        paquetePorCrear,
        facturable: despachada || despachoParcial || soloPaquete || r.ticket_por_facturar || paquetePorCrear,
        ticket: r.ticket,
        trato: r.trato ?? '',
        qt: r.qt ?? '',
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
