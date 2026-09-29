/**
 * Text for the PDF documents. They use the PDF built-in Helvetica (no font
 * file to bundle or download), which only encodes WinAnsi (Latin-1 + a few
 * typographic signs). Anything else would print as garbage, so it is mapped
 * to a readable ASCII form here (DECISIONS D-036).
 */

// WinAnsi characters above U+00FF (the 0x80–0x9F block of cp1252).
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

const REPLACE: Record<string, string> = {
  '≤': '<=',
  '≥': '>=',
  '−': '-',
  '→': '->',
  '←': '<-',
  '↔': '<->',
  'Δ': 'Delta ',
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '²': '2',
  '³': '3',
  'ŷ': 'y ajust.',
  '≈': '~',
};

export function pdfSafe(text: string): string {
  const withMacron = text.replace(/([A-Za-z])̄/g, '$1 prom.');
  let out = '';
  for (const ch of withMacron) {
    const code = ch.codePointAt(0)!;
    if (REPLACE[ch] !== undefined) out += REPLACE[ch];
    else if (code <= 0xff || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else out += '?';
  }
  return out;
}

/** pdfSafe applied to every string of a plain data model (arrays and objects). */
export function pdfSafeDeep<T>(value: T): T {
  if (typeof value === 'string') return pdfSafe(value) as T;
  if (Array.isArray(value)) return value.map(pdfSafeDeep) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pdfSafeDeep(v)])) as T;
  }
  return value;
}
