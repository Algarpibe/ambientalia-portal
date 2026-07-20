import { describe, it, expect } from 'vitest';
import { validateCategoryName, validateColor } from './categories.js';
describe('validateCategoryName', () => {
  it('recorta y exige 1..100', () => { expect(validateCategoryName('  Equipos ')).toBe('Equipos'); });
  it('vacío → throw', () => { expect(() => validateCategoryName('   ')).toThrow(); });
  it('>100 → throw', () => { expect(() => validateCategoryName('x'.repeat(101))).toThrow(); });
});
describe('validateColor', () => {
  it('hex válido pasa', () => { expect(validateColor('#3B82f6')).toBe('#3B82f6'); });
  it('no hex → throw', () => { expect(() => validateColor('rojo')).toThrow(); });
  it('undefined → default', () => { expect(validateColor(undefined)).toBe('#3b82f6'); });
});
