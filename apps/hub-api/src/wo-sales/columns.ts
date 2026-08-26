/**
 * Las 57 columnas del archivo de World Office, en el orden EXACTO del modelo
 * (hoja QueryDef_Exportar del .xls que envió Xiomara): 30 de encabezado (0–29) + 27
 * de detalle (30–56). World Office lee por POSICIÓN, así que no se añade, quita ni
 * reordena. Nombres literales del modelo (ojo: `prefijo` en minúscula; sin los
 * prefijos "Encab:/Detalle:" que usaba la versión anterior).
 *
 * Cambios frente al layout anterior (que iba corrido +1 a partir de la posición 29):
 * - 10–11 pasan a ser `Moneda`/`TRM` (antes `Prefijo/Número_Documento_Externo`).
 * - 29 es UNA sola columna `Importacion` (antes `Sucursal` + `Clasificación`).
 * - desaparece la columna extra `Código Centro Costos` del final: el modelo solo lleva
 *   el NOMBRE del centro de costos (posición 39), no el código.
 */
const PERSONALIZADOS_ENCAB = Array.from({ length: 15 }, (_, i) => `Personalizado${i + 1}`);
const PERSONALIZADOS_DETALLE = Array.from({ length: 15 }, (_, i) => `Personalizado${i + 1}Det`);

export const COLUMNS: readonly string[] = [
  // — Encabezado (0–29): se repite idéntico en cada línea de la misma OV —
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
  'Importacion',
  // — Detalle (30–56): una fila por línea de producto —
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
 * unos pocos campos como número y el resto texto. Verificado celda a celda contra el
 * modelo.
 *
 * OJO, cambios de tipo frente a la versión anterior (el modelo manda):
 * - `DocumentoNúmero` es NÚMERO (fijo 1), ya no texto.
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
