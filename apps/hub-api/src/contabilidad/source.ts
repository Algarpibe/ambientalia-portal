import type { Pool } from '@algarpibe/zoho-sync';
import {
  mapFacturaRow,
  dedupeByInvoiceNumber,
  withParticipacion,
  buildResumen,
  type FacturaRawRow,
  type FacturaContable,
  type Resumen,
} from './domain.js';

export interface ContabilidadData {
  facturas: FacturaContable[];
  resumen: Resumen;
  anioActual: number;
  aniosDisponibles: number[];
}

/**
 * Unidades ya FACTURADAS de la OV de una factura que AÚN NO se han EMPAQUETADO.
 *
 * ÚNICA definición del criterio: la usan la luz violeta de la tabla de facturación y el
 * listado de "facturas con entrega pendiente" de la app `ov-pendientes`. Va correlacionado
 * con la factura aliaseada como `i`, así que toda consulta que lo interpole debe llamarla así.
 *
 * Detecta el caso peligroso: una OV facturada sale del listado de "OV pendientes de facturar"
 * y su preparación queda sin seguimiento. Enlace por i.salesorder_id (poblado al 100%).
 *
 * (1) FACTURADO − EMPAQUETADO, no "cantidad − empaquetado". Lo que aún no se ha facturado no
 *     está perdido: su OV sigue viva en el otro listado. Contarlo aquí inflaba el número
 *     (OV-2026-033: 45 uds, 15 facturadas, 10 empaquetadas → el pendiente real es 5, no 20).
 * (2) EMPAQUETADO, no despachado: con entrega por recogida en nuestras instalaciones lo
 *     enviado se queda en 0 hasta que el cliente aparece, y la mercancía ya preparada salía
 *     marcada sin serlo (AM1460/OV-2026-101: 9 de 9 empaquetadas). Si está empaquetado,
 *     bodega ya lo apartó y no se va a perder.
 * (3) Sin SERVICIOS (mano de obra, alquiler…): no se empaquetan, así que su contador se queda
 *     en 0 de por vida y saldrían como pendientes para siempre (gotcha ya visto en inventory.ts).
 * (4) UNA SOLA ALERTA POR OV, en su factura más reciente: una OV facturada en varias parciales
 *     repetía el mismo número en todas (OV-2026-033 salía 5 veces con 20).
 * (5) NADA de órdenes CERRADAS o ya ENVIADAS del todo. En las órdenes antiguas el
 *     `quantity_packed` de las LÍNEAS es 0 aunque la orden esté entregada y cerrada — el dato
 *     de línea solo es fiable en los registros recientes. Sin este guard, FP-454/OV-2021-072
 *     (cerrada y pagada en 2022, 16/16 enviadas) salía con 16 pendientes, y AM1464/OV-2026-128
 *     (`fulfilled`) con 3. Si la orden está cerrada o entregada, no hay nada que preparar:
 *     manda el estado de la orden, no sus líneas.
 */
export const UNIDADES_POR_DESPACHAR = `
         CASE WHEN i.invoice_id = (
                SELECT i2.invoice_id FROM books.invoices i2
                 WHERE i2.salesorder_id = i.salesorder_id
                 ORDER BY i2.date DESC, i2.invoice_id DESC
                 LIMIT 1)
              AND NOT EXISTS (
                SELECT 1 FROM books.sales_orders so
                 WHERE so.salesorder_id = i.salesorder_id
                   AND (COALESCE(so.raw ->> 'order_status', '') = 'closed'
                     OR COALESCE(so.raw ->> 'shipped_status', '') = 'fulfilled'))
              THEN (SELECT COALESCE(SUM(GREATEST(
                      COALESCE(NULLIF(li.raw ->> 'quantity_invoiced', '')::numeric, 0)
                      - COALESCE(NULLIF(li.raw ->> 'quantity_packed', '')::numeric, 0), 0)), 0)
                      FROM books.salesorder_line_items li
                      LEFT JOIN books.items it ON it.item_id = li.item_id
                     WHERE li.salesorder_id = i.salesorder_id
                       -- product_type ausente → se asume mercancía (sí se empaqueta).
                       AND COALESCE(NULLIF(it.raw ->> 'product_type', ''), 'goods') <> 'service')
              ELSE 0
         END`;

