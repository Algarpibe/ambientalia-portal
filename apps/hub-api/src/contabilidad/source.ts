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
}

// Rango del año contable. La app es "Facturación 2026".
const ANIO = 2026;
const DESDE = `${ANIO}-01-01`;
const HASTA = `${ANIO + 1}-01-01`;

// Numéricos de raw como TEXTO (regla de la casa: un ::numeric con "12.5%" aborta
// la consulta). sub_total/total son columnas numéricas reales -> llegan casteadas.
// Trato y Ticket por LEFT JOIN; suelen venir NULL (link vacío en Zoho) -> columna vacía.
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
         tk.number                                     AS ticket_number,
         i.synced_at::text                             AS synced_at
    FROM books.invoices i
    LEFT JOIN crm.deals d
           ON d.id = NULLIF(i.raw ->> 'zcrm_potential_id', '')
    LEFT JOIN LATERAL (
           SELECT t.number
             FROM desk.tickets t
            WHERE t.orden_venta = i.reference_number
            ORDER BY t.number
            LIMIT 1
         ) tk ON TRUE
   WHERE i.date >= $1::date AND i.date < $2::date
   ORDER BY i.date, i.invoice_number`;

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

/** Facturas 2026 + resumen, con la cartera fusionada. */
export async function getContabilidadData(db: Pool): Promise<ContabilidadData> {
  const [{ rows }, overrides] = await Promise.all([
    db.query(FACTURAS_SQL, [DESDE, HASTA]),
    getCarteraOverrides(db),
  ]);
  const dedup = dedupeByInvoiceNumber(rows as FacturaRawRow[]);
  const facturas = withParticipacion(dedup.map((r) => mapFacturaRow(r, overrides)));
  const resumen = buildResumen(facturas);
  return { facturas, resumen };
}
