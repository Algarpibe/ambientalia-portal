import { describe, expect, it } from 'vitest';
import { parseDecimal } from './parse';

describe('parseDecimal', () => {
  it('accepts comma or dot as decimal separator', () => {
    expect(parseDecimal('15,2')).toBe(15.2);
    expect(parseDecimal('15.2')).toBe(15.2);
    expect(parseDecimal('-0,1')).toBe(-0.1);
    expect(parseDecimal(' 200 ')).toBe(200);
  });
  it('with both separators the last one is the decimal separator', () => {
    expect(parseDecimal('1.234,5')).toBe(1234.5);
    expect(parseDecimal('1,234.5')).toBe(1234.5);
  });
  it('accepts a leading plus and exponent notation', () => {
    expect(parseDecimal('+3')).toBe(3);
    expect(parseDecimal('1e-3')).toBe(0.001);
  });
  it('empty text is null (field not filled)', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
  });
  it('anything that is not a number is NaN (invalid, shown as an error)', () => {
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('1,2,3')).toBeNaN();
    expect(parseDecimal('12a')).toBeNaN();
    expect(parseDecimal('1..2')).toBeNaN();
  });
});
