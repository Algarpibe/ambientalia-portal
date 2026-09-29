import { describe, it, expect } from 'vitest';
import { toStandardConcentration, convertPointsToStandard } from './equation10.js';
import { T3_MEAN_SLOPE, T3_MEAN_INTERCEPT } from './fixtures.test-data.js';

describe('TAD 2023 App. A Eq. 10', () => {
  it('T4: indicated 100 ppb with T3 means -> 99.049014 ppb', () => {
    expect(toStandardConcentration(100, T3_MEAN_SLOPE, T3_MEAN_INTERCEPT)).toBeCloseTo(99.049014, 5);
  });

  it('converts every x of a cycle and keeps the raw value', () => {
    const out = convertPointsToStandard(
      [
        { xPpb: 0, yPpb: 0.3 },
        { xPpb: 100, yPpb: 101 },
      ],
      { meanSlope: 2, meanIntercept: 1 },
    );
    expect(out[0].xPpb).toBeCloseTo(-0.5, 12);
    expect(out[0].xRawPpb).toBe(0);
    expect(out[1].xPpb).toBeCloseTo(49.5, 12);
    expect(out[1].yPpb).toBe(101);
  });

  it('rejects a zero or non-finite slope', () => {
    expect(() => toStandardConcentration(100, 0, 0)).toThrow();
    expect(() => toStandardConcentration(100, Number.NaN, 0)).toThrow();
  });
});
