/** Una línea de producto de una orden de venta, ya normalizada desde el hub. */
export interface SalesOrderLine {
  sku: string | null;
  descripcion: string | null;
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
  warnings: Warning[];
  filas: number;
  ordenes: number;
}
