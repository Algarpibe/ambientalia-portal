import { ESTADOS_OV_POR_FACTURAR } from '../salesOrderStatus.js';

/**
 * Regla de cálculo de la columna "Vencimiento" (§10). Xiomara la definió como la
 * FECHA DE PAGO, no la del documento: Vencimiento = Fecha + plazo de pago.
 */
export interface VencimientoConfig {
  /** 'fecha_documento_mas_plazo' = Fecha + plazoPago (Zoho payment_terms).
   *  'igual_a_fecha' = misma fecha del documento. 'fecha_fija' = una fecha literal. */
  regla: 'fecha_documento_mas_plazo' | 'igual_a_fecha' | 'fecha_fija';
  /** Días a sumar cuando la OV no trae payment_terms (se usa y se avisa). */
  plazoPorDefectoDias: number;
  /** Días calendario (false) u hábiles (true). Por ahora siempre calendario. */
  diasHabiles: boolean;
  /** Solo para regla 'fecha_fija': la fecha literal en ISO YYYY-MM-DD. */
  fechaFija?: string;
}

/**
 * Todo lo ajustable del formato en un solo sitio: valores fijos del modelo de World
 * Office, homologaciones y la regla de vencimiento. La lógica del builder no debe
 * contener ninguna constante. Los valores están confirmados contra el archivo modelo
 * (hoja QueryDef_Exportar) pero pueden cambiar tras la prueba de carga con Xiomara.
 */
export interface WoSalesConfig {
  /** Fijo en el modelo: 'AMBIENTALIA SAS' (no el nombre del cliente). */
  empresa: string;
  tipoDocumento: string;
  /** Vacío = derivar del año del documento (OV_2026); si no, se usa literal. */
  prefijo: string;
  documentoNumero: string;
  terceroInterno: string;
  nota: string;
  formaPago: string;
  verificado: string;
  anulado: string;
  bodega: string;
  unidadDeMedida: string;
  iva: string;
  descuento: string;
  /** Nombre de la hoja del .xls. El modelo la llama 'QueryDef_Exportar'. */
  nombreHoja: string;
  vencimiento: VencimientoConfig;
  /** Estados de OV que se consideran vivas. */
  estadosVivos: string[];
  /**
   * Centro de costos: World Office exige el NOMBRE, no el código. El nombre de Zoho
   * coincide con el de WO salvo estas excepciones (código → nombre EXACTO en WO). Es
   * un override: para un código que no esté aquí se usa el nombre que trae Zoho.
   * INCOMPLETO: son solo las 5 discrepancias conocidas; la homologación completa sale
   * de la hoja `ceco` del modelo (74 centros), que aún no se ha aportado (ver §5).
   */
  centrosCostosWO: Record<string, string>;
  /** Asunto (y encabezado del cuerpo) del correo automático. */
  emailAsunto: string;
}

export const DEFAULT_CONFIG: WoSalesConfig = {
  empresa: 'AMBIENTALIA SAS',
  tipoDocumento: 'PED',
  // Vacío = OV_{año del documento}. El '_' y el año salen del modelo (OV_2026). Se
  // deriva del año para que en enero no haya que tocar nada.
  prefijo: '',
  // Fijo '1' (confirmado por Alfonso). OJO §9: con un número fijo, todas las líneas de
  // un archivo comparten la llave de documento; el archivo debe llevar UNA sola OV
  // (modo un_archivo_por_pedido) o World Office fusionaría pedidos. Pendiente de cablear.
  documentoNumero: '1',
  terceroInterno: '416544',
  nota: 'PEDIDO',
  formaPago: 'Credito',
  verificado: '0',
  anulado: '0',
  bodega: 'Principal',
  unidadDeMedida: 'Und.',
  // VALIDAR con Xiomara: tratamiento de artículos exentos o con IVA distinto.
  iva: '0.19',
  descuento: '0',
  // VALIDAR con Xiomara: la muestra la llama 'QueryDef_Exportar'.
  nombreHoja: 'QueryDef_Exportar',
  vencimiento: {
    regla: 'fecha_documento_mas_plazo',
    plazoPorDefectoDias: 30,
    diasHabiles: false,
  },

  // Fuente única en salesOrderStatus.ts (la comparte el endpoint de órdenes por
  // facturar). Las parcialmente facturadas entran, pero SOLO con sus líneas aún
  // pendientes: lo ya facturado se descuenta por línea con quantity_invoiced (ver
  // hub.source.ts). Una OV totalmente facturada sale por su status ('invoiced').
  estadosVivos: [...ESTADOS_OV_POR_FACTURAR],

  // Las 5 discrepancias conocidas nombre-Zoho → nombre-WO (§5). El resto de códigos
  // usan el nombre de Zoho tal cual (coincide con WO). Completar con la hoja `ceco`.
  centrosCostosWO: {
    '330501': 'EDM 180 C C&R',
    '5505': 'BOTELLAS DE GASES',
    '550301': 'Shelter M,L,XL, E.S. Opcionales y Repuestos, Botellas',
    '550303': 'ALQUILERES AMB',
    '3305': 'CONSUMIBLES MONITOR Y REPARACION DE PARTICULAS',
  },
  emailAsunto: 'Nueva actualización de MovimientoInventarioWO',
};
