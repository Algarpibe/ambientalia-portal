import { describe, it, expect } from 'vitest';
import { BASE_REPORTING_CURRENCY, currencyOf, isCop, formatMoney } from './currency';

describe('currency helpers', () => {
  it('reports in COP', () => {
    expect(BASE_REPORTING_CURRENCY).toBe('COP');
  });

  it('currencyOf trims, upper-cases and defaults to COP', () => {
    expect(currencyOf({ currencyCode: ' usd ' })).toBe('USD');
    expect(currencyOf({ currencyCode: 'EUR' })).toBe('EUR');
    expect(currencyOf({})).toBe('COP');
    expect(currencyOf({ currencyCode: '   ' })).toBe('COP');
  });

  it('isCop is true for COP and missing codes only', () => {
    expect(isCop({ currencyCode: 'cop' })).toBe(true);
    expect(isCop({})).toBe(true);
    expect(isCop({ currencyCode: 'USD' })).toBe(false);
  });
});

describe('formatMoney', () => {
  it('formats COP without decimals by default', () => {
    expect(formatMoney(1500000)).toContain('1.500.000');
    expect(formatMoney(1500000, 'COP')).toBe(formatMoney(1500000));
  });

  it('formats USD with its own currency', () => {
    const s = formatMoney(1234, 'USD');
    expect(s).toContain('1.234');
    expect(s).toMatch(/US\$|USD/);
  });

  it('never throws on an invalid currency code and keeps the code visible', () => {
    expect(() => formatMoney(1000, 'XXXX')).not.toThrow();
    expect(formatMoney(1000, 'XXXX')).toContain('XXXX');
  });

  it('keeps the cents of currencies that have them', () => {
    expect(formatMoney(1234.5, 'USD')).toContain('1.234,50');
    expect(formatMoney(99.9, 'EUR')).toContain('99,90');
  });

  it('does not dress an unknown code as pesos', () => {
    expect(formatMoney(1000, 'XXXX')).not.toContain('$');
    expect(formatMoney(1000, 'XXXX')).toBe('1.000 XXXX');
  });

  it('treats nullish/NaN amounts as zero', () => {
    expect(formatMoney(NaN)).toContain('0');
  });
});
