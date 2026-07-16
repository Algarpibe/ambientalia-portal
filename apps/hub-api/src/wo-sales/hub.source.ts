import type { Pool } from '@algarpibe/zoho-sync';
import type { SalesOrder, SalesOrderLine } from './types.js';
import type { OrdenAntigua, SalesOrderFiltro, SalesOrderSource } from './source.js';
import type { WoSalesConfig } from './config.js';

/**
 * OV vivas con sus líneas, para el archivo de World Office.
 *
 * Esquema verificado contra la base (no hay DDL en este repo; lo crea el worker
 * ambientalia-desk/packages/zoho-sync):
 * - books.sales_orders: salesorder_number es "OV-2026-138" (alfanumérico, no un
 *   consecutivo). shipment_date y payment_terms_label solo viven en raw.
 * - books.contacts.nit: el NIT es columna real. Join por customer_id.
 * - salesorder_line_items.rate está en COP (moneda del documento); bcy_rate está en
 *   USD (moneda base de la organización). Para World Office SIEMPRE rate.
 * - items.raw->'custom_field_hash'->>'cf_centro_de_costos' da "330801 CALIBRACION
 *   ENVIRO". Hoy devuelve NULL porque el sync guarda el raw del listado, que no trae
 *   custom_fields; cuando se despliegue el fix del worker, aparece solo.
 *
 * La exclusión por factura es más amplia que el "Enviado" del acta: cualquier factura
 * que no sea draft/void mata la OV (una 'paid' está tan facturada como una 'sent').
 * Verificado: 4 OV open/overdue ya tienen factura 'sent'.
 *
 * Dos decisiones del JOIN que no son cosméticas:
 * - LEFT JOIN a line_items (no INNER): una OV sin líneas debe llegar al builder para
 *   que avise 'ov_sin_lineas'. Con INNER JOIN desaparecería aquí en silencio, que es
 *   justo lo que ese aviso existe para evitar.
 * - LEFT JOIN a items: si el item_id no existe, sku/nombre van NULL y el builder
 *   avisa 'sin_sku' en vez de perder la línea.
 *
 * Verificado contra la API de Zoho (OV-2026-138), dos cosas que condicionan el mapeo:
 *
 * - discount_type = "entity_level": esta organización descuenta a nivel de DOCUMENTO,
 *   no de línea. Por eso todas las líneas traen discount: 0 y el descuento real vive
 *   en la cabecera (raw->>'discount_total', raw->>'discount_percent'). La columna
 *   "Detalle: Descuento" del CSV se alimenta del descuento de LÍNEA, así que hoy un
 *   descuento real NO llegaría a World Office.
 *   VALIDAR con Xiomara: si aparece una OV con discount_total > 0, hay que decidir si
 *   se reparte por línea (¿prorrateado por importe?) o si va a otra columna. Es una
 *   decisión de negocio y por eso no está implementada: se deja el descuento de línea
 *   tal cual lo da Zoho.
 *
 * - price_precision = 0: el COP no lleva decimales en esta organización, así que la
 *   duda del separador decimal (punto vs coma) es teórica para importes en pesos.
 */
const ORDENES_VIVAS_SQL = `
  WITH vivas AS (
    SELECT so.salesorder_id,
           so.salesorder_number,
           so.date::text                             AS fecha,
           so.customer_name,
           so.currency_code,
           c.nit,
           NULLIF(so.raw ->> 'shipment_date', '')    AS fecha_entrega,
           NULLIF(so.raw ->> 'payment_terms_label', '') AS forma_pago,
           -- Descuento a nivel de documento. Texto, no ::numeric: un valor con % de
           -- Zoho abortaría la consulta entera (ver el bloque de descuento de línea).
           NULLIF(so.raw ->> 'discount_total', '')   AS descuento_cabecera
      FROM books.sales_orders so
      LEFT JOIN books.contacts c ON c.contact_id = so.customer_id
     WHERE so.status = ANY($1::text[])
       AND so.date >= $2::date
       AND so.date <= $3::date
       AND ($4::text IS NULL OR so.customer_name ILIKE '%' || $4 || '%')
  )
  -- No se excluye la OV por tener factura: la facturación se descuenta POR LÍNEA con
  -- quantity_invoiced (más abajo, en TS). Una OV parcialmente facturada aparece con
  -- sus líneas aún pendientes; una totalmente facturada ya está fuera por su status
  -- ('invoiced' no está en estadosVivos). Esto reemplaza la antigua exclusión por
  -- factura, que hacía desaparecer enteras las OV parcialmente facturadas.
  SELECT v.salesorder_id, v.salesorder_number, v.fecha, v.customer_name, v.currency_code, v.nit,
         v.fecha_entrega, v.forma_pago, v.descuento_cabecera,
         li.line_item_id,
         li.quantity,
         li.rate,
         it.sku,
         it.name                                                        AS item_name,
         NULLIF(li.raw ->> 'discount', '')                              AS descuento,
         -- Cantidades ya facturada/cancelada, por línea (mismo raw del que inventory.ts
         -- lee quantity_delivered). Texto, no ::numeric: ver el bloque de descuento.
         NULLIF(li.raw ->> 'quantity_invoiced', '')                     AS cantidad_facturada,
         NULLIF(li.raw ->> 'quantity_cancelled', '')                    AS cantidad_cancelada,
         it.raw -> 'custom_field_hash' ->> 'cf_centro_de_costos'        AS centro_costos
    FROM vivas v
    LEFT JOIN books.salesorder_line_items li ON li.salesorder_id = v.salesorder_id
    LEFT JOIN books.items it                 ON it.item_id       = li.item_id
   ORDER BY v.fecha, v.salesorder_number, li.line_item_id`;

