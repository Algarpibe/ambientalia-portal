/**
 * Display formatting (master prompt §10): the engine never rounds; the UI
 * rounds only when showing a value. es-CO: comma decimal, dot grouping.
 * slope 5 decimals · intercept 3 · %Diff 2 · ppb 2.
 */

const cache = new Map<number, Intl.NumberFormat>();

function formatter(decimals: number): Intl.NumberFormat {
  let f = cache.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      // 'always': es-* locales skip grouping for 4-digit numbers by default.
      useGrouping: 'always' as unknown as boolean,
    });
    cache.set(decimals, f);
  }
  return f;
}

export const DASH = '—';

/** Fixed decimals, es-CO; null/undefined/non-finite → "—". Hyphen-minus so values can be copied back. */
export function formatNumber(n: number | null | undefined, decimals: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return formatter(decimals).format(n).replace(/\u2212/g, '-');
}

export const formatSlope = (n: number | null | undefined) => formatNumber(n, 5);
export const formatIntercept = (n: number | null | undefined) => formatNumber(n, 3);
export const formatPercent = (n: number | null | undefined) => formatNumber(n, 2);
export const formatPpb = (n: number | null | undefined) => formatNumber(n, 2);

/** A point difference with its unit: %Diff (Eq. 1) or AbsDiff in ppb (Eq. 2). */
export function formatDiff(value: number | null | undefined, type: 'PERCENT' | 'ABS_PPB' | null | undefined): string {
  const text = formatNumber(value, 2);
  if (text === DASH || !type) return text;
  return `${text} ${type === 'PERCENT' ? '%' : 'ppb'}`;
}

const ISO_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/** ISO date (or timestamp) → dd/mm/aaaa, reading the date part only (no timezone drift). */
export function formatDate(iso: string | null | undefined): string {
  const m = iso ? ISO_PREFIX.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : DASH;
}

/** Stored number → text for an editable input: comma decimal, full precision, no grouping. */
export function formatInputNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return String(n).replace('.', ',');
}
