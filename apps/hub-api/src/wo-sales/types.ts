/** Una línea de producto de una orden de venta, ya normalizada desde el hub. */
export interface SalesOrderLine {
  sku: string | null;
  /** Nombre del artículo en Zoho. Ya NO va al archivo (la columna "Nota Detalle" va
   *  vacía en el modelo de World Office); se conserva para diagnóstico y advertencias. */
  descripcion: string | null;
  /** Cantidad PENDIENTE de facturar (pedida − facturada − cancelada), no la pedida.
   *  World Office solo debe crear el pedido de lo que aún no se facturó. Las líneas
   *  con pendiente 0 ni siquiera llegan aquí (se descartan en la capa de datos). */
  cantidad: number;
  /** Valor unitario en COP: viene de salesorder_line_items.rate, NUNCA de bcy_rate
   *  (bcy_rate está en USD, la moneda base de la organización). */
  valorUnitario: number;
  descuento: number;
  /** Tal cual lo da Zoho: "330801 CALIBRACION ENVIRO" (código + espacio + descripción).
   *  null mientras el sync no baje los custom_fields de artículo. */
  centroCostos: string | null;
  /** Cuántos centros de costo trae el artículo. cf_centro_de_costos es multiselect. */
  centrosCostosCount: number;
}

/** Una orden de venta viva, con sus líneas. */
export interface SalesOrder {
  numero: string;
  /** ISO YYYY-MM-DD. */
  fecha: string;
  clienteNombre: string | null;
  nit: string | null;
  formaPagoZoho: string | null;
  /** ISO YYYY-MM-DD, o null si Zoho no la tiene. Ya NO va al archivo (la columna
   *  "FechaEntrega" va vacía en el modelo); se conserva por si vuelve a usarse. */
  fechaEntrega: string | null;
  /** Plazo de pago en días (Zoho `payment_terms`). null = ausente en Zoho (se usa el
   *  plazo por defecto y se avisa); 0 = contado (Vencimiento = Fecha). Alimenta el
   *  cálculo de "Vencimiento" = Fecha + plazoPago (ver builder + config.vencimiento). */
  plazoPago: number | null;
  moneda: string | null;
  /** Descuento a nivel de documento (raw->>'discount_total'). Esta organización
   *  descuenta con discount_type "entity_level", así que el descuento NO está en las
   *  líneas — está aquí. El CSV solo tiene columna de descuento por línea, así que un
   *  valor > 0 no llega al archivo: el builder avisa. 0 si no hay o no se pudo leer. */
  descuentoCabecera: number;
  /** Suma de la cantidad ya facturada de todas sus líneas. > 0 = la OV está
   *  parcialmente facturada y este archivo trae SOLO lo pendiente (las líneas ya
   *  facturadas del todo no aparecen). El builder avisa cuando es > 0. */
  cantidadFacturada: number;
  lineas: SalesOrderLine[];
}

export type WarningTipo =
  | 'sin_centro_costos'
  | 'centro_costos_invalido'
  | 'varios_centros_costos'
  | 'sin_nit'
  | 'sin_sku'
  | 'moneda_no_cop'
  | 'descuento_cabecera_ignorado'
  | 'ov_parcialmente_facturada'
  | 'ov_antigua'
  | 'ov_sin_lineas'
  | 'valor_no_numerico'
  | 'valor_saneado'
  // El modelo de WO no lleva forma de pago homologada ni fecha de entrega, y la
  // empresa es fija: por eso ya no existen 'forma_pago_desconocida', 'sin_fecha_entrega'
  // ni 'sin_empresa'. En su lugar, el plazo de pago alimenta el vencimiento:
  | 'plazo_pago_ausente';

export interface Warning {
  tipo: WarningTipo;
  orden: string;
  sku?: string;
  mensaje: string;
}

export interface BuildResult {
  csv: Buffer;
  /** Cabecera + una fila por línea, como strings. Fuente única para .csv y .xls. */
  matriz: string[][];
  warnings: Warning[];
  filas: number;
  ordenes: number;
}

/** Un destinatario del correo automático: un usuario del portal con la app asignada. */
export interface DestinatarioCorreo {
  email: string;
  nombre: string;
}

export interface EmailEstado {
  ultimoHash: string | null;
  ultimoEnvioAt: string | null;
}

export interface ResumenEmail {
  ordenes: number;
  filas: number;
  cambiadas: string[];
  advertencias: number;
}

export type EmailPendiente =
  | { enviar: false }
  | {
      enviar: true;
      xlsBase64: string;
      nombreArchivo: string;
      destinatarios: { email: string; nombre: string }[];
      asunto: string;
      cuerpo: string;
      resumen: ResumenEmail;
      token: string;
    };
