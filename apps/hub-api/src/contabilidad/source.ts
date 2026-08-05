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
         -- Unidades de la OV de esta factura que AÚN NO se han EMPAQUETADO. Detecta el
         -- caso peligroso: una OV facturada al 100% sale del listado de "OV pendientes"
         -- y su preparación queda sin seguimiento.
         -- El enlace i.salesorder_id está poblado al 100% (verificado 2026-08-05).
         --
         -- Se mide contra 'quantity_packed', NO contra 'quantity_delivered': con entrega
         -- por recogida en nuestras instalaciones lo despachado se queda en 0 hasta que el
         -- cliente aparece, y la mercancía ya empaquetada saldría como pendiente sin serlo
         -- (AM1460/OV-2026-101: 9 de 9 unidades empaquetadas y 0 enviadas). Empaquetado =
         -- bodega ya lo preparó y apartó; lo que falta es lo que ni siquiera se ha tocado.
         --
         -- Se EXCLUYEN las líneas de servicio (mano de obra, alquiler…): no se despachan,
         -- así que su 'quantity_delivered' se queda en 0 de por vida y la resta las daría
         -- como pendientes para siempre (mismo gotcha documentado en inventory.ts, que
         -- encendía la luz en facturas de enero ya entregadas).
         --
         -- Y solo cuentan los ARTÍCULOS QUE ESTA FACTURA INCLUYE: la OV puede tener otras
         -- líneas pendientes que se facturaron aparte, y avisar de ellas aquí colgaba el
         -- aviso de la factura equivocada (AM1277 era solo un contrato de servicio y salía
         -- marcada por 2 unidades de otra línea de su OV). Lo que quede pendiente y NO esté
         -- en ninguna factura sigue visible en "OV pendientes de facturar".
         (SELECT COALESCE(SUM(GREATEST(
                   COALESCE(li.quantity, 0)
                   - COALESCE(NULLIF(li.raw ->> 'quantity_packed', '')::numeric, 0)
                   - COALESCE(NULLIF(li.raw ->> 'quantity_cancelled', '')::numeric, 0), 0)), 0)
            FROM books.salesorder_line_items li
            LEFT JOIN books.items it ON it.item_id = li.item_id
           WHERE li.salesorder_id = i.salesorder_id
             -- product_type ausente → se asume mercancía (sí se despacha).
             AND COALESCE(NULLIF(it.raw ->> 'product_type', ''), 'goods') <> 'service'
             AND EXISTS (SELECT 1 FROM books.invoice_line_items ili
                          WHERE ili.invoice_id = i.invoice_id
                            AND ili.item_id = li.item_id)) AS unidades_por_despachar,
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
const FACTURADO_POR_ANIO_SQL = `
  SELECT date_part('year', i.date)::int AS anio,
         SUM(i.sub_total)               AS facturado
    FROM books.invoices i
   WHERE i.invoice_number NOT ILIKE 'AMI-%'
     AND COALESCE(i.reference_number, '') NOT ILIKE 'OVI-%'
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
