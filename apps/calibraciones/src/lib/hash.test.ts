import { describe, expect, it } from 'vitest';
import { buildHash, parseHash } from './hash';

describe('parseHash', () => {
  it('defaults to the O3 tab, equipment section', () => {
    expect(parseHash('')).toEqual({ type: 'o3', section: 'equipos', id: null });
    expect(parseHash('#')).toEqual({ type: 'o3', section: 'equipos', id: null });
  });
  it('reads type, section and id', () => {
    expect(parseHash('#o3/verificaciones/abc-1')).toEqual({ type: 'o3', section: 'verificaciones', id: 'abc-1' });
    expect(parseHash('#o3/vencimientos')).toEqual({ type: 'o3', section: 'vencimientos', id: null });
  });
  it('unknown type or section falls back to the defaults', () => {
    expect(parseHash('#xx/verificaciones')).toEqual({ type: 'o3', section: 'equipos', id: null });
    expect(parseHash('#o3/nada')).toEqual({ type: 'o3', section: 'equipos', id: null });
  });
  it('decodes the id', () => {
    expect(parseHash('#o3/equipos/a%20b').id).toBe('a b');
  });
});

describe('buildHash', () => {
  it('round-trips', () => {
    expect(buildHash({ type: 'o3', section: 'verificaciones', id: 'nueva' })).toBe('#o3/verificaciones/nueva');
    expect(buildHash({ type: 'o3', section: 'calculadoras', id: null })).toBe('#o3/calculadoras');
    expect(parseHash(buildHash({ type: 'o3', section: 'equipos', id: 'a b' }))).toEqual({ type: 'o3', section: 'equipos', id: 'a b' });
  });
});
