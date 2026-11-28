import { describe, it, expect } from 'vitest';
import { marcasDe } from './marcas';

describe('marcasDe', () => {
  it('parte una marca con varios fabricantes; una sola queda igual', () => {
    expect(marcasDe('Tisch Environmental / New Star Environmental')).toEqual([
      'Tisch Environmental',
      'New Star Environmental',
    ]);
    expect(marcasDe('Met One Instruments, Inc.')).toEqual(['Met One Instruments, Inc.']);
  });

  it('una marca con «/» sin espacios queda entera', () => {
    expect(marcasDe('Marca A/B')).toEqual(['Marca A/B']);
  });

  it('una empresa con nombre viejo y nuevo es una sola opción', () => {
    expect(marcasDe('Environnement S.A. / ENVEA')).toEqual(['Environnement S.A. / ENVEA']);
    expect(marcasDe('BGI Inc. / Mesa Laboratories Inc.')).toEqual(['BGI Inc. / Mesa Laboratories Inc.']);
    expect(marcasDe('Graseby Andersen / Sierra-Andersen / General Metal Works')).toEqual([
      'Graseby Andersen / Sierra-Andersen / General Metal Works',
    ]);
  });

  it('dos fabricantes distintos siguen siendo dos opciones', () => {
    expect(marcasDe('Tisch Environmental / New Star Environmental')).toHaveLength(2);
  });

  it('un texto largo mezcla fabricantes sueltos y grupos', () => {
    expect(
      marcasDe('Teledyne Monitor Labs / Casella / Ecotech / Acoem / Aeris / Wedding & Associates'),
    ).toEqual(['Teledyne Monitor Labs', 'Casella', 'Ecotech / Acoem', 'Aeris', 'Wedding & Associates']);
  });
});
