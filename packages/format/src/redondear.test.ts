import { describe, it, expect } from 'vitest';
import { redondear } from './index';

// DATA-334 — las sumas y restas en coma flotante dejan residuo (0,1 + 0,2 =
// 0.30000000000000004) y los exportadores a Excel lo escribían tal cual en la celda.
describe('redondear', () => {
  it('quita el residuo de coma flotante a los decimales pedidos', () => {
    expect(redondear(0.1 + 0.2, 2)).toBe(0.3);
    expect(redondear(0.1 + 0.2, 6)).toBe(0.3);
    expect(redondear(10.2 - 7, 6)).toBe(3.2);
  });

  it('a seis decimales no altera una cantidad real con pocos decimales', () => {
    expect(redondear(1.2345, 6)).toBe(1.2345);
    expect(redondear(1234567.125, 6)).toBe(1234567.125);
  });

  it('a dos decimales deja el importe en centavos', () => {
    expect(redondear(19.999, 2)).toBe(20);
    expect(redondear(1234.5678, 2)).toBe(1234.57);
  });

  it('no devuelve -0 cuando un residuo negativo se redondea a cero', () => {
    expect(Object.is(redondear(-1e-12, 6), 0)).toBe(true);
  });

  it('NaN e Infinity pasan sin tocar: el redondeo no inventa ni esconde un dato roto', () => {
    expect(redondear(Number.NaN, 2)).toBeNaN();
    expect(redondear(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY);
  });
});
