import { describe, it, expect } from 'vitest';
import { validateGroupName, validateGroupColor } from './groupings.js';
describe('validateGroupName', () => {
  it('recorta y exige 1..100', () => { expect(validateGroupName('  Insumos ')).toBe('Insumos'); });
  it('vacío → throw', () => { expect(() => validateGroupName('   ')).toThrow(); });
  it('>100 → throw', () => { expect(() => validateGroupName('x'.repeat(101))).toThrow(); });
});
describe('validateGroupColor', () => {
  it('hex válido pasa', () => { expect(validateGroupColor('#6366F1')).toBe('#6366F1'); });
  it('no hex → throw', () => { expect(() => validateGroupColor('rojo')).toThrow(); });
  it('undefined → default #6366f1', () => { expect(validateGroupColor(undefined)).toBe('#6366f1'); });
  it('vacío → default #6366f1', () => { expect(validateGroupColor('')).toBe('#6366f1'); });
});
