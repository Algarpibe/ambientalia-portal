import { describe, it, expect } from 'vitest';
import {
  ozoneConcentrationPpm,
  isOzoneLossAcceptable,
  dilutionRatio,
  dilute,
  linearityErrorPercent,
  photometerPrecision,
  tpSensitivity,
  correctForTemperaturePressure,
} from './photometry.js';
import { DEFAULT_LIMITS } from './limits.js';

describe('40 CFR 50 App. D photometry', () => {
  it('T6: Eq. 4 with alpha 308, l 38 cm, I/I0 0.99, 298.15 K, 640 torr, L 0.98 -> 1.1363863 ppm', () => {
    const c = ozoneConcentrationPpm({
      pathLengthCm: 38.0,
      transmittance: 0.99,
      tempK: 298.15,
      pressTorr: 640,
      lossFactor: 0.98,
    });
    expect(c).toBeCloseTo(1.1363863, 6);
  });

  it('Eq. 4 uses 273 literally, not 273.15', () => {
    const base = { pathLengthCm: 38, transmittance: 0.99, pressTorr: 760, lossFactor: 1 };
    const at273 = ozoneConcentrationPpm({ ...base, tempK: 273 });
    // At T = 273 and P = 760 the T/P factor must be exactly 1.
    expect(at273).toBeCloseTo((-Math.log(0.99) / (308 * 38)) * 1e6, 12);
  });

  it('Eq. 4 rejects invalid inputs', () => {
    const ok = { pathLengthCm: 38, transmittance: 0.99, tempK: 298, pressTorr: 640, lossFactor: 1 };
    expect(() => ozoneConcentrationPpm({ ...ok, transmittance: 0 })).toThrow();
    expect(() => ozoneConcentrationPpm({ ...ok, transmittance: 1.2 })).toThrow();
    expect(() => ozoneConcentrationPpm({ ...ok, pressTorr: 0 })).toThrow();
    expect(() => ozoneConcentrationPpm({ ...ok, lossFactor: 0 })).toThrow();
  });

  it('D1: loss factor L must be >= 0.95', () => {
    expect(isOzoneLossAcceptable(0.95, DEFAULT_LIMITS)).toBe(true);
    expect(isOzoneLossAcceptable(0.94, DEFAULT_LIMITS)).toBe(false);
  });

  it('Eq. 6 dilution', () => {
    expect(dilutionRatio(1, 3)).toBeCloseTo(0.25, 12);
    expect(dilute(400, 1, 3)).toBeCloseTo(100, 12);
    expect(() => dilutionRatio(0, 0)).toThrow();
  });

  it('§5.2.3 linearity error E% = (A1 - A2/R) / A1 * 100', () => {
    // A1 = 400, R = 0.25, A2 = 98 -> A2/R = 392 -> E = 2 %
    expect(linearityErrorPercent(400, 98, 1, 3)).toBeCloseTo(2, 12);
    expect(linearityErrorPercent(400, 100, 1, 3)).toBeCloseTo(0, 12);
    expect(() => linearityErrorPercent(0, 1, 1, 3)).toThrow();
  });

  it('§3.1 photometer precision: SD <= max(5 ppb, 3 % of concentration)', () => {
    const low = photometerPrecision([100, 102, 98, 101, 99], 100, DEFAULT_LIMITS);
    expect(low.limitPpb).toBe(5);
    expect(low.pass).toBe(true);
    const high = photometerPrecision([400, 400, 400], 400, DEFAULT_LIMITS);
    expect(high.limitPpb).toBeCloseTo(12, 12);
    const bad = photometerPrecision([80, 120, 100], 100, DEFAULT_LIMITS);
    expect(bad.pass).toBe(false);
    expect(() => photometerPrecision([100], 100, DEFAULT_LIMITS)).toThrow();
  });

  it('T/P sensitivity: 3 °C or 7.5 torr is about 1 %', () => {
    const s = tpSensitivity({ tempK: 298.15, pressTorr: 760, deltaTempK: 3, deltaPressTorr: 7.5 });
    expect(s.tempErrorPercent).toBeCloseTo(1.006, 3);
    expect(s.pressErrorPercent).toBeCloseTo(0.987, 3);
    const med = tpSensitivity({ tempK: 298.15, pressTorr: 640, deltaTempK: 3, deltaPressTorr: 7.5 });
    expect(med.pressErrorPercent).toBeCloseTo(1.172, 3);
  });

  it('T/P correction scales by (T_actual/T_assumed) * (P_assumed/P_actual)', () => {
    const c = correctForTemperaturePressure(100, {
      tempKAssumed: 298,
      tempKActual: 301,
      pressTorrAssumed: 760,
      pressTorrActual: 640,
    });
    expect(c).toBeCloseTo(100 * (301 / 298) * (760 / 640), 10);
  });
});
