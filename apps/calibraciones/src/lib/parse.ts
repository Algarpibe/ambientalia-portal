/**
 * Lenient decimal parsing for lab data entry: accepts "15,2" and "15.2".
 * With both separators the last one is the decimal separator ("1.234,5").
 * Returns null for empty text and NaN for anything that is not a number.
 */
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

export function parseDecimal(text: string): number | null {
  const t = text.trim().replace(/\s+/g, '');
  if (t === '') return null;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else {
    normalized = t.replace(',', '.');
  }
  if ((t.match(/,/g)?.length ?? 0) > 1 && lastDot < 0) return Number.NaN;
  return NUMBER_RE.test(normalized) ? Number(normalized) : Number.NaN;
}
