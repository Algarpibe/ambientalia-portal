// The Conciliador reports in pesos. Zoho's base currency is USD, but 99 % of
// invoices are COP, and `total`/`balance` come in each invoice's OWN currency.
// We do not convert: money KPIs cover COP only, other currencies are separated.

export const BASE_REPORTING_CURRENCY = 'COP';

/** ISO code of an invoice row: trimmed, upper-case, COP when missing. */
export function currencyOf(row: { currencyCode?: string }): string {
  return row.currencyCode?.trim().toUpperCase() || BASE_REPORTING_CURRENCY;
}

export const isCop = (row: { currencyCode?: string }): boolean => currencyOf(row) === BASE_REPORTING_CURRENCY;

const copFormat = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

/** Formats ONE amount with its own currency. A bad code from data never throws. */
export function formatMoney(amount: number, currency: string = BASE_REPORTING_CURRENCY): string {
  const value = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${copFormat.format(value)} ${currency}`;
  }
}
