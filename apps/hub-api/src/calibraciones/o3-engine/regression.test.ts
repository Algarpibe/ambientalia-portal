import { describe, it, expect } from 'vitest';
import { leastSquares, DegenerateRegressionError } from './regression.js';
import { T3_X, T3_Y } from './fixtures.test-data.js';

const pts = (ys: number[]) => T3_X.map((x, j) => ({ x, y: ys[j], zero: x === 0 }));

describe('Eq. 3-5 least squares per cycle', () => {
  it('T3: slopes and intercepts of the three cycles (zero included)', () => {
    const expected = [
      { m: 1.0070587, b: 0.2210175 },
      { m: 1.0087213, b: 0.1678219 },
      { m: 1.0063681, b: 0.2703658 },
    ];
    T3_Y.forEach((ys, i) => {
      const r = leastSquares(pts(ys));
      expect(r.slope).toBeCloseTo(expected[i].m, 6);
      expect(r.intercept).toBeCloseTo(expected[i].b, 6);
      expect(r.r2).toBeGreaterThan(0.9999);
      expect(r.r2).toBeLessThanOrEqual(1);
    });
  });

  it('Eq. 5: fitted = b + m x and residuals = y - fitted', () => {
    const r = leastSquares(pts(T3_Y[0]));
    expect(r.fitted).toHaveLength(7);
    r.fitted.forEach((f, j) => {
      expect(f).toBeCloseTo(r.intercept + r.slope * T3_X[j], 12);
      expect(r.residuals[j]).toBeCloseTo(T3_Y[0][j] - f, 12);
    });
    const sumRes = r.residuals.reduce((a, v) => a + v, 0);
    expect(sumRes).toBeCloseTo(0, 10);
  });

  it('exact line gives r2 = 1 and zero residuals', () => {
    const r = leastSquares([0, 10, 20].map((x) => ({ x, y: 2 * x + 1 })));
    expect(r.slope).toBeCloseTo(2, 12);
    expect(r.intercept).toBeCloseTo(1, 12);
    expect(r.r2).toBeCloseTo(1, 12);
  });

  it('includeZero = false drops zero points from the fit only', () => {
    const withZero = leastSquares(pts(T3_Y[0]));
    const noZero = leastSquares(pts(T3_Y[0]), { includeZero: false });
    expect(noZero.slope).not.toBeCloseTo(withZero.slope, 8);
    // fitted/residuals still reported for every input point
    expect(noZero.fitted).toHaveLength(7);
  });

  it('degenerate input (Sxx = 0 or < 2 points) throws', () => {
    expect(() => leastSquares([{ x: 5, y: 5 }, { x: 5, y: 6 }])).toThrow(DegenerateRegressionError);
    expect(() => leastSquares([{ x: 5, y: 5 }])).toThrow(DegenerateRegressionError);
    expect(() => leastSquares([])).toThrow(DegenerateRegressionError);
  });
});
