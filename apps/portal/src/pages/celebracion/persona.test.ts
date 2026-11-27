import { describe, it, expect } from 'vitest';
import { COLORES_AVATAR } from './marca';
import { colorDe, iniciales, primerNombre } from './persona';

describe('persona', () => {
  it('iniciales: 1.ª palabra y 2.ª (o 3.ª si hay cuatro o más), sin partículas', () => {
    expect(iniciales('Ana Ruiz')).toBe('AR');
    expect(iniciales('ANA MARÍA RUIZ DÍAZ')).toBe('AR');
    expect(iniciales('maría de la paz gómez')).toBe('MP');
    expect(iniciales('Bruno')).toBe('B');
    expect(iniciales('   ')).toBe('?');
  });

  it('primerNombre en formato de nombre propio', () => {
    expect(primerNombre('BRUNO DÍAZ')).toBe('Bruno');
    expect(primerNombre('ñandú pérez')).toBe('Ñandú');
  });

  it('colorDe es estable y sale de la paleta de avatares', () => {
    const id = '00000000-0000-4000-8000-00000000000a';
    expect(colorDe(id)).toBe(colorDe(id));
    expect(COLORES_AVATAR).toContain(colorDe(id));
  });
});
