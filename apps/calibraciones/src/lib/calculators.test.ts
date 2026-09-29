import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../engine';
import {
  calcAnalyzerCheck,
  calcDilution,
  calcEq10,
  calcEq4,
  calcLinearity,
  calcOzoneLoss,
  calcTpCorrection,
} from './calculators';

describe('calculators (engine-backed, text inputs with comma decimals)', () => {
  it('App. D Eq. 4 reproduces T6 (1,13639 ppm) and reports ppb', () => {
    const r = calcEq4({ alpha: '308', pathLengthCm: '38,0', transmittance: '0,99', tempK: '298,15', pressTorr: '640', lossPercent: '2' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ppm).toBeCloseTo(1.13639, 4);
      expect(r.value.ppb).toBeCloseTo(1136.39, 1);
      expect(r.value.lossRule.pass).toBe(true);
    }
  });
  it('alpha is optional (308 by default) and empty required fields are an error in Spanish', () => {
    expect(calcEq4({ alpha: '', pathLengthCm: '38', transmittance: '0,99', tempK: '298,15', pressTorr: '640', lossPercent: '' }).ok).toBe(true);
    const r = calcEq4({ alpha: '', pathLengthCm: '', transmittance: '0,99', tempK: '298,15', pressTorr: '640', lossPercent: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/longitud/i);
  });
  it('engine range errors become a Spanish message', () => {
    const r = calcEq4({ alpha: '', pathLengthCm: '38', transmittance: '1,5', tempK: '298', pressTorr: '640', lossPercent: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/I\/I0/);
  });
  it('dilution Eq. 6', () => {
    const r = calcDilution({ concentration: '400', f0: '1', fd: '3' });
    expect(r.ok && r.value.diluted).toBe(100);
    expect(r.ok && r.value.ratio).toBe(0.25);
  });
  it('linearity §5.2.3 with D2', () => {
    const r = calcLinearity({ a1: '400', a2: '99', f0: '1', fd: '3' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.errorPercent).toBeCloseTo(1, 10);
      expect(r.value.rule.pass).toBe(true);
    }
  });
  it('O3 loss D1: 6 % fails, 5 % passes', () => {
    const six = calcOzoneLoss({ lossPercent: '6' });
    expect(six.ok && six.value.rule.pass).toBe(false);
    const five = calcOzoneLoss({ lossPercent: '5' });
    expect(five.ok && five.value.rule.pass).toBe(true);
  });
  it('Eq. 10 reproduces T4 (99,0490 ppb)', () => {
    const r = calcEq10({ indicated: '100', meanSlope: '1,007383', meanIntercept: '0,219735' });
    expect(r.ok && r.value.standardPpb).toBeCloseTo(99.049, 3);
  });
  it('analyzer one-point check C1', () => {
    const r = calcAnalyzerCheck({ referencePpb: '40', analyzerPpb: '41' }, DEFAULT_LIMITS);
    expect(r.ok && r.value.rule.pass).toBe(true);
    const out = calcAnalyzerCheck({ referencePpb: '100', analyzerPpb: '100' }, DEFAULT_LIMITS);
    expect(out.ok && out.value.rule.pass).toBe(false);
  });
  it('T/P correction and sensitivity (Medellín ≈ 640 torr)', () => {
    const r = calcTpCorrection({
      concentration: '100',
      tempCAssumed: '25',
      tempCActual: '28',
      pressTorrAssumed: '760',
      pressTorrActual: '640',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.corrected).toBeCloseTo(100 * (301.15 / 298.15) * (760 / 640), 9);
      expect(r.value.tempErrorPercent).toBeCloseTo((3 / 298.15) * 100, 9);
      expect(r.value.pressErrorPercent).toBeCloseTo((120 / 760) * 100, 9);
    }
  });
});