// Numéricos de raw como TEXTO (regla de la casa: un ::numeric con "12.5%" aborta
// la consulta). sub_total/total son columnas numéricas reales -> llegan casteadas.
// Trato y Ticket salen del deal de CRM enlazado por raw->>'zcrm_potential_id'
// (verificado contra datos reales 2026: el deal resuelve en casi todas las facturas
// y crm.deals.numero_ticket coincide con el TICKET del Excel). NO se usa
// desk.tickets: su columna orden_venta está siempre NULL en la réplica.
const FACTURAS_SQL = `
  SELECT i.invoice_number,
         i.reference_number,
         i.customer_name,
         i.date::text                                  AS date,
         i.due_date::text                              AS due_date,
         i.status,
         i.sub_total,
         i.total,
         NULLIF(i.raw ->> 'tax_total', '')             AS iva,
         NULLIF(i.raw ->> 'balance', '')               AS balance,
         NULLIF(i.raw ->> 'tax_amount_withheld', '')   AS retenciones,
         d.deal_name                                   AS deal_name,
         d.numero_ticket                               AS ticket_number,
         qt.no_cotizacion                              AS qt,
         ${UNIDADES_POR_DESPACHAR}                     AS unidades_por_despachar,
         i.synced_at::text                             AS synced_at
    FROM books.invoices i
    LEFT JOIN crm.deals d
           ON d.id = NULLIF(i.raw ->> 'zcrm_potential_id', '')
    -- QT = número de la última cotización del deal (crm.quotes.no_cotizacion,
    -- formato "2025-551" del Excel; la más reciente por fecha_cotizacion).
    LEFT JOIN LATERAL (
           SELECT q.no_cotizacion
             FROM crm.quotes q
            WHERE q.deal_id = d.id
            ORDER BY q.fecha_cotizacion DESC NULLS LAST, q.created_time DESC
            LIMIT 1
         ) qt ON TRUE
   WHERE i.date >= $1::date AND i.date < $2::date
     -- Excluir facturas internas/de ajuste de Ambientalia (siempre en $0): las de
     -- número 'AMI-...' o cuya orden es 'OVI-...'. No son facturación al cliente.
     AND i.invoice_number NOT ILIKE 'AMI-%'
     AND COALESCE(i.reference_number, '') NOT ILIKE 'OVI-%'
   ORDER BY i.date, i.invoice_number`;

// Rango del año contable (parametrizable). Antes fijo en 2026.
function rango(anio: number): [string, string] {
  return [`${anio}-01-01`, `${anio + 1}-01-01`];
}

// Facturado (subtotal) por año, excluyendo las internas AMI-/OVI-. Sirve para el
// selector de años y para los comparativos del resumen.
/**
 * Primer año con datos fiables en la réplica. 2020 solo tiene el último trimestre cargado
 * (la primera factura es de octubre), así que se OMITE: ni sale en el selector de años ni
 * en los comparativos del resumen, para no comparar contra una cifra que no representa el
 * año. Si algún día se completa el histórico, basta con bajar este número.
 */
export const ANIO_MINIMO = 2021;

const FACTURADO_POR_ANIO_SQL = `
  SELECT date_part('year', i.date)::int AS anio,
         SUM(i.sub_total)               AS facturado
    FROM books.invoices i
   WHERE i.invoice_number NOT ILIKE 'AMI-%'
     AND COALESCE(i.reference_number, '') NOT ILIKE 'OVI-%'
     AND i.date >= '${ANIO_MINIMO}-01-01'
   GROUP BY 1
   ORDER BY 1`;

/** Lee el mapa de overrides de cartera (invoice_number -> texto). */
export async function getCarteraOverrides(db: Pool): Promise<Map<string, string>> {
  const { rows } = await db.query(
    `SELECT invoice_number, cartera FROM portal.contabilidad_overrides WHERE cartera IS NOT NULL`,
  );
  const m = new Map<string, string>();
  for (const r of rows as { invoice_number: string; cartera: string }[]) {
    m.set(r.invoice_number, r.cartera);
  }
  return m;
}

/** Upsert de la cartera de una factura. `updatedBy` es el user_id (UUID) o null. */
export async function upsertCartera(
  db: Pool,
  invoiceNumber: string,
  cartera: string,
  updatedBy: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO portal.contabilidad_overrides (invoice_number, cartera, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (invoice_number)
     DO UPDATE SET cartera = EXCLUDED.cartera, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [invoiceNumber, cartera, updatedBy],
  );
}

/** Presupuesto de un año (null si no está configurado). */
export async function getBudget(db: Pool, anio: number): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT presupuesto FROM portal.contabilidad_budget WHERE year = $1`,
    [anio],
  );
  if (!rows.length) return null;
  const n = Number((rows[0] as { presupuesto: unknown }).presupuesto);
  return Number.isFinite(n) ? n : null;
}

/** Upsert del presupuesto de un año. */
export async function upsertBudget(
  db: Pool,
  anio: number,
  presupuesto: number,
  updatedBy: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO portal.contabilidad_budget (year, presupuesto, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (year)
     DO UPDATE SET presupuesto = EXCLUDED.presupuesto, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [anio, presupuesto, updatedBy],
  );
}

/** Facturado por año (para selector + comparativos). */
async function getFacturadoPorAnio(db: Pool): Promise<Record<number, number>> {
  const { rows } = await db.query(FACTURADO_POR_ANIO_SQL);
  const out: Record<number, number> = {};
  for (const r of rows as { anio: number; facturado: unknown }[]) {
    out[Number(r.anio)] = Number(r.facturado) || 0;
  }
  return out;
}

/** Facturas del año + resumen + años disponibles, con la cartera fusionada. */
export async function getContabilidadData(db: Pool, anio: number): Promise<ContabilidadData> {
  const [desde, hasta] = rango(anio);
  const [{ rows }, overrides, presupuesto, facturadoPorAnio] = await Promise.all([
    db.query(FACTURAS_SQL, [desde, hasta]),
    getCarteraOverrides(db),
    getBudget(db, anio),
    getFacturadoPorAnio(db),
  ]);
  const dedup = dedupeByInvoiceNumber(rows as FacturaRawRow[]);
  const facturas = withParticipacion(dedup.map((r) => mapFacturaRow(r, overrides)));
  const resumen = buildResumen(facturas, anio, presupuesto, facturadoPorAnio);
  const aniosDisponibles = Object.keys(facturadoPorAnio).map(Number).sort((a, b) => b - a);
  return { facturas, resumen, anioActual: anio, aniosDisponibles };
}
