import { describe, it, expect } from 'vitest';
import { normalizeClientName, generateClientKey } from './normalize';
import { percentile, percentileRank, bandScore, scoreHigherIsBetter, scoreLowerIsBetter, mean } from './stats';
import { parseCurrency } from './parsing';

// Recupera la cobertura de tests que traía la app original (TEST-002): invariantes
// de normalización de cliente y del scoring por percentiles/bandas.

describe('normalizeClientName', () => {
  it('pasa a minúsculas y recorta espacios', () => {
    expect(normalizeClientName('  CAMPOSOL  ')).toBe('camposol');
  });
  it('elimina acentos', () => {
    expect(normalizeClientName('Bogotá')).toBe('bogota');
    expect(normalizeClientName('Café Águila')).toBe('cafe aguila');
  });
  it('es case-insensitive (misma clave para variantes de mayúsculas)', () => {
    expect(normalizeClientName('Corpamag')).toBe(normalizeClientName('CORPAMAG'));
  });
  it('es idempotente', () => {
    const once = normalizeClientName('Inversiones Águila S.A.S.');
    expect(normalizeClientName(once)).toBe(once);
  });
  it('generateClientKey no tiene espacios y respeta el límite de 50', () => {
    const key = generateClientKey('Empresa De Pruebas Muy Larga Con Muchas Palabras Extra');
    expect(key).not.toMatch(/\s/);
    expect(key.length).toBeLessThanOrEqual(50);
  });
});

describe('percentile', () => {
  it('mediana de una lista impar', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });
  it('interpola en una lista par', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
  });
  it('extremos', () => {
    expect(percentile([10, 20, 30], 0)).toBe(10);
    expect(percentile([10, 20, 30], 100)).toBe(30);
  });
  it('lista vacía → 0', () => {
    expect(percentile([], 50)).toBe(0);
  });
});

describe('percentileRank', () => {
  it('proporción de valores por debajo', () => {
    expect(percentileRank(3, [1, 2, 3, 4, 5])).toBeCloseTo(0.4);
  });
  it('distribución vacía → 0.5 (neutral)', () => {
    expect(percentileRank(3, [])).toBe(0.5);
  });
});

describe('bandScore', () => {
  const bands: [number, number, number] = [20, 50, 80];
  it('asigna la banda correcta', () => {
    expect(bandScore(15, bands)).toBe(20);
    expect(bandScore(45, bands)).toBe(50);
    expect(bandScore(70, bands)).toBe(80);
    expect(bandScore(90, bands)).toBe(100);
  });
  it('invert refleja el score', () => {
    expect(bandScore(15, bands, true)).toBe(80);
    expect(bandScore(90, bands, true)).toBe(0);
  });
  it('valor no finito → 50 (neutral)', () => {
    expect(bandScore(NaN, bands)).toBe(50);
  });
});

describe('scoreHigherIsBetter / scoreLowerIsBetter', () => {
  const dist = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  it('higher-is-better: mayor valor ⇒ mayor score (monotonía)', () => {
    const low = scoreHigherIsBetter(20, dist).score;
    const high = scoreHigherIsBetter(90, dist).score;
    expect(high).toBeGreaterThan(low);
  });
  it('lower-is-better es el complemento del higher (mismo valor)', () => {
    const hi = scoreHigherIsBetter(40, dist).score;
    const lo = scoreLowerIsBetter(40, dist).score;
    expect(hi + lo).toBeCloseTo(100, 0);
  });
  it('distribución vacía ⇒ 50 (neutral)', () => {
    expect(scoreHigherIsBetter(50, []).score).toBe(50);
    expect(scoreLowerIsBetter(50, []).score).toBe(50);
  });
});

describe('parseCurrency', () => {
  it('pasa números tal cual', () => {
    expect(parseCurrency(1234.5)).toBe(1234.5);
  });
  it('vacío/null ⇒ 0', () => {
    expect(parseCurrency('')).toBe(0);
    expect(parseCurrency(null)).toBe(0);
  });
  it('formato US con símbolo y comas de miles', () => {
    expect(parseCurrency('$1,234.56')).toBeCloseTo(1234.56);
  });
  it('formato europeo (punto miles, coma decimal)', () => {
    expect(parseCurrency('1.234.567,89')).toBeCloseTo(1234567.89);
  });
  it('quita letras de moneda', () => {
    expect(parseCurrency('COP 5000')).toBe(5000);
  });
  it('divideBy1000 aplica el factor', () => {
    expect(parseCurrency(5000, true)).toBe(5);
  });
});

describe('mean', () => {
  it('promedio simple', () => {
    expect(mean([2, 4, 6])).toBe(4);
  });
});
