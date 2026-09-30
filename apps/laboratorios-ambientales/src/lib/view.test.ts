import { describe, it, expect } from 'vitest';
import { hashFor, parseView } from './view';

describe('parseView', () => {
  it('reconoce cada vista por su hash', () => {
    expect(parseView('#buscador')).toBe('buscador');
    expect(parseView('#marcas')).toBe('dashboard');
  });

  it('sin hash, o con uno desconocido, abre el menú', () => {
    expect(parseView('')).toBe('main');
    expect(parseView('#')).toBe('main');
    expect(parseView('#otra-cosa')).toBe('main');
  });

  it('tolera mayúsculas y espacios en un enlace escrito a mano', () => {
    expect(parseView('#Buscador ')).toBe('buscador');
  });
});

describe('hashFor', () => {
  it('es el inverso de parseView', () => {
    for (const view of ['main', 'buscador', 'dashboard'] as const) {
      expect(parseView(hashFor(view))).toBe(view);
    }
  });

  it('el menú no lleva hash', () => {
    expect(hashFor('main')).toBe('');
  });
});
