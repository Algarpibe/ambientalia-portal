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

  it('Thermo Scientific y sus nombres anteriores son una sola marca con la etiqueta «Thermo Scientific»', () => {
    expect(marcasDe('Thermo Scientific / Rupprecht & Patashnick')).toEqual(['Thermo Scientific']);
    expect(marcasDe('Thermo Andersen / Thermo Scientific')).toEqual(['Thermo Scientific']);
    expect(marcasDe('Thermo Environmental')).toEqual(['Thermo Scientific']);
    expect(marcasDe('Wedding & Associates / Thermo Environmental')).toEqual([
      'Wedding & Associates',
      'Thermo Scientific',
    ]);
  });

  it('el nombre anterior de Teledyne API es Teledyne API; Teledyne Monitor Labs sigue aparte', () => {
    expect(marcasDe('Advanced Pollution Instrumentation')).toEqual(['Teledyne API']);
    expect(marcasDe('Teledyne Monitor Labs')).toEqual(['Teledyne Monitor Labs']);
  });

  it('un texto largo mezcla fabricantes sueltos y grupos', () => {
    expect(
      marcasDe('Teledyne Monitor Labs / Casella / Ecotech / Acoem / Aeris / Wedding & Associates'),
    ).toEqual(['Teledyne Monitor Labs', 'Casella', 'Ecotech / Acoem', 'Aeris', 'Wedding & Associates']);
  });
});
