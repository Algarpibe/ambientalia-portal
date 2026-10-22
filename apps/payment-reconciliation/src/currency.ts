// The Conciliador reports in pesos. Zoho's base currency is USD, but 99 % of
// invoices are COP, and `total`/`balance` come in each invoice's OWN currency.
// We do not convert: money KPIs cover COP only, other currencies are separated.

import { formatCOP } from '@suite/format';

export const BASE_REPORTING_CURRENCY = 'COP';

/** ISO code of an invoice row: trimmed, upper-case, COP when missing. */
export function currencyOf(row: { currencyCode?: string }): string {
  return row.currencyCode?.trim().toUpperCase() || BASE_REPORTING_CURRENCY;
}

export const isCop = (row: { currencyCode?: string }): boolean => currencyOf(row) === BASE_REPORTING_CURRENCY;

const plainNumber = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

/**
 * Formats ONE amount with its own currency. Pesos without decimals (as everywhere
 * in the app); other currencies keep their cents. A bad code from data never
 * throws, and is not dressed as pesos: it prints the number and the code.
 */
export function formatMoney(amount: number, currency: string = BASE_REPORTING_CURRENCY): string {
  // ARQ-611: el peso es el de todo el portal (mismas opciones Intl y mismo guard
  // NaN/Infinity → 0); solo las otras divisas se formatean aquí.
  if (currency === BASE_REPORTING_CURRENCY) return formatCOP(amount);
  const value = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      ...(currency === BASE_REPORTING_CURRENCY ? { maximumFractionDigits: 0 } : {}),
    }).format(value);
  } catch {
    return `${plainNumber.format(value)} ${currency}`;
  }
}

/**
 * Importe de una fila de la tabla de conciliación (ARQ-611). Los pesos salen como
 * formatCOP, igual que en el resto de la app; antes se pintaban en en-US con
 * código ("COP  1,234,568"). Las demás divisas conservan a propósito ese formato
 * en-US con código y sin decimales ("USD  1,235"): cambiar cómo se ven los dólares
 * de la tabla es otra decisión, fuera de esta unificación del peso.
 */
export function formatTableAmount(amount: number, currency: string): string {
  if (currency === BASE_REPORTING_CURRENCY) return formatCOP(amount);
  return amount
    .toLocaleString('en-US', { style: 'currency', currency, currencyDisplay: 'code', maximumFractionDigits: 0 })
    .replace(currency, currency + ' ');
}
