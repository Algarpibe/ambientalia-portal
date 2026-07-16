import { describe, it, expect } from 'vitest';
import { toWindows1252 } from './encoding.js';

describe('toWindows1252', () => {
  it('codifica ú como el byte 0xFA, no como UTF-8', () => {
    const buf = toWindows1252('Número');
    // UTF-8 daría 0xC3 0xBA para ú; Windows-1252 da un solo byte 0xFA.
    expect([...buf]).toEqual([0x4e, 0xfa, 0x6d, 0x65, 0x72, 0x6f]);
  });

  it('codifica ñ y tildes en un byte', () => {
    expect([...toWindows1252('ñ')]).toEqual([0xf1]);
    expect([...toWindows1252('á')]).toEqual([0xe1]);
    expect([...toWindows1252('Ó')]).toEqual([0xd3]);
  });

  it('codifica caracteres del rango 0x80-0x9F que latin1 no cubre', () => {
    // Este es el motivo de usar iconv-lite y no Buffer.from(s,'latin1'):
    // latin1 destrozaría estos, y aparecen en nombres de producto.
    expect([...toWindows1252('–')]).toEqual([0x96]);
    expect([...toWindows1252('€')]).toEqual([0x80]);
  });
});
