import { describe, it, expect } from 'vitest';
import { esValorVacio, separarSeries } from './baseInstalada';

describe('esValorVacio', () => {
  it('en blanco o solo espacios', () => {
    expect(esValorVacio('')).toBe(true);
    expect(esValorVacio('   ')).toBe(true);
  });

  it('solo guiones', () => {
    for (const valor of ['-', '---', ' -- ', '–', '—']) expect(esValorVacio(valor), valor).toBe(true);
  });

  it('«No aplica», «N/A» y «NA», sin distinguir mayúsculas', () => {
    for (const valor of ['No aplica', 'NO APLICA', 'No  Aplica', ' no aplica ', 'N/A', 'n/a', 'NA', 'na']) {
      expect(esValorVacio(valor), valor).toBe(true);
    }
  });

  it('un valor real no está vacío', () => {
    for (const valor of ['SN-0001', '0', 'NA-0001', 'Estación Ficticia Centro', '-12']) {
      expect(esValorVacio(valor), valor).toBe(false);
    }
  });
});

describe('separarSeries', () => {
  it('una sola serie, recortada', () => {
    expect(separarSeries('  SN-0001 ')).toEqual(['SN-0001']);
  });

  it('parte por comas, puntos y comas y saltos de línea', () => {
    expect(separarSeries('SN-0001, SN-0002;SN-0003\nSN-0004\r\nSN-0005')).toEqual([
      'SN-0001',
      'SN-0002',
      'SN-0003',
      'SN-0004',
      'SN-0005',
    ]);
  });

  it('no parte por «/» ni por espacios', () => {
    expect(separarSeries('XY-12345-678/2')).toEqual(['XY-12345-678/2']);
    expect(separarSeries('AB 1234')).toEqual(['AB 1234']);
  });

  it('descarta los trozos vacíos', () => {
    expect(separarSeries('SN-0001,, ;\n')).toEqual(['SN-0001']);
    expect(separarSeries('SN-0001, ---, No aplica')).toEqual(['SN-0001']);
    expect(separarSeries('')).toEqual([]);
  });
});
