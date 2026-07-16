/**
 * Las 57 columnas del formato "DocumentosVentasEncabezadosMovimientoInventarioWO",
 * en el orden exacto del CSV de muestra que envió Xiomara.
 *
 * OJO: el acta y Descripcion_campos.docx dicen 56. Están mal: la cabecera real y
 * todas las filas de la muestra tienen 57 (31 de encabezado + 26 de detalle).
 * Manda el archivo. No añadir, quitar ni reordenar: World Office lee por posición.
 */
const PERSONALIZADOS_ENCAB = Array.from({ length: 15 }, (_, i) => `Encab: Personalizado ${i + 1}`);
const PERSONALIZADOS_DETALLE = Array.from({ length: 15 }, (_, i) => `Detalle: Personalizado${i + 1}`);

export const COLUMNS: readonly string[] = [
  'Encab: Empresa',
  'Encab: Tipo Documento',
  'Encab: Prefijo',
  'Encab: Documento Número',
  'Encab: Fecha',
  'Encab: Tercero Interno',
  'Encab: Tercero Externo',
  'Encab: Nota',
  'Encab: FormaPago',
  'Encab: Fecha Entrega',
  'Encab: Prefijo Documento Externo',
  'Encab: Número_Documento_Externo',
  'Encab: Verificado',
  'Encab: Anulado',
  ...PERSONALIZADOS_ENCAB,
  'Encab: Sucursal',
  'Encab: Clasificación',
  'Detalle: Producto',
  'Detalle: Bodega',
  'Detalle: UnidadDeMedida',
  'Detalle: Cantidad',
  'Detalle: IVA',
  'Detalle: Valor Unitario',
  'Detalle: Descuento',
  'Detalle: Vencimiento',
  'Detalle: Nota',
  // OJO: existen dos columnas de centro de costos, casi homónimas y en extremos
  // opuestos del array: esta (descripción, índice 40) y 'Detalle: Código Centro
  // Costos' (código, índice 56). Zoho da ambos valores en un solo campo,
  // "330801 CALIBRACION ENVIRO", que el builder parte en dos.
  'Detalle: Centro costos',
  ...PERSONALIZADOS_DETALLE,
  'Detalle: Código Centro Costos',
];
