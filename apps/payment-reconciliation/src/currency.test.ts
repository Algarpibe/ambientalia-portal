import { describe, it, expect } from 'vitest';
import { BASE_REPORTING_CURRENCY, currencyOf, isCop } from './currency';

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
