import { describe, it, expect } from 'vitest';
import { formatCOP } from '@suite/format';
import { BASE_REPORTING_CURRENCY, currencyOf, isCop, formatMoney, formatTableAmount } from './currency';

// ARQ-611 — el peso se pinta en todo el portal con formatCOP de @suite/format; la
// rama COP de formatMoney delega en él para que no vuelva a haber dos formatos.
// El espacio tras "$" es duro (U+00A0).
describe('formatMoney en pesos (ARQ-611)', () => {
  it('la rama COP es exactamente formatCOP', () => {
    expect(formatMoney(1234567.6)).toBe('$\u00a01.234.568');
    for (const n of [0, -1234.4, 1234567.6, NaN, Infinity]) {
      expect(formatMoney(n, 'COP')).toBe(formatCOP(n));
    }
  });
});

// ARQ-611 — la tabla principal pintaba los pesos en en-US con código
// ("COP  1,234,568"), distinto del resto de la app. Los pesos pasan a formatCOP;
// las demás divisas (≈1 % de las facturas) conservan su texto de siempre, porque
// la pantalla de dólares queda fuera de este cambio.
describe('formatTableAmount', () => {
  it('pesos como formatCOP, no como "COP  1,234,568"', () => {
    expect(formatTableAmount(1234567.6, 'COP')).toBe('$\u00a01.234.568');
    expect(formatTableAmount(NaN, 'COP')).toBe('$\u00a00');
  });

  it('otra divisa conserva el formato en-US con código, sin decimales', () => {
    // El espacio normal + el duro vienen del `.replace(código, código + ' ')` de siempre.
    expect(formatTableAmount(1234.5, 'USD')).toBe('USD \u00a01,235');
    expect(formatTableAmount(-1234.5, 'USD')).toBe('-USD \u00a01,235');
  });
});

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