/**
 * Mismas reglas de "viva", pero anteriores al rango: candidatas a estar abandonadas.
 * Aplica el mismo filtro de cliente que ordenesVivas: si el usuario pidió "ACME", no
 * tiene sentido listarle OV antiguas de otros clientes.
 */
const ORDENES_ANTIGUAS_SQL = `
  SELECT so.salesorder_number, so.date::text AS fecha, so.customer_name
    FROM books.sales_orders so
   WHERE so.status = ANY($1::text[])
     AND so.date < $2::date
     AND ($3::text IS NULL OR so.customer_name ILIKE '%' || $3 || '%')
   ORDER BY so.date`;

interface Fila {
  /** La PK real. Se agrupa por aquí, no por el número (ver ordenesVivas). */
  salesorder_id: string;
  salesorder_number: string;
  fecha: string;
  customer_name: string | null;
  currency_code: string | null;
  nit: string | null;
  fecha_entrega: string | null;
  forma_pago: string | null;
  /** Texto crudo del descuento de documento, sin castear: ver `aNumero`. */
  descuento_cabecera: string | null;
  /** NULL cuando la OV no tiene ninguna línea (el LEFT JOIN la trae igual). */
  line_item_id: string | null;
  quantity: number | null;
  rate: number | null;
  sku: string | null;
  item_name: string | null;
  /** Texto crudo de Zoho, sin castear: ver `aNumero`. */
  descuento: string | null;
  /** Cantidad ya facturada / cancelada de esta línea (texto crudo del raw). */
  cantidad_facturada: string | null;
  cantidad_cancelada: string | null;
  centro_costos: string | null;
}

/**
 * cf_centro_de_costos es multiselect: Zoho separa los valores con coma. Una sola
 * función para partir, porque contar y coger el primero tienen que estar de acuerdo:
 * con ", 5501 HORIBA" (coma inicial), contar filtrando vacíos y coger split[0] a
 * ciegas daban count 1 y valor null, perdiendo un centro que sí existe.
 */
