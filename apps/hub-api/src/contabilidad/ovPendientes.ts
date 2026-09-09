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
//
// El SQL NO decide si se puede armar el paquete: solo reporta los cinco números que
// hacen falta y la regla vive en `lineaArmable` (abajo), donde sí se puede testear.
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
  es_mercancia: boolean;         // product_type = 'goods' (los servicios no se empaquetan)
  seguimiento_stock: boolean;    // track_inventory del artículo
  stock_fisico: string | null;   // actual_available_stock del artículo
  comprometido: string | null;   // lo pendiente de ESTE artículo en TODAS las OV vivas
  por_recibir: string | null;    // lo comprado y aún sin recibir (OC abiertas)
  falta: string | null;          // lo pendiente de ESTA línea
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
  ), oc AS (
    -- Unidades YA COMPRADAS y aún sin recibir, por artículo. Mismo criterio que el
    -- "por recibir" de inventory.ts: una OC en borrador o anulada no compra nada.
    SELECT poli.item_id,
           SUM(GREATEST(COALESCE(poli.quantity, 0)
                        - COALESCE(poli.quantity_received, 0)
                        - COALESCE(poli.quantity_cancelled, 0), 0)) AS por_recibir
      FROM books.purchase_order_line_items poli
      JOIN books.purchase_orders po ON po.purchaseorder_id = poli.purchaseorder_id
     WHERE po.status NOT IN ('draft', 'cancelled')
     GROUP BY poli.item_id
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
         -- Los cinco números de la regla de stock; quien decide es lineaArmable().
         -- product_type ausente → se asume 'goods' (conservador: exige seguimiento+stock).
         (COALESCE(NULLIF(it.raw ->> 'product_type', ''), 'goods') = 'goods') AS es_mercancia,
         COALESCE(NULLIF(it.raw ->> 'track_inventory', '')::boolean, false)   AS seguimiento_stock,
         COALESCE(NULLIF(it.raw ->> 'actual_available_stock', '')::numeric, 0) AS stock_fisico,
         COALESCE(cmp.comprometido, 0)               AS comprometido,
         COALESCE(oc.por_recibir, 0)                 AS por_recibir,
         GREATEST(COALESCE(li.quantity, 0)
                  - COALESCE(NULLIF(li.raw ->> 'quantity_delivered', '')::numeric, 0)
                  - COALESCE(NULLIF(li.raw ->> 'quantity_cancelled', '')::numeric, 0), 0) AS falta,
         li.quantity,
         li.rate,
         NULLIF(li.raw ->> 'quantity_invoiced', '') AS cantidad_facturada,
         NULLIF(li.raw ->> 'quantity_cancelled', '') AS cantidad_cancelada
    FROM books.sales_orders so
    LEFT JOIN books.salesorder_line_items li ON li.salesorder_id = so.salesorder_id
    -- items.item_id es PK y comp/oc van agrupados por artículo: no multiplican filas.
    LEFT JOIN books.items it ON it.item_id = li.item_id
    LEFT JOIN comp cmp ON cmp.item_id = li.item_id
    LEFT JOIN oc        ON oc.item_id  = li.item_id
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

/**
 * ¿Cuenta esta línea para armar el paquete? Solo la mercancía que aún falta: los
 * SERVICIOS no se despachan (su contador se queda en 0 de por vida) y lo ya entregado
 * no hay que prepararlo. Si una OV no tiene NINGUNA línea así, no hay paquete que armar.
 */
function cuentaParaArmar(r: LineRow): boolean {
  return r.es_mercancia && num(r.falta) > 0;
}

/**
 * ¿Alcanza el estante para esta línea?
 *
 * Disponible = físico − lo que OTRAS OV se van a llevar DEL ESTANTE. Y eso no es todo lo
 * que reclaman: lo que ya está comprado en una OC abierta llega de fábrica, no sale del
 * estante, así que no debe bloquearlo. Caso que lo destapó: OV-2026-163 con la tarjeta
 * 1142.A4 — 2 físicas y 6 comprometidas por OV-2026-153 y OV-2026-156, que esperaban
 * las OC-2026-049 y OC-2026-057 (3+3, sin recibir). Reservaban dos veces la misma unidad.
 *
 * El tope en 0 es lo que impide que un exceso de OC invente stock: nunca promete
 * mercancía en tránsito, solo deja de reservar por partida doble. Por eso este cambio
 * únicamente puede ENCENDER luces, nunca apagar una que ya estuviera encendida.
 *
 * Un producto SIN seguimiento de inventario (track_inventory=false) BLOQUEA: no tenemos
 * stock que consultar, así que no podemos afirmar que se pueda armar. Antes se eximía
 * (pensando en servicios) y encendía la luz en falso — p. ej. OV-2026-146 con
 * CIL-MULT-CA05-1.4M3, que es 'goods' sin seguimiento. Ante la duda, no se marca.
 */
function lineaArmable(r: LineRow): boolean {
  const falta = num(r.falta);
  const comprometidoPorOtras = num(r.comprometido) - falta;
  const bloqueado = Math.max(0, comprometidoPorOtras - num(r.por_recibir));
  return r.seguimiento_stock && num(r.stock_fisico) - bloqueado >= falta;
}

/** Agrega las líneas a una fila por orden con las señales "facturable". */
export function aggregateFacturables(rows: LineRow[]): OVPendienteFacturable[] {
  const byId = new Map<string, OVPendienteFacturable>();
  // Por orden: si tiene alguna línea que armar, y si TODAS ellas alcanzan.
  const armado = new Map<string, { hayLinea: boolean; todas: boolean }>();
  for (const r of rows) {
    let o = byId.get(r.salesorder_id);
    if (!o) {
      const despachada = r.shipped_status === COMPLETO;
      const despachoParcial = r.shipped_status === PARCIAL;
      // Con despacho (completo o parcial) ya no aplica "sólo paquete" ni "por crear":
      // esas dos señalan OV que todavía no han movido mercancía.
      const soloPaquete = r.tiene_paquete && !despachada && !despachoParcial;
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
        // Ambas se resuelven al final: hacen falta TODAS las líneas de la orden.
        paquetePorCrear: false,
        facturable: false,
        ticket: r.ticket,
        trato: r.trato ?? '',
        qt: r.qt ?? '',
      };
      byId.set(r.salesorder_id, o);
      armado.set(r.salesorder_id, { hayLinea: false, todas: true });
    }
    if (cuentaParaArmar(r)) {
      const a = armado.get(r.salesorder_id)!;
      a.hayLinea = true;
      a.todas = a.todas && lineaArmable(r);
    }
    const qty = num(r.quantity);
    const rate = num(r.rate);
    const pendienteUds = Math.max(0, qty - num(r.cantidad_facturada) - num(r.cantidad_cancelada));
    o.total += qty * rate;
    o.pending += pendienteUds * rate;
  }
  for (const [id, o] of byId) {
    const a = armado.get(id)!;
    o.paquetePorCrear = a.hayLinea && a.todas
      && !o.despachada && !o.despachoParcial && !o.soloPaquete;
    o.facturable = o.despachada || o.despachoParcial || o.soloPaquete
      || o.ticketPorFacturar || o.paquetePorCrear;
  }
  return [...byId.values()].sort((a, b) => b.pending - a.pending);
}

/** Consulta + agrega las OV por facturar con las señales "facturable". */
export async function getOVPendientesFacturables(db: Pool): Promise<OVPendienteFacturable[]> {
  const { rows } = await db.query(SQL, [[...ESTADOS_OV_POR_FACTURAR]]);
  return aggregateFacturables(rows as LineRow[]);
}
