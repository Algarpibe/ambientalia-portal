import { describe, it, expect } from 'vitest';
import { formatMoneda, formatCOP } from './format';

describe('formatMoneda', () => {
  it('COP usa el formateador de siempre', () => {
    expect(formatMoneda(1000, 'COP')).toBe(formatCOP(1000));
  });

  it('otra moneda se formatea con su código, no como pesos', () => {
    const s = formatMoneda(5000, 'USD');
    expect(s).not.toBe(formatCOP(5000));
    expect(s).toMatch(/US\$|USD/);
  });

  it('un código de moneda inválido no rompe la pantalla', () => {
    expect(formatMoneda(10, 'XX')).toBe('XX 10');
  });
});
