// @suite/format — formateadores de moneda/número compartidos por las apps del
// portal (cierra AI-613: cada app redefinía Intl.NumberFormat, con/ sin guard
// isFinite, USD vs COP inconsistente). Todas las funciones son puras y aplican
// el guard: un valor no finito (NaN/Infinity) formatea como 0, nunca "NaN".

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

/** Devuelve `n` si es finito; si no (NaN/±Infinity), 0. Evita renders "NaN". */
export function safeNumber(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/** Pesos colombianos sin decimales. Ej: $1.234.567 */
export function formatCOP(n: number): string {
  return cop.format(safeNumber(n));
}

/** Dólares sin decimales. Ej: $1,234,568 */
export function formatUSD(n: number): string {
  return usd.format(safeNumber(n));
}

/** USD compacto para ejes/tooltips. Ej: $1,2 M / $980 K */
export function formatCompactUSD(n: number): string {
  return usdCompact.format(safeNumber(n));
}

/** Fracción 0..1 como porcentaje con un decimal. Ej: 0.1234 → "12.3%" */
export function formatPct(fraccion: number): string {
  return `${(safeNumber(fraccion) * 100).toFixed(1)}%`;
}

/**
 * DATA-334 — `n` redondeado a `decimales`, como número (no como texto), para la
 * frontera de una exportación: las sumas y restas en coma flotante dejan residuo
 * (0,1 + 0,2 = 0.30000000000000004) y un exportador a Excel lo escribía tal cual.
 * Importes a 2 decimales; cantidades a 6, como `sinResiduo` de hub-api (wo-sales):
 * el residuo vive en el decimal 15-16 y ninguna cantidad real de Zoho llega a seis.
 *
 * Excepción al guard de este módulo: NaN e Infinity pasan sin tocar. Esto no
 * pinta un texto sino que entrega el dato, y convertirlo en 0 escondería una
 * celda rota bajo un valor verosímil. El `+ 0` evita el -0 de un residuo negativo.
 */
export function redondear(n: number, decimales: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(decimales)) + 0 : n;
}

/** Lo que Excel o LibreOffice ejecutan como fórmula si abre la celda. */
const INICIO_DE_FORMULA = /^[=+\-@\t\r]/;

/**
 * Una celda lista para un CSV que alguien abrirá en Excel (AI-913).
 *
 * Cierra la inyección de fórmulas (SEC-231/232): un TEXTO que empieza por
 * `= + - @`, tabulador o retorno de carro se prefija con una comilla simple,
 * que Excel muestra como texto literal en vez de ejecutarlo. Antes había tres
 * escapadores escritos por separado y ninguno lo hacía.
 *
 * Solo los textos: un `number` sale tal cual, porque un intercepto de -0,0012
 * es un dato y con la comilla delante Excel lo leería como texto. Quien ya
 * convirtió el número a cadena (para fijar decimales, por ejemplo) tiene que
 * pasar el número y no la cadena, o el `-` se neutralizará.
 *
 * Después, entrecomillado RFC 4180 si el texto lleva comillas, el separador o
 * saltos de línea.
 *
 * ⚠️ NO sirve para el fichero de World Office (SEC-233): ese no lo abre una
 * persona sino el importador de WO, y la comilla acabaría dentro de los datos.
 */
export function escaparCeldaCsv(valor: string | number | null | undefined, separador = ';'): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return String(valor);
  const texto = INICIO_DE_FORMULA.test(valor) ? `'${valor}` : valor;
  const necesitaComillas = texto.includes('"') || texto.includes(separador) || /[\r\n]/.test(texto);
  return necesitaComillas ? `"${texto.replace(/"/g, '""')}"` : texto;
}
