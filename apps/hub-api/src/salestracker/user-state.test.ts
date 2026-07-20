import { describe, it, expect } from 'vitest';
import { validateViewName, stateTooLarge, MAX_VIEW_NAME_LEN } from './user-state.js';

describe('validateViewName', () => {
  it('recorta y exige no vacío', () => { expect(validateViewName('  hola ')).toBe('hola'); });
  it('vacío → null', () => { expect(validateViewName('   ')).toBeNull(); });
  it(`> ${MAX_VIEW_NAME_LEN} → throw`, () => { expect(() => validateViewName('x'.repeat(MAX_VIEW_NAME_LEN + 1))).toThrow(); });
});
describe('stateTooLarge', () => {
  it('objeto pequeño → false', () => { expect(stateTooLarge({ a: 1 })).toBe(false); });
  it('> 32KB → true', () => { expect(stateTooLarge({ big: 'y'.repeat(40_000) })).toBe(true); });
});