function centros(valor: string | null): string[] {
  if (!valor) return [];
  return valor.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Para el descuento: aquí el 0 SÍ es correcto, porque el campo ausente en el raw
 * significa "sin descuento", no "dato que falta".
 *
 * El `discount` del raw NO se castea a ::numeric en SQL a propósito: Zoho lo documenta
 * como "% o importe" ("12.5%" o "190"), y un solo '12.5%'::numeric aborta la consulta
 * entera con invalid input syntax, tumbando el export de todas las OV. Aquí un valor
 * presente pero no numérico se vuelve NaN, y el builder lo caza con 'valor_no_numerico':
 * deja la columna vacía y avisa de esa línea, en vez de romperlo todo.
 */
function aNumero(valor: unknown): number {
  if (valor === null || valor === undefined || valor === '') return 0;
  return Number(valor);
}

/**
 * Para los campos obligatorios (cantidad, valor unitario): un NULL en la réplica NO
 * es un 0 — es un dato que falta. Propaga NaN para que num() del builder lo cace y
 * deje la celda vacía con aviso, en vez de escribir un 0 que nadie revisaría.
 */
function aNumeroObligatorio(valor: unknown): number {
  if (valor === null || valor === undefined || valor === '') return NaN;
  return Number(valor);
}

/**
 * Cantidad pendiente de facturar de una línea = pedida − facturada − cancelada, y si
 * la línea debe entrar al archivo. Entra si queda algo pendiente (> 0). Una línea ya
 * facturada del todo (pendiente 0, o negativo por descuadre) NO entra. Un cálculo NaN
 * (dato corrupto: cantidad pedida ausente, o un valor no numérico en el raw) SÍ entra:
 * no se descarta en silencio — pasa como cantidad y el builder lo caza con
 * 'valor_no_numerico', dejando la celda vacía y avisando de esa línea.
 */
export function pendientePorFacturar(
  pedida: number,
  facturada: number,
  cancelada: number
): { cantidad: number; incluir: boolean } {
  const pendiente = pedida - facturada - cancelada;
  const incluir = !(Number.isFinite(pendiente) && pendiente <= 0);
  return { cantidad: pendiente, incluir };
}

export function createHubSalesOrderSource(db: Pool, config: WoSalesConfig): SalesOrderSource {
  return {
    async ordenesVivas(filtro: SalesOrderFiltro): Promise<SalesOrder[]> {
      const { rows } = await db.query(ORDENES_VIVAS_SQL, [
        config.estadosVivos,
        filtro.desde,
        filtro.hasta,
        filtro.cliente ?? null,
      ]);

      // Clave = salesorder_id (la PK), no el número: si dos OV compartieran número,
      // agrupar por número fundiría sus líneas en un pedido y el CSV reservaría mal
      // el inventario. Hoy no pasa, pero quitar la suposición sale gratis.
      const porOrden = new Map<string, SalesOrder>();
      for (const f of rows as Fila[]) {
        let ov = porOrden.get(f.salesorder_id);
        if (!ov) {
          ov = {
            numero: f.salesorder_number,
            fecha: f.fecha,
            clienteNombre: f.customer_name,
            nit: f.nit,
            formaPagoZoho: f.forma_pago,
            fechaEntrega: f.fecha_entrega,
            moneda: f.currency_code,
            // aNumero (no aNumeroObligatorio): un descuento ausente ES 0, no un dato
            // que falta. Un "12.5%" se vuelve NaN; el builder solo avisa si es > 0,
            // y NaN > 0 es false, así que ese caso raro no genera ruido.
            descuentoCabecera: aNumero(f.descuento_cabecera),
            cantidadFacturada: 0,
            lineas: [],
          };
          porOrden.set(f.salesorder_id, ov);
        }
        // OV sin líneas: el LEFT JOIN da una fila con todo el detalle en NULL. La OV
        // queda registrada (con lineas: []) para que el builder avise 'ov_sin_lineas'.
        if (f.line_item_id === null) continue;

        // Cantidad PENDIENTE de facturar = pedida − facturada − cancelada. World Office
        // solo debe crear el pedido de lo que aún no se facturó; cargar lo ya facturado
        // duplicaría inventario y facturación. Lo facturado se acumula para que el
        // builder avise (ov_parcialmente_facturada) de que el archivo trae solo lo vivo.
        const facturada = aNumero(f.cantidad_facturada);
        const cancelada = aNumero(f.cantidad_cancelada);
        const pedida = aNumeroObligatorio(f.quantity);
        if (Number.isFinite(facturada)) ov.cantidadFacturada += facturada;
        const { cantidad, incluir } = pendientePorFacturar(pedida, facturada, cancelada);
        if (!incluir) continue;

        const cc = centros(f.centro_costos);
        const linea: SalesOrderLine = {
          sku: f.sku,
          descripcion: f.item_name,
          cantidad,
          valorUnitario: aNumeroObligatorio(f.rate),
          descuento: aNumero(f.descuento),
          centroCostos: cc[0] ?? null,
          centrosCostosCount: cc.length,
        };
        ov.lineas.push(linea);
      }
      return [...porOrden.values()];
    },

    async ordenesAntiguas(filtro: SalesOrderFiltro): Promise<OrdenAntigua[]> {
      const { rows } = await db.query(ORDENES_ANTIGUAS_SQL, [
        config.estadosVivos,
        filtro.desde,
        filtro.cliente ?? null,
      ]);
      return (rows as { salesorder_number: string; fecha: string; customer_name: string | null }[]).map(
        (r) => ({ numero: r.salesorder_number, fecha: r.fecha, clienteNombre: r.customer_name })
      );
    },
  };
}
