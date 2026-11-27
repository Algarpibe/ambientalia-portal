import type { Pool } from '@algarpibe/zoho-sync';

/**
 * Hechos de Zoho que la app de Laboratorios ambientales necesita de cada NIT:
 * solo fechas. Nunca importes, nombres ni identificadores de Zoho (ver
 * docs/superpowers/specs/2026-11-26-prospectos-cruce-zoho-design.md).
 */
export interface HechosZoho {
  ultimaFactura: string | null;
  ocmaVendido: string | null;
  ultimosRepuestos: string | null;
}

/** Una fila de HECHOS_SQL: un contacto cliente con su NIT tal cual y sus tres fechas. */
export interface FilaContacto {
  nit: string | null;
  ultima_factura: string | null;
  ocma_vendido: string | null;
  ultimos_repuestos: string | null;
}

// Categorías de artículo de Zoho Books: el equipo y sus repuestos y consumibles.
export const CATEGORIA_OCMA = 'OCMA-500 Series';
export const CATEGORIA_REPUESTOS_OCMA = 'C&R OCMA-500';

const NIT_MIN_DIGITOS = 6;
const NIT_MAX_DIGITOS = 10;

/**
 * NIT base: lo que hay antes del primer «-», solo dígitos. `900.000.001-7` da
 * `900000001`. Menos de 6 dígitos es relleno (hay contactos con «0») y más de
 * 10 no es un NIT: los dos dan null.
 * La app tiene la misma regla en apps/laboratorios-ambientales/src/lib/clientes.ts: si cambias una, cambia la otra.
 */
export function nitBase(nit: string | null | undefined): string | null {
  if (!nit) return null;
  const digitos = nit.split('-')[0].replace(/\D/g, '');
  return digitos.length >= NIT_MIN_DIGITOS && digitos.length <= NIT_MAX_DIGITOS ? digitos : null;
}

// Las fechas son AAAA-MM-DD: comparar como texto es comparar como fecha.
function masReciente(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

/**
 * Una entrada por NIT base. Varios contactos con el mismo NIT (pasa en Zoho) se
 * suman: de cada tipo de fecha se queda la más reciente.
 */
export function agruparPorNit(filas: FilaContacto[]): Map<string, HechosZoho> {
  const mapa = new Map<string, HechosZoho>();
  for (const fila of filas) {
    const nit = nitBase(fila.nit);
    if (nit === null) continue;
    const previo = mapa.get(nit);
    mapa.set(nit, {
      ultimaFactura: masReciente(previo?.ultimaFactura ?? null, fila.ultima_factura),
      ocmaVendido: masReciente(previo?.ocmaVendido ?? null, fila.ocma_vendido),
      ultimosRepuestos: masReciente(previo?.ultimosRepuestos ?? null, fila.ultimos_repuestos),
    });
  }
  return mapa;
}

// Una fila por contacto CLIENTE con NIT. Las facturas anuladas y los borradores
// no cuentan, como en customerValuation.ts. `lineas` marca, por factura, si lleva
// algún artículo de cada categoría; to_char da AAAA-MM-DD sea la columna date o
// timestamp. $1 = CATEGORIA_OCMA, $2 = CATEGORIA_REPUESTOS_OCMA.
const HECHOS_SQL = `
  WITH lineas AS (
    SELECT li.invoice_id,
           bool_or(it.category_name = $1) AS con_ocma,
           bool_or(it.category_name = $2) AS con_repuestos
      FROM books.invoice_line_items li
      JOIN books.items it ON it.item_id = li.item_id
     WHERE it.category_name IN ($1, $2)
     GROUP BY li.invoice_id
  )
  SELECT c.nit,
         to_char(MAX(i.date), 'YYYY-MM-DD')                              AS ultima_factura,
         to_char(MAX(i.date) FILTER (WHERE l.con_ocma), 'YYYY-MM-DD')      AS ocma_vendido,
         to_char(MAX(i.date) FILTER (WHERE l.con_repuestos), 'YYYY-MM-DD') AS ultimos_repuestos
    FROM books.contacts c
    LEFT JOIN books.invoices i
           ON i.customer_id = c.contact_id
          AND i.status NOT IN ('void', 'draft')
    LEFT JOIN lineas l ON l.invoice_id = i.invoice_id
   WHERE c.nit IS NOT NULL AND c.nit <> ''
     AND c.raw ->> 'contact_type' = 'customer'
   GROUP BY c.contact_id, c.nit`;

/** El cruce completo de la réplica, por NIT base. */
export async function leerHechosZoho(db: Pool): Promise<Map<string, HechosZoho>> {
  const { rows } = await db.query(HECHOS_SQL, [CATEGORIA_OCMA, CATEGORIA_REPUESTOS_OCMA]);
  return agruparPorNit(rows as FilaContacto[]);
}
