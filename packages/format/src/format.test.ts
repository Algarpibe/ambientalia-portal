import { describe, it, expect } from 'vitest';
import { formatCOP, formatUSD, formatPct } from './index';

// ARQ-611 — las apps sustituyen sus copias por estas funciones, así que el texto
// exacto que pintan queda fijado aquí. es-CO separa el símbolo del número con un
// espacio DURO (U+00A0), no con uno normal: un toBe con ' ' fallaría, y un
// toContain lo dejaría pasar sin notar que el símbolo cambió.
describe('formatCOP', () => {
  it('pesos sin decimales, punto de miles y espacio duro tras el símbolo', () => {
    expect(formatCOP(1234567)).toBe('$\u00a01.234.567');
    expect(formatCOP(1234567.6)).toBe('$\u00a01.234.568');
    expect(formatCOP(0)).toBe('$\u00a00');
  });

  it('el signo negativo va delante del símbolo', () => {
    expect(formatCOP(-1234.4)).toBe('-$\u00a01.234');
  });

  it('NaN e Infinity se pintan como 0, nunca "NaN" ni "∞"', () => {
    expect(formatCOP(NaN)).toBe('$\u00a00');
    expect(formatCOP(Infinity)).toBe('$\u00a00');
    expect(formatCOP(-Infinity)).toBe('$\u00a00');
  });
});

describe('formatUSD', () => {
  // es-CO marca el dólar como «US$» para no confundirlo con el peso; el formato
  // de número sigue siendo el colombiano (punto de miles), no el estadounidense.
  it('dólares sin decimales con prefijo US$ y separadores es-CO', () => {
    expect(formatUSD(1234567.6)).toBe('US$\u00a01.234.568');
    expect(formatUSD(0)).toBe('US$\u00a00');
  });

  it('NaN e Infinity se pintan como 0', () => {
    expect(formatUSD(NaN)).toBe('US$\u00a00');
    expect(formatUSD(Infinity)).toBe('US$\u00a00');
  });
});

describe('formatPct', () => {
  // toFixed no usa locale: el decimal es un punto, no la coma de es-CO.
  it('fracción 0..1 a porcentaje con un decimal y punto decimal', () => {
    expect(formatPct(0.1234)).toBe('12.3%');
    expect(formatPct(1)).toBe('100.0%');
    expect(formatPct(0)).toBe('0.0%');
  });

  it('NaN e Infinity se pintan como 0.0%', () => {
    expect(formatPct(NaN)).toBe('0.0%');
    expect(formatPct(Infinity)).toBe('0.0%');
  });
});
