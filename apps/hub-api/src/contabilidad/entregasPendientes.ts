import type { Pool } from '@algarpibe/zoho-sync';
import { UNIDADES_POR_DESPACHAR, ANIO_MINIMO } from './source.js';

/** Factura con mercancía ya facturada que todavía no se ha empaquetado. */
export interface FacturaPorEntregar {
  invoiceNumber: string;
  cliente: string;
  fecha: string;
  ov: string;
  unidadesPorDespachar: number;
}

// SOLO las facturas con algo pendiente de preparar: es un parte de trabajo para bodega,
// no una vista de facturación. Por eso NO lleva importes, cartera ni cobros — este listado
// lo consume también la app `ov-pendientes`, que se asigna justo a quien NO debe ver eso.
//
// El criterio de "sin empaquetar" se interpola desde source.ts (única definición, ver allí);
// va correlacionado con la factura, que por eso tiene que aliasarse como `i`. El LATERAL
// evita repetir la expresión en el SELECT y en el WHERE.
//
// Se excluyen las internas AMI-/OVI- (Ambientalia a sí misma) como en la tabla de facturación,
// y se acota desde ANIO_MINIMO porque los datos anteriores están incompletos en la réplica.
const SQL = `
  SELECT i.invoice_number,
         i.customer_name,
         i.date::text       AS fecha,
         i.reference_number AS ov,
         u.unidades
    FROM books.invoices i
    CROSS JOIN LATERAL (SELECT ${UNIDADES_POR_DESPACHAR} AS unidades) u
   WHERE i.date >= $1::date
     AND i.invoice_number NOT ILIKE 'AMI-%'
     AND COALESCE(i.reference_number, '') NOT ILIKE 'OVI-%'
     AND u.unidades > 0
   ORDER BY u.unidades DESC, i.date DESC`;

export async function getFacturasPorEntregar(db: Pool): Promise<FacturaPorEntregar[]> {
  const { rows } = await db.query(SQL, [`${ANIO_MINIMO}-01-01`]);
  return rows.map((r: Record<string, unknown>) => ({
    invoiceNumber: String(r.invoice_number ?? ''),
    cliente: String(r.customer_name ?? ''),
    fecha: String(r.fecha ?? ''),
    ov: String(r.ov ?? ''),
    unidadesPorDespachar: Number(r.unidades ?? 0),
  }));
}
