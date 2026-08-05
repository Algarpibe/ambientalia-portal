import type { Pool } from '@algarpibe/zoho-sync';

// Detalle de una factura / OV para el modal de la app Contabilidad: cabecera +
// líneas (SKU/nombre/uds/precio) + totales. Los totales salen de la cabecera del
// documento (sub_total/total/tax_total), NO de sumar líneas, para cuadrar con Zoho.

export interface DetalleLinea {
  sku: string;
  nombre: string;
  cantidad: number;
  precio: number; // COP
  total: number;  // cantidad * precio
  /** Unidades de esta línea aún sin despachar (>0 → es de las que enciende la luz violeta). */
  porDespachar: number;
}

export interface DetalleFactura {
  numero: string;
  cliente: string;
  nit: string | null;
  direccion: string | null;
  fecha: string;
  vencimiento: string | null;
  terminos: string | null;
  ov: string | null;
  saldo: number;
  lineas: DetalleLinea[];
  subtotal: number;
  iva: number;
  total: number;
}

export interface DetalleOV {
  numero: string;
  cliente: string;
  nit: string | null;
  direccion: string | null;
  fecha: string;
  entrega: string | null;
  terminos: string | null;
  lineas: DetalleLinea[];
  subtotal: number;
  iva: number;
  total: number;
}

export interface LineaRow {
  sku: string | null;
  nombre: string | null;
  cantidad: number | null;
  precio: number | null;
  por_despachar: number | string | null;
}

