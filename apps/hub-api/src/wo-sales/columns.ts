/**
 * Las 58 columnas del archivo de World Office, en el orden EXACTO del archivo que Xiomara
 * CARGÓ con éxito en WO el 26/08/2026: 31 de encabezado (0–30) + 27 de detalle (31–57).
 * World Office lee por POSICIÓN, así que no se añade, quita ni reordena.
 *
 * Cambio clave frente al modelo teórico (que tenía 57 con `Importacion` en la 29): la
 * carga real exigió UNA columna adicional antes de `Producto`. En su lugar van DOS,
 * `Sucursal` (29) y `Clasificación` (30) —ambas vacías en todas las filas, pero deben
 * existir—, y `Producto` arranca en la 31 (observación 4 de Xiomara).
 */
const PERSONALIZADOS_ENCAB = Array.from({ length: 15 }, (_, i) => `Personalizado${i + 1}`);
const PERSONALIZADOS_DETALLE = Array.from({ length: 15 }, (_, i) => `Personalizado${i + 1}Det`);

export const COLUMNS: readonly string[] = [
  // — Encabezado (0–30): se repite idéntico en cada línea del mismo pedido —
  'Empresa',
  'Tipo Documento',
  'prefijo',
  'DocumentoNúmero',
  'Fecha',
  'Tercero Interno',
  'Tercero Externo',
  'Nota',
  'FormaDePago',
  'FechaEntrega',
  'Moneda',
  'TRM',
  'Verificado',
  'Anulado',
  ...PERSONALIZADOS_ENCAB,
  'Sucursal',
  'Clasificación',
  // — Detalle (31–57): una fila por línea de producto —
  'Producto',
  'Bodega',
  'UnidadDeMedida',
  'Cantidad',
  'Iva',
  'Valor',
  'Descuento',
  'Vencimiento',
  'Nota Detalle',
  'Centro Costos',
  'Moneda Det',
  'TRM Det',
  ...PERSONALIZADOS_DETALLE,
];

/**
 * Tipo de cada columna en el .xls de World Office. El CSV es todo texto, pero el .xls
 * tipa cada celda: `Fecha` y `Vencimiento` como fecha (serial con formato m/d/yy),
 * unos pocos campos como número y el resto texto. Verificado contra el archivo cargado.
 *
 * OJO (el archivo cargado manda):
 * - `DocumentoNúmero` es NÚMERO (consecutivo por pedido, ver builder), ya no texto.
 * - `Tercero Interno` y `Tercero Externo` (NIT) son TEXTO, ya no número.
 * - `Producto` (SKU) es TEXTO aunque parezca numérico (p. ej. "3011026485").
 */
export type TipoColumna = 'texto' | 'numero' | 'fecha';

const NUMERO = new Set<string>([
  'DocumentoNúmero',
  'Verificado',
  'Anulado',
  'Cantidad',
  'Iva',
  'Valor',
  'Descuento',
]);
const FECHA = new Set<string>(['Fecha', 'Vencimiento']);

export const TIPO_COLUMNA: readonly TipoColumna[] = COLUMNS.map((c) =>
  FECHA.has(c) ? 'fecha' : NUMERO.has(c) ? 'numero' : 'texto'
);
