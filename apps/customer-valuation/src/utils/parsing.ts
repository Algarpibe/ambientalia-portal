export function parseCurrency(value: unknown, divideBy1000 = false): number {
  if (typeof value === 'number') return divideBy1000 ? value / 1000 : value;
  if (value === undefined || value === null || value === '') return 0;
  const raw = String(value).trim();
  // Remove currency symbols/letters/spaces
  const cleaned = raw.replace(/[A-Za-z$€£¥₱₡₲₴₩₦₸₿\s]/g, '');

  // Detect decimal separator (last occurrence of , or .)
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let decimalSep = '';
  if (lastComma > -1 || lastDot > -1) {
    decimalSep = lastComma > lastDot ? ',' : '.';
  }

  let normalized = cleaned;
  if (decimalSep) {
    const otherSep = decimalSep === ',' ? /\./g : /,/g;
    normalized = normalized.replace(otherSep, '');
    if (decimalSep === ',') normalized = normalized.replace(',', '.');
  } else {
    // No clear decimal separator; remove all non-digits/signs
    normalized = normalized.replace(/[^0-9-]/g, '');
  }

  const num = Number(normalized);
  const result = Number.isFinite(num) ? num : 0;
  return divideBy1000 ? result / 1000 : result;
}

const spanishMonths: Record<string, number> = {
  ene: 0,
  feb: 1,
  mar: 2,
  abr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  ago: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dic: 11
};

export function parseExcelDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const base = new Date(Date.UTC(1899, 11, 30));
    return new Date(base.getTime() + value * 86400000);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Try ISO/locale parse
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return parsed;

    // Try spanish short month e.g., "12 ene 2024"
    const parts = trimmed.toLowerCase().match(/(\d{1,2})\s+([a-zñ\.]{3})\s+(\d{2,4})/i);
    if (parts) {
      const day = Number(parts[1]);
      const mon = spanishMonths[parts[2].replace('.', '')];
      const year = Number(parts[3].length === 2 ? '20' + parts[3] : parts[3]);
      if (!isNaN(day) && mon !== undefined && !isNaN(year)) {
        return new Date(Date.UTC(year, mon, day));
      }
    }
  }
  return new Date(NaN);
}
