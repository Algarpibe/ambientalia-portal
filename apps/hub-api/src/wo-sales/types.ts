/** Una línea de producto de una orden de venta, ya normalizada desde el hub. */
export interface SalesOrderLine {
  sku: string | null;
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
  /** ISO YYYY-MM-DD, o null si Zoho no la tiene. */
  fechaEntrega: string | null;
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
  | 'sin_fecha_entrega'
  | 'sin_nit'
  | 'sin_sku'
  | 'sin_empresa'
  | 'moneda_no_cop'
  | 'descuento_cabecera_ignorado'
  | 'ov_parcialmente_facturada'
  | 'forma_pago_desconocida'
  | 'ov_antigua'
  | 'ov_sin_lineas'
  | 'valor_no_numerico'
  | 'valor_saneado';

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

export interface Recipient {
  id: string;
  email: string;
  nombre: string;
  activo: boolean;
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
