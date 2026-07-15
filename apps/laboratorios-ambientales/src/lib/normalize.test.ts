import { describe, it, expect } from 'vitest';
import { normalizeEstado, normalizeMatriz, normalizeComponente, normalizeActividad } from './normalize';

describe('normalizeEstado', () => {
  it('acepta los dos únicos valores que existen en el dataset', () => {
    expect(normalizeEstado('Activa')).toBe('Activa');
    expect(normalizeEstado('Suspendida')).toBe('Suspendida');
  });

  it('es insensible a mayúsculas y recorta espacios', () => {
    expect(normalizeEstado('  ACTIVA ')).toBe('Activa');
    expect(normalizeEstado('suspendida')).toBe('Suspendida');
  });

  it('descarta los valores que la app usaba y el dataset nunca trajo', () => {
    expect(normalizeEstado('VIGENTE')).toBe('');
    expect(normalizeEstado('Activo')).toBe('');
  });

  it('devuelve cadena vacía ante entrada vacía', () => {
    expect(normalizeEstado('')).toBe('');
  });
});

describe('normalizeMatriz', () => {
  it('no estropea los valores reales del dataset', () => {
    expect(normalizeMatriz('Agua')).toBe('Agua');
    expect(normalizeMatriz('Aire')).toBe('Aire');
    expect(normalizeMatriz('Suelo')).toBe('Suelo');
    expect(normalizeMatriz('Biota')).toBe('Biota');
    expect(normalizeMatriz('Sedimento')).toBe('Sedimento');
    expect(normalizeMatriz('Lodo')).toBe('Lodo');
    expect(normalizeMatriz('Biosólido')).toBe('Biosólido');
  });

  it('preserva el acrónimo RESPEL, que el title-case del fallthrough destrozaría', () => {
    expect(normalizeMatriz('Residuos Peligrosos (RESPEL)')).toBe('Residuos Peligrosos (RESPEL)');
    expect(normalizeMatriz('ReSIduos Peligrosos (RESPEL)')).toBe('Residuos Peligrosos (RESPEL)');
  });

  it('unifica las dos grafías de aceite dieléctrico que trae el dataset', () => {
    expect(normalizeMatriz('Aceite Dieléctrico')).toBe('Aceite Dieléctrico');
    expect(normalizeMatriz('Aceite dieléctrico')).toBe('Aceite Dieléctrico');
  });

  it('deja pasar sin tocar un valor desconocido, solo recortado', () => {
    expect(normalizeMatriz('  Biota ')).toBe('Biota');
  });
});

describe('normalizeComponente', () => {
  it('canoniza los componentes conocidos', () => {
    expect(normalizeComponente('CALIDAD DE AIRE')).toBe('Calidad del Aire');
    expect(normalizeComponente('fuentes fijas')).toBe('Fuentes Fijas');
  });

  it('unifica las dos preposiciones de calidad del aire, canónica la mayoritaria', () => {
    expect(normalizeComponente('Calidad del Aire')).toBe('Calidad del Aire');
    expect(normalizeComponente('Calidad de aire')).toBe('Calidad del Aire');
    expect(normalizeComponente('CALIDAD DEL AIRE')).toBe('Calidad del Aire');
  });

  it('unifica las tres grafías de biota acuática marina', () => {
    expect(normalizeComponente('Biota Acuática Marina')).toBe('Biota Acuática Marina');
    expect(normalizeComponente('Biota acuática marina')).toBe('Biota Acuática Marina');
    expect(normalizeComponente('Biota acuática Marina')).toBe('Biota Acuática Marina');
  });

  it('unifica las demás grafías divergentes del dataset', () => {
    expect(normalizeComponente('Olores ofensivos')).toBe('Olores Ofensivos');
    expect(normalizeComponente('Superficies sólidas no porosas')).toBe('Superficies Sólidas No Porosas');
    expect(normalizeComponente('Aceite dieléctrico')).toBe('Aceite Dieléctrico');
    expect(normalizeComponente('Fuentes fijas')).toBe('Fuentes Fijas');
    expect(normalizeComponente('Biota acuática continental')).toBe('Biota Acuática Continental');
  });

  it('no estropea los componentes de una sola grafía', () => {
    expect(normalizeComponente('Continental')).toBe('Continental');
    expect(normalizeComponente('Ruido')).toBe('Ruido');
    expect(normalizeComponente('Vibraciones')).toBe('Vibraciones');
  });

  it('preserva el acrónimo RESPEL, que el title-case del fallthrough destrozaría', () => {
    expect(normalizeComponente('Residuos Peligrosos (RESPEL)')).toBe('Residuos Peligrosos (RESPEL)');
    expect(normalizeComponente('ReSIduos Peligrosos (RESPEL)')).toBe('Residuos Peligrosos (RESPEL)');
  });
});

describe('normalizeActividad', () => {
  it('pasa a Capitalizado Por Palabra', () => {
    expect(normalizeActividad('análisis')).toBe('Análisis');
    expect(normalizeActividad('TOMA DE MUESTRAS')).toBe('Toma De Muestras');
  });

  it('devuelve cadena vacía ante entrada vacía', () => {
    expect(normalizeActividad('')).toBe('');
  });

  it('colapsa los espacios internos duplicados que trae el dataset', () => {
    expect(normalizeActividad('Muestreo  Integrado en Cuerpo Lótico')).toBe('Muestreo Integrado En Cuerpo Lótico');
  });
});