function n(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Mapea filas de línea a DetalleLinea, calculando el total por línea. Puro. */
export function buildLineas(rows: LineaRow[]): DetalleLinea[] {
  return rows.map((r) => {
    const cantidad = n(r.cantidad);
    const precio = n(r.precio);
    return { sku: r.sku ?? '', nombre: r.nombre ?? '', cantidad, precio, total: cantidad * precio, porDespachar: n(r.por_despachar) };
  });
}

const DIRECCION = (col: string) =>
  `NULLIF(concat_ws(', ', NULLIF(${col} -> 'billing_address' ->> 'address', ''), NULLIF(${col} -> 'billing_address' ->> 'city', '')), '')`;

const FACTURA_HEADER_SQL = `
  SELECT i.invoice_number, i.customer_name, i.date::text AS fecha, i.due_date::text AS vencimiento,
         i.sub_total, i.total,
         NULLIF(i.raw ->> 'tax_total', '')            AS iva,
         NULLIF(i.raw ->> 'balance', '')              AS saldo,
         NULLIF(i.raw ->> 'payment_terms_label', '')  AS terminos,
         i.reference_number                           AS ov,
         c.nit,
         ${DIRECCION('i.raw')}                        AS direccion
    FROM books.invoices i
    LEFT JOIN books.contacts c ON c.contact_id = i.customer_id
   WHERE i.invoice_number = $1
   LIMIT 1`;

// `por_despachar`: unidades de ese artículo que siguen SIN EMPAQUETAR, buscándolas en las
// líneas de la OV de la factura. Son las que hacen encender la luz violeta de la tabla, así
// que el detalle deja ver EXACTAMENTE qué artículos faltan por preparar. Se mide contra
// quantity_packed (no contra lo enviado: con recogida en nuestras instalaciones lo despachado
// se queda en 0 aunque bodega ya lo tenga listo). Los servicios van a 0 — ver source.ts.
const FACTURA_LINEAS_SQL = `
  SELECT it.sku, it.name AS nombre, li.quantity AS cantidad, li.rate AS precio,
         CASE WHEN COALESCE(NULLIF(it.raw ->> 'product_type', ''), 'goods') = 'service' THEN 0
              ELSE COALESCE((
                SELECT SUM(GREATEST(COALESCE(sol.quantity, 0)
                       - COALESCE(NULLIF(sol.raw ->> 'quantity_packed', '')::numeric, 0)
                       - COALESCE(NULLIF(sol.raw ->> 'quantity_cancelled', '')::numeric, 0), 0))
                  FROM books.salesorder_line_items sol
                 WHERE sol.salesorder_id = i.salesorder_id
                   AND sol.item_id = li.item_id), 0)
         END AS por_despachar
    FROM books.invoice_line_items li
    JOIN books.invoices i ON i.invoice_id = li.invoice_id
    LEFT JOIN books.items it ON it.item_id = li.item_id
   WHERE i.invoice_number = $1
   ORDER BY li.line_item_id`;

const OV_HEADER_SQL = `
  SELECT so.salesorder_number, so.customer_name, so.date::text AS fecha,
         NULLIF(so.raw ->> 'shipment_date', '')       AS entrega,
         so.sub_total, so.total,
         NULLIF(so.raw ->> 'tax_total', '')           AS iva,
         NULLIF(so.raw ->> 'payment_terms_label', '') AS terminos,
         c.nit,
         ${DIRECCION('so.raw')}                       AS direccion
    FROM books.sales_orders so
    LEFT JOIN books.contacts c ON c.contact_id = so.customer_id
   WHERE so.salesorder_number = $1
   LIMIT 1`;

// En la OV el pendiente sale de la propia línea (no hay que buscarlo en otra tabla).
// Mismo criterio: sin empaquetar, no "sin enviar".
const OV_LINEAS_SQL = `
  SELECT it.sku, it.name AS nombre, li.quantity AS cantidad, li.rate AS precio,
         CASE WHEN COALESCE(NULLIF(it.raw ->> 'product_type', ''), 'goods') = 'service' THEN 0
              ELSE GREATEST(COALESCE(li.quantity, 0)
                   - COALESCE(NULLIF(li.raw ->> 'quantity_packed', '')::numeric, 0)
                   - COALESCE(NULLIF(li.raw ->> 'quantity_cancelled', '')::numeric, 0), 0)
         END AS por_despachar
    FROM books.salesorder_line_items li
    JOIN books.sales_orders so ON so.salesorder_id = li.salesorder_id
    LEFT JOIN books.items it ON it.item_id = li.item_id
   WHERE so.salesorder_number = $1
   ORDER BY li.line_item_id`;

export async function getDetalleFactura(db: Pool, numero: string): Promise<DetalleFactura | null> {
  const { rows: h } = await db.query(FACTURA_HEADER_SQL, [numero]);
  if (!h.length) return null;
  const head = h[0] as Record<string, unknown>;
  const { rows: l } = await db.query(FACTURA_LINEAS_SQL, [numero]);
  return {
    numero: String(head.invoice_number),
    cliente: (head.customer_name as string) ?? '',
    nit: (head.nit as string) ?? null,
    direccion: (head.direccion as string) ?? null,
    fecha: head.fecha as string,
    vencimiento: (head.vencimiento as string) ?? null,
    terminos: (head.terminos as string) ?? null,
    ov: (head.ov as string) ?? null,
    saldo: n(head.saldo),
    lineas: buildLineas(l as LineaRow[]),
    subtotal: n(head.sub_total),
    iva: n(head.iva),
    total: n(head.total),
  };
}

export async function getDetalleOV(db: Pool, numero: string): Promise<DetalleOV | null> {
  const { rows: h } = await db.query(OV_HEADER_SQL, [numero]);
  if (!h.length) return null;
  const head = h[0] as Record<string, unknown>;
  const { rows: l } = await db.query(OV_LINEAS_SQL, [numero]);
  return {
    numero: String(head.salesorder_number),
    cliente: (head.customer_name as string) ?? '',
    nit: (head.nit as string) ?? null,
    direccion: (head.direccion as string) ?? null,
    fecha: head.fecha as string,
    entrega: (head.entrega as string) ?? null,
    terminos: (head.terminos as string) ?? null,
    lineas: buildLineas(l as LineaRow[]),
    subtotal: n(head.sub_total),
    iva: n(head.iva),
    total: n(head.total),
  };
}
