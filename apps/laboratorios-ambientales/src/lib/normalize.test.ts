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
  it('agrupa las variantes en las matrices canónicas', () => {
    expect(normalizeMatriz('Agua residual')).toBe('Agua');
    expect(normalizeMatriz('AIRE')).toBe('Aire');
    expect(normalizeMatriz('Suelos')).toBe('Suelo');
  });

  it('clasifica RESPEL antes que agua', () => {
    expect(normalizeMatriz('Residuos peligrosos')).toBe('Residuos Peligrosos (RESPEL)');
  });

  it('deja pasar sin tocar un valor desconocido, solo recortado', () => {
    expect(normalizeMatriz('  Biota ')).toBe('Biota');
  });

  it('unifica las dos grafías de aceite dieléctrico que trae el dataset', () => {
    expect(normalizeMatriz('Aceite Dieléctrico')).toBe('Aceite Dieléctrico');
    expect(normalizeMatriz('Aceite dieléctrico')).toBe('Aceite Dieléctrico');
  });

  it('no estropea los demás valores desconocidos del dataset', () => {
    expect(normalizeMatriz('Sedimento')).toBe('Sedimento');
    expect(normalizeMatriz('Biosólido')).toBe('Biosólido');
    expect(normalizeMatriz('Biota')).toBe('Biota');
    expect(normalizeMatriz('Lodo')).toBe('Lodo');
  });

  it('unifica también las dos grafías de RESPEL', () => {
    expect(normalizeMatriz('ReSIduos Peligrosos (RESPEL)')).toBe('Residuos Peligrosos (RESPEL)');
  });
});

describe('normalizeComponente', () => {
  it('canoniza los componentes conocidos', () => {
    expect(normalizeComponente('CALIDAD DE AIRE')).toBe('Calidad de aire');
    expect(normalizeComponente('fuentes fijas')).toBe('Fuentes Fijas');
  });

  it('conserva los demás', () => {
    expect(normalizeComponente('Continental')).toBe('Continental');
  });

  it('unifica las dos preposiciones de calidad del aire', () => {
    expect(normalizeComponente('Calidad del Aire')).toBe('Calidad de aire');
    expect(normalizeComponente('Calidad de aire')).toBe('Calidad de aire');
    expect(normalizeComponente('CALIDAD DEL AIRE')).toBe('Calidad de aire');
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
